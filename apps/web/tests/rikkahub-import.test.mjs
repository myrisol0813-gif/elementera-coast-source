import assert from 'node:assert/strict';
import fs from 'node:fs';
import { activeBranch, appendTurn, normalizeState } from '../elementera-mcp/deploy-pages/public/features/chat-state.js';
import { contextMessages } from '../elementera-mcp/deploy-pages/public/features/chat/chat-context.js';
import { APP_CACHE_NAME, APP_CACHE_VERSION } from '../scripts/cache-versions.mjs';

const importedTurns = Array.from({ length: 192 }, (_, index) => ({
  id: `rikka-turn-${index}`,
  user: {
    active: 0,
    variants: [{
      id: `rikka-user-${index}`,
      content: `旧问题 ${index}`,
      created_at: '2026-08-01T00:00:00Z',
      message_source: 'rikkahub',
    }],
  },
  assistant: {
    activeByUserVariant: { 0: 0 },
    variantsByUserVariant: { 0: [{
      id: `rikka-assistant-${index}`,
      content: `旧回复 ${index}`,
      created_at: '2026-08-01T00:00:10Z',
      model_id: 'old-model',
      message_source: 'rikkahub',
    }] },
  },
}));

let state = normalizeState({ turns: importedTurns });
assert.equal(state.turns.length, 192, 'RikkaHub 最大窗口不能再被旧的 100-turn 上限截断');
assert.equal(activeBranch(state.turns[0]).user.message_source, 'rikkahub');
assert.equal(activeBranch(state.turns[0]).assistant.message_source, 'rikkahub');

const appended = appendTurn(state, '回到海岸后的新问题', {
  message_source: 'xiaohan_web',
  display_author: '屋主',
});
state = appended.state;
assert.equal(state.turns.length, 193);
assert.equal(state.turns[0].id, 'rikka-turn-0');

const context = contextMessages(state, appended.turn.id, { recentTurns: 8 });
assert.equal(context.length, 15, 'RikkaHub 当前窗口只应递入最近约 8 轮，而不是整个 192-turn 档案');
assert.deepEqual(
  context.slice(0, 2).map(({ role, content }) => ({ role, content })),
  [
    { role: 'user', content: '旧问题 185' },
    { role: 'assistant', content: '旧回复 185' },
  ],
  'RikkaHub 旧消息应在自己的窗口里作为最近上下文继续使用',
);
assert.deepEqual(
  context.at(-1),
  { role: 'user', content: '回到海岸后的新问题', turn_id: appended.turn.id },
  '当前新消息必须位于上下文末尾',
);
assert.equal(context.some(({ content }) => content === '旧问题 184'), false, '更早的 RikkaHub 档案不能越过最近上下文窗口');

const openContext = contextMessages(state, appended.turn.id, { recentTurns: 500 });
assert.equal(openContext.length, 385, 'PWA 不得在 recentTurns 之前另设 20-message 客户端上限');
assert.deepEqual(
  openContext.slice(0, 2).map(({ role, content }) => ({ role, content })),
  [
    { role: 'user', content: '旧问题 0' },
    { role: 'assistant', content: '旧回复 0' },
  ],
  '足够大的 recentTurns 应允许当前窗口已有历史完整进入后端裁剪阶段',
);

const schema = fs.readFileSync(new URL('../functions/chat-schema.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../functions/chat-store.js', import.meta.url), 'utf8');
const importer = fs.readFileSync(new URL('../functions/rikkahub-import-store.js', import.meta.url), 'utf8');
const conversations = fs.readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-conversations.js', import.meta.url), 'utf8');
const render = fs.readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-render.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../elementera-mcp/deploy-pages/index.html', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../elementera-mcp/deploy-pages/service-worker.js', import.meta.url), 'utf8');
const cacheVersions = fs.readFileSync(new URL('../scripts/cache-versions.mjs', import.meta.url), 'utf8');

assert.match(schema, /source TEXT NOT NULL DEFAULT 'coast'/);
assert.match(schema, /source_window_id TEXT/);
assert.match(schema, /idx_conversations_source_window/);
assert.match(store, /MESSAGE_SOURCES = new Set\(\['xiaohan_web', 'official_mcp', 'rikkahub'\]\)/);
assert.match(store, /c\.source != 'rikkahub'/, '跨窗口活动消息不能读取 RikkaHub 档案');
assert.match(importer, /writeConversationState\(db, conversationId, state\)/, '导入正文必须写 canonical history');
assert.doesNotMatch(importer, /history_json/, 'RikkaHub 不应再拥有平行 history owner');
assert.doesNotMatch(importer, /CREATE TABLE IF NOT EXISTS rikkahub_imports/, 'RikkaHub 不应再拥有平行 conversation owner');
assert.match(conversations, /requestJson\(`\$\{API\.history\}\?conversation_id=/, '打开 RikkaHub 仍应走普通 history');
assert.doesNotMatch(conversations, /fetchRikkaHubHistory/);
assert.doesNotMatch(render, /rikkahubArchives/);
assert.ok(index.includes(`/public/styles/rikkahub.css?v=${APP_CACHE_VERSION}`), '主 PWA 必须实际加载 RikkaHub 样式');
assert.ok(serviceWorker.includes(APP_CACHE_NAME), '主 PWA cache name 必须来自统一版本源');
assert.ok(serviceWorker.includes(`/public/styles/rikkahub.css?v=${APP_CACHE_VERSION}`), '离线壳必须缓存 RikkaHub 样式');
assert.match(serviceWorker, /\/public\/features\/chat\/chat-rikkahub\.js/, '离线壳必须缓存 RikkaHub import helper');
assert.match(cacheVersions, /'\/public\/styles\/rikkahub\.css': APP_CACHE_VERSION/, 'cache 单一来源必须登记 RikkaHub 样式');

console.log('rikkahub-import: ok');
