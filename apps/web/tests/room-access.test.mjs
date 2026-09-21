import assert from 'node:assert/strict';
import { createConversation } from '../functions/chat-store.js';
import { assembleCleanContext } from '../functions/context-assemble-clean.js';
import { registerMailboxVisitor } from '../functions/mailbox-service.js';
import { writeSoil } from '../functions/memory-store.js';
import { RoomAccessError, roomAccess } from '../functions/surface-access-rules.js';
import { createWorldbookEntry } from '../functions/worldbook.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
const env = { COAST_CHAT_DB: db, COAST_SESSION_SECRET: 'room-access-secret-'.repeat(5) };
const main = await createConversation(db, 'Owner private', 'main');
const radio = await createConversation(db, '共通聊天室测试', 'radio');
const lighthouse = await createConversation(db, 'MCP 对话区测试', 'lighthouse');
assert.equal(main.room_type, 'main');
assert.equal(radio.room_type, 'radio');
assert.equal(lighthouse.room_type, 'lighthouse');

await writeSoil(db, main.id, { current_text: 'OWNER_MAIN_SOIL_SECRET' });
await writeSoil(db, radio.id, { current_text: '共通聊天室自己的讨论纸条。', hand_seeds: [{ name: '聊天室种', life_core: '只沿着这个 conversation 行走。' }], do_not_repeat: '', pocket_candidates: [] });
await writeSoil(db, lighthouse.id, { current_text: 'MCP 对话区自己的低频纸条。', hand_seeds: [], do_not_repeat: '', pocket_candidates: [] });

const ownerAccess = [roomAccess('main_chat'), roomAccess('radio'), roomAccess('lighthouse')];
assert.deepEqual(ownerAccess.map((access) => access.surface), ['main_chat', 'radio', 'lighthouse']);
for (const access of ownerAccess) {
  assert.equal(access.soil, 'conversation');
  assert.equal(access.memory, 'conversation_and_global');
  assert.deepEqual(access.modelVisibleTools, [
    'daily.create_moment', 'daily.create_diary', 'daily.moment_comment', 'daily.moment_like',
    'dogtalk.read', 'memory.search', 'memory.write_candidate', 'memory.global_excerpt_propose',
    'cross_window.search', 'cross_window.keyword_search', 'cross_window.read_messages', 'cross_window.read_recent',
  ]);
  assert.deepEqual(access.backendTools, ['daily.*', 'dogtalk.*', 'memory.*', 'cross_window.*']);
}
for (const access of ownerAccess.slice(1)) {
  assert.deepEqual(access.backendTools, ownerAccess[0].backendTools, 'main/radio/lighthouse backend tools must stay identical');
  assert.deepEqual(access.modelVisibleTools, ownerAccess[0].modelVisibleTools, 'main/radio/lighthouse model-visible tools must stay identical');
  assert.equal(access.soil, ownerAccess[0].soil);
  assert.equal(access.memory, ownerAccess[0].memory);
}

for (const [surface, conversation, expected, forbidden] of [
  ['main_chat', main, 'OWNER_MAIN_SOIL_SECRET', '共通聊天室自己的'],
  ['radio', radio, '共通聊天室自己的', 'MCP 对话区自己的'],
  ['lighthouse', lighthouse, 'MCP 对话区自己的', '共通聊天室自己的'],
]) {
  const lastUser = { role: 'user', content: `继续${expected}的内容。` };
  const assembled = await assembleCleanContext(env, { surface, conversationId: conversation.id, messages: [lastUser], lastUser, permission: 'owner', preview: true });
  const text = assembled.modelMessages.map((item) => item.content).join('\n');
  assert.match(text, new RegExp(expected));
  assert.doesNotMatch(text, new RegExp(forbidden));
  if (surface !== 'main_chat') assert.doesNotMatch(text, /OWNER_MAIN_SOIL_SECRET/);
  const functionToolNames = assembled.tools
    .filter((tool) => tool.type === 'function')
    .map((tool) => tool.function.name)
    .sort();
  for (const required of ['create_diary', 'create_moment', 'global_excerpt_propose', 'memory_search', 'memory_write_candidate', 'moment_comment', 'moment_like', 'read_mystic_dogtalk']) {
    assert.ok(functionToolNames.includes(required), `${surface} lost required owner tool ${required}`);
  }
  assert.equal(functionToolNames.some((name) => name.startsWith('calendar_')), false, `${surface} unexpectedly exposed calendar tools`);
  assert.equal(
    assembled.tools.some((tool) => tool.type === 'openrouter:web_search'),
    surface === 'main_chat' || surface === 'radio',
    `${surface} web search exposure drifted`,
  );
}

const modelDecidesUser = { role: 'user', content: '如果需要，可以去别的窗口取一点信。' };
const modelDecidesContext = await assembleCleanContext(env, {
  surface: 'main_chat',
  conversationId: main.id,
  messages: [modelDecidesUser],
  lastUser: modelDecidesUser,
  permission: 'owner',
  preview: true,
  crossWindow: { mode: 'model_decides' },
});
const modelDecidesNames = modelDecidesContext.tools
  .filter((tool) => tool.type === 'function')
  .map((tool) => tool.function.name);
for (const required of [
  'create_diary',
  'create_moment',
  'cross_window_read_messages',
  'cross_window_read_recent',
  'cross_window_search',
  'global_excerpt_propose',
  'memory_search',
  'memory_write_candidate',
  'moment_comment',
  'moment_like',
  'read_mystic_dogtalk',
]) {
  assert.ok(modelDecidesNames.includes(required), `model-decides lost required tool ${required}`);
}
assert.equal(modelDecidesNames.includes('cross_window_keyword_search'), false, 'model-decides must not receive local keyword search');
assert.ok(modelDecidesContext.tools.some((tool) => tool.type === 'openrouter:web_search'));

const keywordUser = { role: 'user', content: '只翻应用里的历史消息关键词，不要搜索互联网。' };
const keywordContext = await assembleCleanContext(env, {
  surface: 'main_chat',
  conversationId: main.id,
  messages: [keywordUser],
  lastUser: keywordUser,
  permission: 'owner',
  preview: true,
  crossWindow: { mode: 'keyword' },
});
const keywordNames = keywordContext.tools
  .filter((tool) => tool.type === 'function')
  .map((tool) => tool.function.name);
assert.deepEqual(
  keywordNames.filter((name) => name.startsWith('cross_window_')).sort(),
  ['cross_window_keyword_search', 'cross_window_read_messages'],
);
assert.equal(keywordContext.tools.some((tool) => tool.type === 'openrouter:web_search'), false, 'keyword mode must not expose web search');

assert.throws(() => roomAccess('main_chat', { permission: 'visitor' }), (error) => error instanceof RoomAccessError && error.type === 'surface_forbidden');
assert.throws(() => roomAccess('mailbox_visitor', { permission: 'visitor' }), (error) => error instanceof RoomAccessError && error.type === 'visitor_id_required');
assert.throws(() => roomAccess('', { permission: 'owner' }), (error) => error instanceof RoomAccessError && error.type === 'surface_required');

await createWorldbookEntry(db, { title: '访客安全词', content: '只是当前访客可用的词典纸条。', keywords: ['同一发音'], scope: 'visitor', visitor_safe: true, priority: 300 });
await createWorldbookEntry(db, { title: 'Owner 私密词', content: 'OWNER_WORLDBOOK_SECRET', keywords: ['同一发音'], scope: 'owner', visitor_safe: false, priority: 400 });
const visitorA = await registerMailboxVisitor(db, env, { display_name: '访客甲', passphrase: '甲-独立暗号', allow_memory: true });
const visitorB = await registerMailboxVisitor(db, env, { display_name: '访客乙', passphrase: '乙-独立暗号', allow_memory: true });
const notebookTime = new Date().toISOString();
for (const row of [
  ['visitor-a-relevant', visitorA.id, '同一发音的纸条', 'VISITOR_A_NOTEBOOK_MATCH', '只属于甲的相关记事。'],
  ['visitor-a-unrelated', visitorA.id, '完全无关的收藏', 'VISITOR_A_UNRELATED_NOTEBOOK', '不应因为同属一人就每轮全部倾倒。'],
  ['visitor-b-secret', visitorB.id, '同一发音的乙纸条', 'VISITOR_B_NOTEBOOK_SECRET', '不得进入甲的上下文。'],
]) {
  db.database.prepare(`INSERT INTO visitor_notebook_entries (id, visitor_id, title, life_core, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(...row, notebookTime, notebookTime);
}
db.database.prepare('UPDATE mailbox_thought_soils SET current_text = ? WHERE visitor_id = ?').run('VISITOR_A_SOIL_ONLY', visitorA.id);
db.database.prepare('UPDATE mailbox_thought_soils SET current_text = ? WHERE visitor_id = ?').run('VISITOR_B_SOIL_SECRET', visitorB.id);

const visitorInput = { role: 'user', content: '同一发音，继续我自己的信。' };
const visitorContext = await assembleCleanContext(env, { surface: 'mailbox_visitor', conversationId: `mailbox:${visitorA.id}`, visitorId: visitorA.id, messages: [visitorInput], lastUser: visitorInput, permission: 'visitor', preview: true });
const visitorText = visitorContext.modelMessages.map((item) => item.content).join('\n');
assert.match(visitorText, /VISITOR_A_SOIL_ONLY/);
assert.match(visitorText, /访客安全词/);
assert.match(visitorText, /VISITOR_A_NOTEBOOK_MATCH/);
assert.doesNotMatch(visitorText, /VISITOR_A_UNRELATED_NOTEBOOK|VISITOR_B_NOTEBOOK_SECRET|VISITOR_B_SOIL_SECRET|OWNER_MAIN_SOIL_SECRET|OWNER_WORLDBOOK_SECRET/);
assert.deepEqual(visitorContext.tools, []);
assert.equal(Object.hasOwn(visitorContext, 'desk_slip'), false);

console.log('room-access: ok');