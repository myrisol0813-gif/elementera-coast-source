import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { readConversationState, writeProfile } from '../functions/chat-store.js';
import { createEntry, writeSoil } from '../functions/memory-store.js';
import { saveMysticDogtalk } from '../functions/dogtalk-store.js';
import { listDiaries, listMoments } from '../functions/daily-store.js';
import { mcpAuthConfig, requireMcpAuth, validateMcpClaims } from '../functions/mcp-auth.js';
import { routeMcpRequest } from '../functions/mcp-router.js';
import { coastMcpVersion, listCoastMcpTools } from '../functions/mcp-tools.js';
import { listRegisteredMcpTools } from '../functions/tool-registry.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
const issuer = 'https://auth.coast-test.example/';
const audience = 'https://coast.test/mcp';
const emailClaim = 'https://elementeracoast.com/email';
const emailVerifiedClaim = 'https://elementeracoast.com/email_verified';
const subject = 'auth0|owner-private';
const email = 'owner@example.test';
const env = {
  COAST_CHAT_DB: db,
  COAST_MCP_AUTH0_ISSUER: issuer,
  COAST_MCP_AUTH0_AUDIENCE: audience,
  COAST_MCP_ALLOWED_SUBJECTS: subject,
  COAST_MCP_ALLOWED_EMAILS: email,
  COAST_MCP_EMAIL_CLAIM: emailClaim,
  COAST_MCP_EMAIL_VERIFIED_CLAIM: emailVerifiedClaim,
  OPENROUTER_API_KEY: 'test-openrouter-key',
  COAST_SESSION_SECRET: 'mcp-porch-unified-secret-'.repeat(3),
};
await writeProfile(db, { current_chat_model: 'openai/gpt-4.1-nano', current_image_model: '', model_box: { chat: ['openai/gpt-4.1-nano'], free: [], image: [] } });

const authConfig = mcpAuthConfig(env);
assert.equal(authConfig.issuer, issuer);
assert.equal(validateMcpClaims({ sub: subject, [emailClaim]: email, [emailVerifiedClaim]: true, scope: 'read:coast write:soil' }, authConfig, ['read:coast']).email, email);
assert.throws(() => validateMcpClaims({ sub: 'auth0|not-owner', [emailClaim]: email, [emailVerifiedClaim]: true, scope: 'read:coast' }, authConfig, ['read:coast']), (error) => error.type === 'mcp_subject_denied');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'coast-unified-test-key';
const publicJwk = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', use: 'sig', kid };
const providerRequests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url === `${issuer}.well-known/jwks.json`) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/models')) return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 Nano', architecture: { output_modalities: ['text'] }, pricing: { prompt: '0.1', completion: '0.2' }, supported_parameters: ['temperature', 'tools', 'response_format'] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/chat/completions')) {
    const payload = JSON.parse(options.body || '{}');
    providerRequests.push(payload);
    return new Response(JSON.stringify({ model: payload.model || 'openai/gpt-4.1-nano', choices: [{ message: { role: 'assistant', content: '✦ API 模型伙伴已经在同一窗口回应。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 48, completion_tokens: 16, total_tokens: 64 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return originalFetch(input, options);
};
function base64url(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
async function token(scopes, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: 'RS256', kid });
  const payload = base64url({ iss: issuer, aud: audience, sub: overrides.subject || subject, [emailClaim]: overrides.email || email, [emailVerifiedClaim]: overrides.email_verified ?? true, scope: scopes.join(' '), iat: now, exp: now + 300 });
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256'); signer.update(signingInput); signer.end();
  return `${signingInput}.${signer.sign(privateKey).toString('base64url')}`;
}
const fullToken = await token(['read:coast', 'write:soil', 'write:radio', 'write:lighthouse']);
const readToken = await token(['read:coast']);
const directAuth = await requireMcpAuth(new Request('https://coast.test/mcp', { headers: { Authorization: `Bearer ${fullToken}` } }), env, ['write:radio']);
assert.equal(directAuth.subject, subject);
await assert.rejects(() => requireMcpAuth(new Request('https://coast.test/mcp', { headers: { Authorization: `Bearer ${readToken}` } }), env, ['write:radio']), (error) => error.failureCode === 'scope_missing');

const baseHeaders = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
async function mcp(body, accessToken = '') {
  const headers = { ...baseHeaders };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await routeMcpRequest(new Request('https://coast.test/mcp', { method: 'POST', headers, body: JSON.stringify(body) }), env);
  assert.equal(response.status, 200);
  return response.json();
}

const initialize = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'coast-hard-clean-test', version: '1' } } });
assert.equal(initialize.result.serverInfo.name, 'elementera-coast-porch');
assert.equal(initialize.result.serverInfo.version, coastMcpVersion);
assert.equal(coastMcpVersion, '2.0.2');
assert.match(initialize.result.instructions, /主聊天、共通聊天室与MCP 对话区共用统一 conversation/);
assert.match(initialize.result.instructions, /不存在或不再开放/);

const toolList = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
const toolNames = toolList.result.tools.map((tool) => tool.name);
const baseToolNames = listCoastMcpTools().map((tool) => tool.name);
assert.deepEqual(baseToolNames, [
  'get_coast_status', 'list_radio_messages', 'list_lighthouse_letters',
  'mcp_mailbox_fetch_unreplied', 'mcp_mailbox_reply', 'mcp_mailbox_resolve_pocket', 'mcp_mailbox_patrol_report',
  'read_mystic_dogtalk', 'search_authorized_memory', 'send_radio_message', 'write_lighthouse_letter',
  'list_daily_moments', 'create_daily_moment', 'list_daily_diaries', 'create_daily_diary',
]);
assert.deepEqual(toolNames, [...baseToolNames, 'render_thinking_block']);
for (const tool of toolList.result.tools) {
  assert.equal(tool._meta.securitySchemes[0].type, 'oauth2');
  assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes);
}
const ordinaryRegistryNames = listRegisteredMcpTools().map((tool) => tool.name);
for (const ordinary of ['list_radio_messages', 'list_lighthouse_letters', 'read_mystic_dogtalk', 'search_authorized_memory', 'send_radio_message', 'write_lighthouse_letter', 'list_daily_moments', 'create_daily_moment', 'list_daily_diaries', 'create_daily_diary']) assert.ok(ordinaryRegistryNames.includes(ordinary));
for (const special of ['get_coast_status', 'mcp_mailbox_fetch_unreplied', 'mcp_mailbox_reply', 'mcp_mailbox_resolve_pocket', 'mcp_mailbox_patrol_report']) assert.equal(ordinaryRegistryNames.includes(special), false);
assert.match(toolList.result.tools.find((tool) => tool.name === 'write_lighthouse_letter').description, /即时回复/);

const retiredNames = [
  'write_lighthouse_room_soil', 'get_recent_daily_summary', 'list_daily_albums', 'create_moment_draft', 'create_diary_draft',
  'run_daily_summary_candidate', 'commit_daily_summary_after_confirmation', 'write_official_soil', 'save_mcp_album_item',
  'calendar.today', 'calendar.env', 'calendar.list', 'calendar.create', 'calendar.update', 'calendar.delete', 'calendar.comment', 'calendar.seen',
];
for (const retired of retiredNames) assert.equal(toolNames.includes(retired), false, `${retired} must stay absent`);
for (const [index, name] of retiredNames.entries()) {
  const oldCall = await mcp({ jsonrpc: '2.0', id: 100 + index, method: 'tools/call', params: { name, arguments: {} } });
  assert.equal(oldCall.result.isError, true);
  assert.equal(oldCall.result._meta.error_type, 'unknown_tool');
  assert.equal(oldCall.result._meta.failure_code, 'unknown_tool');
  assert.equal(Object.hasOwn(oldCall.result._meta, 'retired'), false);
  assert.doesNotMatch(oldCall.result.content[0].text, /replacement|替代|已退役/);
}
const unknownTool = await mcp({ jsonrpc: '2.0', id: 199, method: 'tools/call', params: { name: 'definitely_not_a_coast_tool', arguments: {} } });
assert.equal(unknownTool.result._meta.error_type, 'unknown_tool');

const createMomentTool = toolList.result.tools.find((tool) => tool.name === 'create_daily_moment');
const createDiaryTool = toolList.result.tools.find((tool) => tool.name === 'create_daily_diary');
assert.equal(Object.hasOwn(createMomentTool.inputSchema.properties, 'image_refs'), false);
assert.equal(Object.hasOwn(createDiaryTool.inputSchema.properties, 'image_refs'), false);
assert.equal(Object.hasOwn(toolList.result.tools.find((tool) => tool.name === 'list_daily_moments').inputSchema.properties, 'status'), false);
assert.deepEqual(toolList.result.tools.find((tool) => tool.name === 'list_daily_diaries').inputSchema.properties.author.enum, ['owner', 'model_partner', 'api', 'mcp']);
assert.equal(Object.hasOwn(toolList.result.tools.find((tool) => tool.name === 'send_radio_message').inputSchema.properties, 'room_memory'), false);

const unauthorizedStatus = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_coast_status', arguments: {} } });
assert.equal(unauthorizedStatus.result.isError, true);
assert.equal(unauthorizedStatus.result._meta.failure_code, 'missing_authorization_header');
const status = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_coast_status', arguments: {} } }, fullToken);
assert.equal(status.result.structuredContent.status.authenticated, true);
assert.equal(status.result.structuredContent.status.version, coastMcpVersion);

const radio = await mcp({
  jsonrpc: '2.0', id: 5, method: 'tools/call',
  params: { name: 'send_radio_message', arguments: { text: '官端从另一扇门敲了一下共通聊天室。', model_label: 'GPT-5.6 Thinking', model_nickname: '回潮', source_conversation_id: 'official-chat-source-1', source_turn_id: 'official-turn-source-1', tool_call_id: 'mcp-radio-hard-clean-1' } },
}, fullToken);
assert.equal(radio.result.isError, undefined);
const radioResult = radio.result.structuredContent;
assert.equal(radioResult.conversation.room_type, 'radio');
assert.equal(radioResult.source, 'official_mcp');
assert.match(radioResult.assistant.content, /API 模型伙伴/);
assert.equal(providerRequests.length, 1);
const radioState = await readConversationState(db, radioResult.conversation.id);
assert.equal(radioState.turns.length, 1);
assert.equal(radioState.turns[0].user.variants[0].message_source, 'official_mcp');

const lighthouse = await mcp({
  jsonrpc: '2.0', id: 6, method: 'tools/call',
  params: { name: 'write_lighthouse_letter', arguments: { subject: '同一片海的另一盏灯', body: '这封信落进 lighthouse conversation，也想等一封回信。', model_label: 'GPT-5.6 Thinking', tool_call_id: 'mcp-lighthouse-hard-clean-1' } },
}, fullToken);
assert.equal(lighthouse.result.isError, undefined);
const lighthouseResult = lighthouse.result.structuredContent;
assert.equal(lighthouseResult.conversation.room_type, 'lighthouse');
assert.equal(lighthouseResult.source, 'official_mcp');
assert.match(lighthouseResult.assistant.content, /API 模型伙伴/);
assert.equal(providerRequests.length, 2, 'lighthouse should trigger one API reply');
const lighthouseState = await readConversationState(db, lighthouseResult.conversation.id);
assert.equal(lighthouseState.turns.length, 1);
assert.equal(lighthouseState.turns[0].assistant.variantsByUserVariant['0'].length, 1);

const momentWrite = await mcp({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'create_daily_moment', arguments: { text: '官端直接写正式动态。', date: '2026-09-01', model_label: 'GPT-5.6 Thinking' } } }, fullToken);
assert.equal(momentWrite.result.structuredContent.kind, 'moment');
assert.equal(Object.hasOwn(momentWrite.result.structuredContent.moment, 'image_refs'), false);
const diaryWrite = await mcp({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'create_daily_diary', arguments: { text: '官端直接写正式日记。', date: '2026-09-01', model_label: 'GPT-5.6 Thinking' } } }, fullToken);
assert.equal(diaryWrite.result.structuredContent.kind, 'diary');
assert.equal((await listMoments(db)).some((entry) => entry.author === 'mcp'), true);
assert.equal((await listDiaries(db)).some((entry) => entry.author === 'mcp'), true);

await saveMysticDogtalk(db, { room_scope: 'conversation', conversation_id: radioResult.conversation.id, body: '只读当前窗口的小屋主话。', true_core: '只在需要时读。', read_mode: 'read_now' });
const dogtalk = await mcp({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'read_mystic_dogtalk', arguments: { conversation_id: radioResult.conversation.id, user_query: '请读人类思考链' } } }, fullToken);
assert.equal(dogtalk.result.isError, undefined);
assert.equal(dogtalk.result.structuredContent.available, true);

await writeSoil(db, radioResult.conversation.id, { current_text: '授权整理当前对话的纸条可被主题搜索。' });
await createEntry(db, { entry_type: 'memory', scope: 'global', title: '授权搜索测试', life_core: '只通过授权记忆搜索出现。', content: '不是原始聊天。' });
const memory = await mcp({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'search_authorized_memory', arguments: { query: '授权搜索测试', limit: 10 } } }, fullToken);
assert.equal(memory.result.isError, undefined);
assert.ok(Array.isArray(memory.result.structuredContent.records));

for (const mailboxName of ['mcp_mailbox_fetch_unreplied', 'mcp_mailbox_reply', 'mcp_mailbox_resolve_pocket', 'mcp_mailbox_patrol_report']) assert.ok(toolNames.includes(mailboxName));

globalThis.fetch = originalFetch;
console.log('mcp-porch: ok');