import assert from 'node:assert/strict';
import fs from 'node:fs';
import { executeCrossWindowModelTool } from '../functions/cross-window-model-tool.js';
import {
  CROSS_WINDOW_DESCRIPTION,
  CROSS_WINDOW_LIMITS,
  crossWindowDeskSection,
  listCrossWindowMessageIndex,
  listCrossWindowSources,
  readCrossWindow,
  searchCrossWindowMessages,
} from '../functions/cross-window-service.js';
import { resolveToolSelection } from '../functions/tool-registry.js';

const now = Date.parse('2026-09-05T10:00:00Z');
const columns = [
  'id', 'user_id', 'title', 'created_at', 'updated_at', 'deleted_at', 'title_manual',
  'title_generated_at', 'title_model_id', 'archived_at', 'conversation_kind', 'room_type',
  'source', 'source_window_id',
].map((name) => ({ name }));

function variant(id, content, extra = {}) {
  return { id, content, created_at: '2026-09-05T09:00:00Z', ...extra };
}
function turn(id, userContent, assistantContent, options = {}) {
  const users = options.users || [variant(`${id}-u0`, userContent)];
  const assistants = options.assistants || [variant(`${id}-a0`, assistantContent)];
  return {
    id,
    user: { active: options.userActive || 0, variants: users },
    assistant: {
      activeByUserVariant: { [String(options.userActive || 0)]: options.assistantActive || 0 },
      variantsByUserVariant: { [String(options.userActive || 0)]: assistants },
    },
  };
}
function manyTurns(prefix, count, content = '') {
  return Array.from({ length: count }, (_, index) => turn(
    `${prefix}-${index}`,
    `${prefix} user ${index} ${content}`,
    `${prefix} assistant ${index} ${content}`,
  ));
}

const activeBranchTurn = {
  id: 'branch-turn',
  user: {
    active: 1,
    variants: [variant('branch-u0', '旧用户分支'), variant('branch-u1', '当前用户分支')],
  },
  assistant: {
    activeByUserVariant: { 0: 0, 1: 1 },
    variantsByUserVariant: {
      0: [variant('branch-a-old', '旧用户对应回复')],
      1: [variant('branch-a0', '失败旧回复'), variant('branch-a1', '当前激活回复')],
    },
  },
};

const conversations = [
  { id: 'current-main', title: '当前窗口', room_type: 'main', source: 'coast', source_window_id: null, created_at: now - 9000, updated_at: now, deleted_at: null, archived_at: null, conversation_kind: 'chat', user_id: 'owner' },
  { id: 'work-main', title: '找工作这窗', room_type: 'main', source: 'coast', source_window_id: null, created_at: now - 8000, updated_at: now - 1000, deleted_at: null, archived_at: null, conversation_kind: 'chat', user_id: 'owner' },
  { id: 'radio-1', title: '晚间聊天室', room_type: 'radio', source: 'coast', source_window_id: null, created_at: now - 7000, updated_at: now - 2000, deleted_at: null, archived_at: null, conversation_kind: 'chat', user_id: 'owner' },
  { id: 'rikka-1', title: '旧窗口', room_type: 'main', source: 'rikkahub', source_window_id: 'rikka-origin-77', created_at: now - 5000, updated_at: now - 4000, deleted_at: null, archived_at: null, conversation_kind: 'chat', user_id: 'owner' },
  { id: 'archived-1', title: '已隐藏窗口', room_type: 'main', source: 'coast', source_window_id: null, created_at: now - 2500, updated_at: now - 6500, deleted_at: null, archived_at: now - 2, conversation_kind: 'chat', user_id: 'owner' },
  { id: 'deleted-1', title: '已删除', room_type: 'main', source: 'coast', source_window_id: null, created_at: now - 2000, updated_at: now - 7000, deleted_at: now - 1, archived_at: null, conversation_kind: 'chat', user_id: 'owner' },
];
const states = new Map([
  ['current-main', { version: 4, turns: manyTurns('current', 3) }],
  ['work-main', { version: 4, turns: [activeBranchTurn, ...manyTurns('work', 119, 'w')] }],
  ['radio-1', { version: 4, turns: manyTurns('radio', 80, 'r') }],
  ['rikka-1', { version: 4, turns: manyTurns('rikka', 8, 'x'.repeat(6500)) }],
  ['archived-1', { version: 4, turns: manyTurns('archived', 2) }],
]);

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async run() { return { success: true, meta: { changes: 0 } }; }
  async all() {
    const sql = this.sql.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('PRAGMA table_info(')) return { results: columns };
    if (sql.startsWith('SELECT id FROM conversations') && sql.includes('archived_at IS NOT NULL')) {
      return { results: this.db.conversations.filter((row) => row.user_id === this.params[0] && row.archived_at).map((row) => ({ id: row.id })) };
    }
    if (sql.includes('FROM conversations') && sql.includes("conversation_kind = 'chat'") && sql.includes('ORDER BY updated_at DESC')) {
      return { results: this.db.conversations.filter((row) => row.user_id === 'owner' && !row.deleted_at && row.conversation_kind === 'chat') };
    }
    return { results: [] };
  }
  async first() {
    const sql = this.sql.replace(/\s+/g, ' ').trim();
    if (sql.includes('FROM schema_migrations WHERE id = ?')) return { id: this.params[0] || 'done' };
    if (sql.includes('FROM sqlite_master')) return null;
    if (sql.includes('FROM conversations WHERE id = ? AND user_id = ?')) {
      return this.db.conversations.find((row) => row.id === this.params[0] && row.user_id === this.params[1]) || null;
    }
    if (sql.includes('FROM conversation_states WHERE conversation_id = ?')) {
      const state = this.db.states.get(this.params[0]);
      return state ? { state_json: JSON.stringify(state), updated_at: now } : null;
    }
    return null;
  }
}
class FakeD1 {
  constructor() { this.conversations = conversations; this.states = states; }
  prepare(sql) { return new FakeStatement(this, sql); }
}

states.get('rikka-1').turns[0].assistant.variantsByUserVariant['0'][0].content = `${'x'.repeat(500)}深处关键词${'y'.repeat(500)}`;

const db = new FakeD1();
const listed = await listCrossWindowSources(db, { currentConversationId: 'current-main' });
assert.equal(listed.description, CROSS_WINDOW_DESCRIPTION);
assert.deepEqual(listed.limits, { ...CROSS_WINDOW_LIMITS });
assert.deepEqual(listed.limits, { default_turns: 4, technical_max_turns_per_source: 9999 });
assert.equal(listed.sources.some((source) => source.conversation_id === 'deleted-1'), false);
assert.equal(listed.sources.some((source) => source.conversation_id === 'archived-1'), false);
assert.equal(listed.sources.find((source) => source.conversation_id === 'current-main').readable, false);

const oneHundred = await readCrossWindow(db, {
  mode: 'manual',
  current_conversation_id: 'current-main',
  sources: [{ conversation_id: 'work-main', turns: 100, title: '伪造标题', messages: [{ role: 'user', content: '伪造正文' }] }],
});
assert.equal(oneHundred.total_requested_turns, 100);
assert.equal(oneHundred.total_loaded_turns, 100);
assert.equal(oneHundred.total_delivered_turns, 100);
assert.equal(oneHundred.trimmed, false);
assert.equal(oneHundred.items[0].requested_turns, 100);
assert.equal(oneHundred.items[0].loaded_turns, 100);
assert.equal(oneHundred.items[0].messages.some((message) => message.content === '伪造正文'), false);
assert.equal(oneHundred.items[0].messages.some((message) => message.content === '旧用户分支'), false);
assert.equal(oneHundred.items[0].messages.some((message) => message.content === '失败旧回复'), false);

const multiWindow = await readCrossWindow(db, {
  mode: 'manual',
  current_conversation_id: 'current-main',
  sources: [
    { conversation_id: 'work-main', turns: 50 },
    { conversation_id: 'radio-1', turns: 80 },
  ],
});
assert.equal(multiWindow.total_requested_turns, 130);
assert.equal(multiWindow.total_loaded_turns, 130, 'there is no shared 40-turn product budget');
assert.equal(multiWindow.items.length, 2);
assert.equal(multiWindow.trimmed, false);

const decimal = await readCrossWindow(db, {
  mode: 'manual', current_conversation_id: 'current-main', sources: [{ conversation_id: 'radio-1', turns: 5.9 }],
});
assert.equal(decimal.items[0].requested_turns, 5);
const fallback = await readCrossWindow(db, {
  mode: 'manual', current_conversation_id: 'current-main', sources: [{ conversation_id: 'radio-1', turns: 'nope' }],
});
assert.equal(fallback.items[0].requested_turns, 4);
await assert.rejects(
  () => readCrossWindow(db, { mode: 'manual', current_conversation_id: 'current-main', sources: [{ conversation_id: 'radio-1', turns: 10000 }] }),
  (error) => error?.type === 'cross_window_technical_limit' && error?.status === 400,
);

const longMessages = await readCrossWindow(db, {
  mode: 'manual', current_conversation_id: 'current-main', sources: [{ conversation_id: 'rikka-1', turns: 8 }],
});
assert.equal(longMessages.trimmed, false);
assert.equal(longMessages.total_loaded_turns, 8);
assert.ok(longMessages.items.flatMap((item) => item.messages).some((message) => message.content.length > 6000), 'single messages are not silently clipped at 6000 chars');
assert.ok(longMessages.total_loaded_chars > 24000, 'cross-window bodies are not silently clipped at 24000 chars');

const messageIndex = await listCrossWindowMessageIndex(db, { currentConversationId: 'current-main' });
const workIndex = messageIndex.sources.find((source) => source.conversation_id === 'work-main');
assert.ok(workIndex?.turns?.length >= 100);
assert.equal(workIndex.turns[0].messages.every((message) => Boolean(message.message_id)), true);
assert.equal(Object.hasOwn(workIndex.turns[0].messages[0], 'content'), false, 'index exposes preview only, not full old-message bodies');

const selectedMessageId = workIndex.turns.at(-1).messages.find((message) => message.role === 'assistant').message_id;
const exactRead = await readCrossWindow(db, {
  mode: 'manual',
  current_conversation_id: 'current-main',
  messages: [{ conversation_id: 'work-main', message_id: selectedMessageId }],
});
assert.equal(exactRead.total_loaded_messages, 1);
assert.equal(exactRead.items[0].messages.length, 1);
assert.equal(exactRead.items[0].messages[0].message_id, selectedMessageId);
assert.equal(exactRead.items[0].messages[0].role, 'assistant');

const manySelected = workIndex.turns
  .flatMap((turn) => turn.messages)
  .slice(0, 201)
  .map((message) => ({ conversation_id: 'work-main', message_id: message.message_id }));
const manyExactRead = await readCrossWindow(db, {
  mode: 'manual',
  current_conversation_id: 'current-main',
  messages: manySelected,
});
assert.equal(manyExactRead.total_loaded_messages, 201, 'manual message selection must not silently clip after 200 ids');

const keywordHits = await searchCrossWindowMessages(db, {
  query: 'work assistant',
  currentConversationId: 'current-main',
  limit: 5,
});
assert.ok(keywordHits.hits.length > 0);
assert.equal(Object.hasOwn(keywordHits.hits[0], 'content'), false, 'keyword search returns snippets/indexes only');
const deepKeywordHits = await searchCrossWindowMessages(db, {
  query: '深处关键词',
  currentConversationId: 'current-main',
  limit: 5,
});
assert.equal(deepKeywordHits.hits.length, 1, 'keyword search scans the full old message, not only its opening preview');
assert.match(deepKeywordHits.hits[0].preview, /深处关键词/);
assert.ok(deepKeywordHits.hits[0].preview.length < 300, 'full-body search still returns only a compact contextual snippet');
const recallToolContext = {
  permission: 'owner',
  cross_window_mode: 'keyword',
  conversation_id: 'current-main',
  on_cross_window_read() {},
};
const modelKeywordHits = await executeCrossWindowModelTool(db, 'keyword_search', { query: 'work assistant', limit: 10 }, recallToolContext);
assert.ok(modelKeywordHits.hits.length > 0);
assert.ok(modelKeywordHits.hits.length <= 10);
assert.equal(modelKeywordHits.status, 'matched');
const noKeywordHits = await executeCrossWindowModelTool(db, 'keyword_search', { query: '绝对不存在的旧信关键词', limit: 10 }, recallToolContext);
assert.equal(noKeywordHits.status, 'no_match');
assert.equal(noKeywordHits.message, '本地历史无命中。');
const modelExact = await executeCrossWindowModelTool(db, 'read_messages', {
  messages: [{ conversation_id: 'work-main', message_id: selectedMessageId }],
}, recallToolContext);
assert.equal(modelExact.total_loaded_messages, 1);

const modelContext = {
  permission: 'owner',
  cross_window_mode: 'model_decides',
  conversation_id: 'current-main',
  on_cross_window_read() {},
};
const modelHundred = await executeCrossWindowModelTool(db, 'read_recent', { conversation_id: 'work-main', turns: 100 }, modelContext);
assert.equal(modelHundred.total_loaded_turns, 100);
const modelEighty = await executeCrossWindowModelTool(db, 'read_recent', { conversation_id: 'radio-1', turns: 80 }, modelContext);
assert.equal(modelEighty.total_loaded_turns, 80, 'model-decides reads do not share the removed 40-turn/24000-char budget');

const offTools = resolveToolSelection({ permission: 'owner', surface: 'main_chat', cross_window_mode: 'off' });
assert.equal(offTools.modelVisibleTools.some((tool) => tool.function.name.startsWith('cross_window_')), false);
const manualTools = resolveToolSelection({ permission: 'owner', surface: 'main_chat', cross_window_mode: 'manual' });
assert.equal(manualTools.modelVisibleTools.some((tool) => tool.function.name.startsWith('cross_window_')), false);
const decidingTools = resolveToolSelection({ permission: 'owner', surface: 'main_chat', cross_window_mode: 'model_decides' });
assert.deepEqual(decidingTools.modelVisibleTools.filter((tool) => tool.function.name.startsWith('cross_window_')).map((tool) => tool.function.name).sort(), [
  'cross_window_read_messages',
  'cross_window_read_recent',
  'cross_window_search',
]);
const keywordTools = resolveToolSelection({ permission: 'owner', surface: 'main_chat', cross_window_mode: 'keyword' });
assert.deepEqual(keywordTools.modelVisibleTools.filter((tool) => tool.function.name.startsWith('cross_window_')).map((tool) => tool.function.name).sort(), [
  'cross_window_keyword_search',
  'cross_window_read_messages',
]);
const keywordSearchTool = keywordTools.modelVisibleTools.find((tool) => tool.function.name === 'cross_window_keyword_search');
const keywordReadTool = keywordTools.modelVisibleTools.find((tool) => tool.function.name === 'cross_window_read_messages');
assert.equal(keywordSearchTool.function.parameters.properties.limit.maximum, 10);
assert.equal(keywordReadTool.function.parameters.properties.messages.maxItems, 3);
const visitorTools = resolveToolSelection({ permission: 'visitor', surface: 'mailbox_visitor', visitorId: 'visitor-1', cross_window_mode: 'model_decides' });
assert.equal(visitorTools.modelVisibleTools.some((tool) => tool.function.name.startsWith('cross_window_')), false);

const successDesk = crossWindowDeskSection(oneHundred, { mode: 'manual' });
assert.equal(successDesk.status, '已递给');
assert.equal(successDesk.requested_turns, 100);
assert.equal(successDesk.loaded_turns, 100);
assert.equal(successDesk.delivered_to_model_turns, 100);
assert.equal(successDesk.trimmed, false);
const failureDesk = crossWindowDeskSection(oneHundred, {
  mode: 'manual',
  deliveryFailure: { reason: 'provider_context_limit', type: 'context_length_exceeded', message: 'provider rejected full context' },
});
assert.equal(failureDesk.status, '递送失败');
assert.equal(failureDesk.requested_turns, 100);
assert.equal(failureDesk.loaded_turns, 100);
assert.equal(failureDesk.attempted_delivered_turns, 100);
assert.equal(failureDesk.trimmed, false);
assert.equal(failureDesk.failure_reason, 'provider_context_limit');
assert.equal(failureDesk.provider_error_type, 'context_length_exceeded');

const staleAggregate = {
  ...modelEighty,
  items: [...modelHundred.items, ...modelEighty.items],
  requested_windows: 1,
  loaded_windows: 1,
  total_requested_turns: modelEighty.total_requested_turns,
  total_loaded_turns: modelEighty.total_loaded_turns,
  total_loaded_chars: modelEighty.total_loaded_chars,
};
const aggregateDesk = crossWindowDeskSection(staleAggregate, { mode: 'model_decides', modelRead: true });
assert.equal(aggregateDesk.requested_turns, 180, 'desk truth is derived from all actual model-read items, not the last tool-call totals');
assert.equal(aggregateDesk.loaded_turns, 180);
assert.equal(aggregateDesk.requested_windows, 2);
assert.equal(aggregateDesk.loaded_windows, 2);
const earlyModelError = crossWindowDeskSection(null, { mode: 'model_decides', modelRead: false, error: 'technical read failure' });
assert.equal(earlyModelError.mode, 'model_decides');
assert.equal(earlyModelError.status, '递送失败');
assert.equal(earlyModelError.failure_reason, 'cross_window_read_failed');

const dogtalkSource = fs.readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/dogtalk.js', import.meta.url), 'utf8');
assert.equal(dogtalkSource.includes('max="${maxTurns}"'), false, 'PWA turns input must not carry the old max=20 path');
assert.equal(dogtalkSource.includes('Math.min(max, Math.trunc(number))'), false, 'PWA selection sync must not silently clamp to the old max');
assert.match(dogtalkSource, /窗口默认收起，展开到单条消息后可分别勾选/);
assert.match(dogtalkSource, /data-action="dogtalk:cross-source-toggle"/);
assert.match(dogtalkSource, /data-action="dogtalk:cross-turn-toggle"/);
assert.match(dogtalkSource, /跨窗关键词漫游/);
assert.match(dogtalkSource, /不会搜索互联网/);
assert.match(dogtalkSource, /state\.mode === 'keyword'/);
assert.match(dogtalkSource, /name="cross_message"/);
assert.match(dogtalkSource, /messageSelectionKey\(conversationId, message\.message_id\)/);
assert.doesNotMatch(dogtalkSource, /name="cross_source"/);
const crossCss = fs.readFileSync(new URL('../elementera-mcp/deploy-pages/public/styles/cross-window.css', import.meta.url), 'utf8');
assert.equal(/\.cross-window-sources\s*\{[^}]*max-height:/s.test(crossCss), false, 'mobile source list must not keep an inner max-height scroll trap');
assert.equal(/\.cross-window-sources\s*\{[^}]*overflow-y:\s*auto/s.test(crossCss), false, 'mobile source list must let the outer drawer scroll');
const streamFlow = fs.readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-stream-flow.js', import.meta.url), 'utf8');
assert.match(streamFlow, /empty_model_reply/);
const generationSource = fs.readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-generation.js', import.meta.url), 'utf8');
assert.match(generationSource, /这轮跨窗口读取内容太长/);
assert.match(generationSource, /failedDeskSlip \? \{ desk_slip: failedDeskSlip \} : \{\}/);
assert.match(generationSource, /partialContent \|\| \(cancelled \? '已停止生成。' : visibleFailure \|\| '消息生成失败，请稍后重试。'\)/, 'a first-byte provider failure must become visible text instead of an empty assistant message');

console.log('cross-window unlock tests passed');