import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeBranch, normalizeState as normalizeClientState } from '../elementera-mcp/deploy-pages/public/features/chat-state.js';
import { createChatActions } from '../elementera-mcp/deploy-pages/public/features/chat/chat-actions.js';
import { normalizeState as normalizeServerState } from '../functions/chat-store.js';
import { APP_CACHE_NAME, APP_CACHE_VERSION } from '../scripts/cache-versions.mjs';

const history = {
  version: 4,
  turns: [
    {
      id: 'turn-old',
      user: { active: 0, variants: [{ id: 'user-old', content: '旧问题' }] },
      assistant: {
        activeByUserVariant: { 0: 0 },
        variantsByUserVariant: { 0: [{
          id: 'assistant-old',
          content: '旧回复',
          desk_slip: { summary: '旧桌面', context: { memories: ['旧'] } },
        }] },
      },
    },
    {
      id: 'turn-current',
      user: { active: 0, variants: [{ id: 'user-current', content: '新问题' }] },
      assistant: {
        activeByUserVariant: { 0: 0 },
        variantsByUserVariant: { 0: [{
          id: 'assistant-current',
          content: '新回复',
          desk_slip: { summary: '本轮上下文预览', context: { memories: ['新'] } },
        }] },
      },
    },
  ],
};

for (const [label, normalize] of [
  ['client', normalizeClientState],
  ['server', normalizeServerState],
]) {
  const normalized = normalize(history);
  const oldAssistant = activeBranch(normalized.turns[0]).assistant;
  const currentAssistant = activeBranch(normalized.turns[1]).assistant;
  assert.equal('desk_slip' in oldAssistant, false, `${label} must not retain stale desk receipts`);
  assert.equal(currentAssistant.desk_slip.summary, '本轮上下文预览', `${label} must retain the current window desk receipt`);
  assert.deepEqual(currentAssistant.desk_slip.context.memories, ['新']);
}

let refreshCalls = 0;
const noop = () => undefined;
const actions = createChatActions({
  runtime: { generation: null, currentId: 'conversation-1', conversations: [] },
  ui: {},
  toast: noop,
  currentHistory: () => ({ turns: [] }),
  setHistory: noop,
  composerState: noop,
  renderMessages: noop,
  saveHistory: async () => undefined,
  generationDetail: () => '',
  generate: async () => undefined,
  send: async () => undefined,
  newConversation: async () => undefined,
  openRoomType: async () => undefined,
  refreshFromCoast: async () => { refreshCalls += 1; return true; },
  toggleMenu: noop,
  loadConversation: async () => undefined,
  renameConversation: async () => undefined,
  deleteConversation: async () => undefined,
});
await actions.handleAction('refresh', { dataset: {}, closest: () => null });
assert.equal(refreshCalls, 1, 'chat:refresh must invoke the canonical Coast refresh path exactly once');

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexSource = await readFile(resolve(rootDir, 'elementera-mcp/deploy-pages/index.html'), 'utf8');
const workerSource = await readFile(resolve(rootDir, 'elementera-mcp/deploy-pages/service-worker.js'), 'utf8');
assert.match(indexSource, /data-action="chat:refresh"[^>]*data-icon="refresh"/);
assert.ok(indexSource.includes(APP_CACHE_VERSION));
assert.ok(workerSource.includes(`const CACHE_NAME = '${APP_CACHE_NAME}';`));
assert.ok(workerSource.includes(APP_CACHE_VERSION));

console.log('shared-state-fixes: ok');
