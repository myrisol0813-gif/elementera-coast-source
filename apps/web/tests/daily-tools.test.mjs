import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { writeProfile } from '../functions/chat-store.js';
import { routeDailyApi } from '../functions/daily-api.js';
import { executeDailyModelTool } from '../functions/daily-model-tools.js';
import { createDeskSlip } from '../functions/desk-slip.js';
import { addMomentComment, createDiary, createMoment, deleteMoment, setMomentLike } from '../functions/daily-store.js';
import { dangerConfirmationFor } from '../elementera-mcp/deploy-pages/public/core/danger.js';
import { resolveToolSelection } from '../functions/tool-registry.js';
import { D1Database } from './d1-helper.mjs';

const main = resolveToolSelection({ permission: 'owner', surface: 'main_chat' });
const mainNames = main.modelVisibleTools
  .filter((tool) => tool.type === 'function')
  .map((tool) => tool.function.name)
  .sort();
for (const required of ['create_diary', 'create_moment', 'memory_search', 'memory_write_candidate', 'moment_comment', 'moment_like', 'read_mystic_dogtalk']) {
  assert.ok(mainNames.includes(required), `main chat lost required Daily/Core tool ${required}`);
}
assert.ok(mainNames.includes('github_read_file'), 'owner main chat keeps direct dev-hand tools available');
for (const retired of ['create_diary_draft', 'save_album_reference']) assert.equal(mainNames.includes(retired), false);

const mainByName = new Map(main.modelVisibleToolRecords.map((tool) => [tool.model_name, tool]));
const exposedByName = new Map(main.modelVisibleTools.map((tool) => [tool.function.name, tool]));
for (const name of ['read_mystic_dogtalk', 'memory_search', 'memory_write_candidate']) assert.equal(mainByName.get(name)?.model_group, 'core', `${name} stays a Core tool`);
for (const name of ['create_moment', 'create_diary', 'moment_comment', 'moment_like']) assert.equal(mainByName.get(name)?.model_group, 'side', `${name} stays a Daily side tool`);
assert.deepEqual([
  mainByName.get('read_mystic_dogtalk')?.display_name,
  mainByName.get('memory_search')?.display_name,
  mainByName.get('memory_write_candidate')?.display_name,
  mainByName.get('create_moment')?.display_name,
  mainByName.get('create_diary')?.display_name,
  mainByName.get('moment_comment')?.display_name,
  mainByName.get('moment_like')?.display_name,
], ['读取人类思考链', '搜索已确认记忆', '放入待确认区', '写碳硅圈', '写日记', '评论朋友圈', '点赞朋友圈']);
assert.match(exposedByName.get('moment_comment')?.function?.description || '', /latest[\s\S]*最新一条已发布碳硅圈/);
assert.match(exposedByName.get('moment_like')?.function?.description || '', /latest[\s\S]*最新一条已发布碳硅圈/);

const dailySurface = resolveToolSelection({ permission: 'owner', surface: 'daily' });
assert.deepEqual(dailySurface.modelVisibleTools, [], 'Daily page itself is not another model-chat surface');

const core = main.modelVisibleToolRecords.filter((tool) => tool.model_group === 'core');
const side = main.modelVisibleToolRecords.filter((tool) => tool.model_group === 'side');
const receipt = createDeskSlip({ modelVisibleTools: main.modelVisibleToolRecords, backendTools: main.backendTools, toolGroups: { core, side } });
assert.deepEqual(receipt.workbench.labels, { model_visible_tools: '模型可见工具', backend_tools: '后端可用工具', core: '常用工具', side: '小组件小工具' });
assert.deepEqual(receipt.workbench.core_tools.map((tool) => tool.display_name), ['读取人类思考链', '搜索已确认记忆', '放入待确认区']);
assert.deepEqual(receipt.workbench.side_tools.map((tool) => tool.display_name), ['写碳硅圈', '写日记', '评论朋友圈', '点赞朋友圈']);
assert.deepEqual(receipt.workbench.side_tools.map((tool) => tool.name), ['create_moment', 'create_diary', 'moment_comment', 'moment_like']);
assert.ok(receipt.workbench.model_visible_tools.length >= 7);
assert.ok(receipt.workbench.backend_tools.length >= 7);

const db = new D1Database();
const env = { COAST_CHAT_DB: db };
const ownerSession = { verified: true };
const moment = await createMoment(db, { id: 'delete-moment-tools', date: '2026-09-01', text: '待删除碳硅圈。' });
await addMomentComment(db, moment.id, { id: 'delete-comment-tools', text: '待删除评论。' });
await addMomentComment(db, moment.id, { id: 'cascade-comment-tools', text: '随动态级联删除。' });
await setMomentLike(db, moment.id, true);

let response = await routeDailyApi(new Request(`https://coast.test/api/daily/moments/${moment.id}/comments/delete-comment-tools`, { method: 'DELETE' }), env, null);
assert.equal(response.status, 401);
response = await routeDailyApi(new Request(`https://coast.test/api/daily/moments/${moment.id}/comments/delete-comment-tools`, { method: 'DELETE' }), env, ownerSession);
assert.equal(response.status, 200);
assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM daily_moment_comments WHERE id = ?').get('delete-comment-tools').count, 0);
response = await routeDailyApi(new Request(`https://coast.test/api/daily/moments/${moment.id}`, { method: 'DELETE' }), env, ownerSession);
assert.equal(response.status, 200);
assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM daily_moments WHERE id = ?').get(moment.id).count, 0);
assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM daily_moment_comments WHERE moment_id = ?').get(moment.id).count, 0);
assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM daily_moment_likes WHERE moment_id = ?').get(moment.id).count, 0);

const diary = await createDiary(db, { id: 'delete-diary-tools', date: '2026-09-02', text: '待删除日记。' });
response = await routeDailyApi(new Request(`https://coast.test/api/daily/diaries/${diary.id}`, { method: 'DELETE' }), env, null);
assert.equal(response.status, 401);
response = await routeDailyApi(new Request(`https://coast.test/api/daily/diaries/${diary.id}`, { method: 'DELETE' }), env, ownerSession);
assert.equal(response.status, 200);
assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM daily_diaries WHERE id = ?').get('delete-diary-tools').count, 0);

const olderTarget = await createMoment(db, { id: 'moment-target-older', date: '2026-09-01', text: '较早的一条。' });
await new Promise((resolve) => setTimeout(resolve, 2));
const latestTarget = await createMoment(db, { id: 'moment-target-latest', date: '2026-09-02', text: '最新的一条。' });
const commentLatest = await executeDailyModelTool(db, {
  function: { name: 'moment_comment', arguments: JSON.stringify({ moment_id: 'latest', text: '我在最新这条下面。' }) },
}, { model_label: 'GPT-5.6 Coast' });
assert.equal(commentLatest.target_moment_id, latestTarget.id);
assert.equal(commentLatest.moment.comments.at(-1).text, '我在最新这条下面。');
const likeLatest = await executeDailyModelTool(db, {
  function: { name: 'moment_like', arguments: JSON.stringify({ moment_id: '最新朋友圈', liked: true }) },
}, { model_label: 'GPT-5.6 Coast' });
assert.equal(likeLatest.target_moment_id, latestTarget.id);
assert.equal(likeLatest.moment.liked, true);
const exactComment = await executeDailyModelTool(db, {
  function: { name: 'moment_comment', arguments: JSON.stringify({ moment_id: olderTarget.id, text: '具体 ID 仍然能用。' }) },
}, { model_label: 'GPT-5.6 Coast' });
assert.equal(exactComment.target_moment_id, olderTarget.id);
assert.equal(exactComment.moment.comments.at(-1).text, '具体 ID 仍然能用。');

await writeProfile(db, { current_chat_model: 'openai/gpt-4.1-mini' });
const modelErrorResponse = await routeDailyApi(new Request(`https://coast.test/api/daily/moments/${latestTarget.id}/model-partner-comment`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mode: 'instant' }),
}), env, ownerSession);
assert.equal(modelErrorResponse.status, 200);
assert.match(modelErrorResponse.headers.get('content-type') || '', /text\/event-stream/);
assert.equal(modelErrorResponse.headers.get('x-coast-daily-comment-build'), 'daily-comment-33');
const modelErrorStream = await modelErrorResponse.text();
assert.match(modelErrorStream, /event: ready/);
assert.match(modelErrorStream, /event: error/);
assert.match(modelErrorStream, /"type":"auth_error"/);
assert.match(modelErrorStream, /OpenRouter key/);
assert.match(modelErrorStream, /"stage":"model_stream"/);

await deleteMoment(db, latestTarget.id);
await deleteMoment(db, olderTarget.id);
await assert.rejects(
  () => executeDailyModelTool(db, {
    function: { name: 'moment_comment', arguments: JSON.stringify({ moment_id: '刚刚那条', text: '这里应该找不到目标。' }) },
  }, { model_label: 'GPT-5.6 Coast' }),
  (error) => error?.type === 'moment_not_found' && /还没有可评论或点赞/.test(error.message),
);

for (const [action, title] of [['daily:delete-moment', '确定删除这条碳硅圈吗？'], ['daily:delete-comment', '删除这条评论吗？'], ['daily:delete-diary', '确定删除这篇日记吗？']]) {
  const confirmation = dangerConfirmationFor(action);
  assert.equal(confirmation?.title, title);
  assert.equal(confirmation?.confirmText, '删除');
}
for (const retiredAction of ['daily:delete-album', 'daily:delete-summary']) assert.equal(dangerConfirmationFor(retiredAction), null);

const dailyFiles = [
  '../elementera-mcp/deploy-pages/public/features/daily.js',
  '../elementera-mcp/deploy-pages/public/features/daily/daily-actions.js',
  '../elementera-mcp/deploy-pages/public/features/daily/daily-moments-view.js',
  '../elementera-mcp/deploy-pages/public/features/daily/daily-diaries-view.js',
  '../elementera-mcp/deploy-pages/public/features/daily/daily-profile.js',
];
const dailySource = (await Promise.all(dailyFiles.map((path) => readFile(new URL(path, import.meta.url), 'utf8')))).join('\n');
const clientSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/daily-client.js', import.meta.url), 'utf8');
const apiClientSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/core/api.js', import.meta.url), 'utf8');
for (const action of ['delete-moment', 'delete-comment', 'delete-diary']) assert.match(dailySource, new RegExp(`daily:${action}`));
for (const retired of ['delete-album', 'delete-summary', 'create_diary_draft', 'save_album_reference', 'momentImageRef', 'diaryImageRef', 'stableImageRef', 'image_refs']) {
  assert.equal(dailySource.includes(retired), false);
  assert.equal(clientSource.includes(retired), false);
}
for (const retired of ['today_coast', 'today-coast', '【今日海岸】', '/api/calendar']) {
  assert.equal(dailySource.includes(retired), false);
  assert.equal(clientSource.includes(retired), false);
}
assert.doesNotMatch(clientSource, /AbortController|setTimeout|timeout/i, 'Daily client must not impose a short comment timeout');
assert.doesNotMatch(apiClientSource, /AbortController|setTimeout|timeout/i, 'shared JSON client must not impose a short timeout');
assert.match(clientSource, /x-coast-daily-comment-build/);
assert.match(clientSource, /cf-ray/);
assert.match(clientSource, /parseCommentStream/);
assert.match(clientSource, /Accept: 'text\/event-stream'/);
assert.match(clientSource, /requestModelPartnerComment/);

const commentSource = await readFile(new URL('../functions/daily-moment-comment.js', import.meta.url), 'utf8');
const instantStart = commentSource.indexOf('function instantTimelinePaper');
const instantEnd = commentSource.indexOf('async function generateContextualComment');
assert.ok(instantStart >= 0 && instantEnd > instantStart, 'instant comment branch must stay structurally separate');
const instantCluster = commentSource.slice(instantStart, instantEnd);
for (const required of ['getMoment(db, momentId)', 'listMoments(db', 'readCustomInstructions(db)', '【当前碳硅圈】', '【当前动态已有评论】', '【过往碳硅圈】', 'performFormalChatStream(env']) {
  assert.ok(instantCluster.includes(required), `instant comment misses ${required}`);
}
for (const forbidden of ['assembleCleanContext', 'organizedMemoryRecordsInRange', 'momentCommentContext', 'buildMemoryContext', 'matchWorldbook', 'dogtalkContext', 'executeTool']) {
  assert.equal(instantCluster.includes(forbidden), false, `instant comment must not read heavy context: ${forbidden}`);
}
for (const forbidden of ['tools:', 'reasoning:', 'response_format:']) assert.equal(instantCluster.includes(forbidden), false, `instant payload must stay minimal: ${forbidden}`);
assert.match(commentSource, /value\.mode === 'instant'/);
assert.match(commentSource, /只输出评论正文/);
assert.match(commentSource, /最多两句/);
assert.match(commentSource, /slice\(0, 180\)/);
assert.match(instantCluster, /settings: instantCommentSettings\(\)/);
assert.match(instantCluster, /function instantCommentSettings\(\)[\s\S]*max_tokens: 5000[\s\S]*temperature: 0\.82/);
assert.match(instantCluster, /transport: 'stream_buffered'/);
assert.match(instantCluster, /message_count:[\s\S]*message_chars:/);
assert.match(commentSource, /daily-model-partner-comment-step/);
assert.match(commentSource, /daily-model-partner-comment-failure/);

const actionsSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/daily/daily-actions.js', import.meta.url), 'utf8');
const momentsSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/daily/daily-moments-view.js', import.meta.url), 'utf8');
assert.match(actionsSource, /client\.createMoment\(value\)[\s\S]*await client\.modelPartnerCommentMoment\(savedMoment\.id, \{ mode: 'instant' \}\)[\s\S]*router\.open\('moments'/);
assert.match(actionsSource, /state\.savingMoment/);
assert.match(actionsSource, /state\.commentingMomentIds\.has\(id\)/);
assert.match(actionsSource, /client\.modelPartnerCommentMoment\(id, \{ mode: 'instant' \}\)/);
assert.match(momentsSource, /data-action="daily:model-partner-comment"/);
assert.match(momentsSource, /\$\{escapeHtml\(modelPartnerName\(\)\)\} 正在看…/);
assert.match(momentsSource, /\$\{escapeHtml\(modelPartnerName\(\)\)\} 留言/);
assert.match(clientSource, /modelPartnerCommentMoment\(id, value = \{\}\)/);

const chatRouterSource = await readFile(new URL('../functions/chat-router.js', import.meta.url), 'utf8');
const assemblerSource = await readFile(new URL('../functions/context-assemble-clean.js', import.meta.url), 'utf8');
assert.match(chatRouterSource, /performFormalChatStream/);
assert.match(chatRouterSource, /surface: 'landing'/);
assert.match(chatRouterSource, /assembleCleanContext\(env/);
assert.match(assemblerSource, /OWNER_CUSTOM_INSTRUCTION_SURFACES = new Set\(\['main_chat', 'landing', 'radio', 'lighthouse'\]\)/);
assert.match(assemblerSource, /readCustomInstructions\(env\.COAST_CHAT_DB\)/);

const modelToolsSource = await readFile(new URL('../functions/daily-model-tools.js', import.meta.url), 'utf8');
const registrySource = await readFile(new URL('../functions/tool-registry-core.js', import.meta.url), 'utf8');
const commentHandler = modelToolsSource.slice(modelToolsSource.indexOf("if (name === 'moment_comment')"), modelToolsSource.indexOf("if (name === 'moment_like')"));
assert.match(commentHandler, /resolveMomentId/);
assert.match(commentHandler, /addMomentComment/);
assert.doesNotMatch(commentHandler, /performFormalChat|assembleCleanContext|readCustomInstructions/);
const resolverSource = modelToolsSource.slice(modelToolsSource.indexOf('export async function resolveMomentId'), modelToolsSource.indexOf('export async function executeDailyModelTool'));
assert.match(resolverSource, /listMoments\(db, \{ status: 'published', limit: 1 \}\)/);
assert.doesNotMatch(resolverSource, /performFormalChat|assembleCleanContext|readCustomInstructions|momentCommentContext|organizedMemoryRecordsInRange/);
assert.match(registrySource, /daily\.moment_comment[\s\S]*dailyHandler\('comment'\)/);
assert.match(registrySource, /daily\.moment_like[\s\S]*dailyHandler\('like'\)/);

const dailyApiSource = await readFile(new URL('../functions/daily-api.js', import.meta.url), 'utf8');
assert.match(dailyApiSource, /error instanceof ModelRequestError/);
assert.match(dailyApiSource, /daily-model-partner-comment-route/);
assert.match(dailyApiSource, /stream_ready/);
assert.match(dailyApiSource, /route_done/);
assert.match(dailyApiSource, /route_failed/);
assert.match(dailyApiSource, /DAILY_COMMENT_BUILD = 'daily-comment-33'/);
assert.match(dailyApiSource, /X-Coast-Daily-Comment-Build/);
assert.match(dailyApiSource, /streamModelPartnerComment/);
assert.match(dailyApiSource, /safeLogError\('daily-model-partner-comment', error/);

const formalSource = await readFile(new URL('../functions/models/model-formal-chat-core.js', import.meta.url), 'utf8');
const streamRequestCluster = formalSource.slice(formalSource.indexOf('async function requestOpenRouterStream'), formalSource.indexOf('async function* readProviderSse'));
assert.match(streamRequestCluster, /upstream_status: response\.status/);
assert.match(streamRequestCluster, /provider_message_preview: preview/);
const streamChunkCluster = formalSource.slice(formalSource.indexOf('function streamChunkError'), formalSource.indexOf('function safeToolFailure'));
assert.match(streamChunkCluster, /upstream_status: status/);
assert.match(streamChunkCluster, /provider_message_preview: preview/);

console.log('daily-tools: ok');