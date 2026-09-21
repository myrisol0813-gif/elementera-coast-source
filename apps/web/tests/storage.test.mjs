import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';

const testDir = dirname(fileURLToPath(import.meta.url));
const storageFile = resolve(testDir, '../elementera-mcp/deploy-pages/public/core/storage.js');
const window = new Window({ url: 'http://coast.test/' });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: window.localStorage });

const ACTIVE_RUN_KEYS = [
  'recentTurns', 'contextBudget', 'outputLength', 'maxOutputTokens', 'creativity',
  'streamingEnabled', 'soilBudget', 'seedCooldownTurns', 'worldbookEnabled',
  'worldbookLimit', 'memoryLimit',
];

localStorage.setItem('coast_main_active_v097', 'old-window');
localStorage.setItem('coast_main_windows_v097', JSON.stringify([
  { id: 'old-window', title: '旧窗口', messages: [{ role: 'user', content: '旧问题' }, { role: 'assistant', content: '旧回答' }] },
]));
localStorage.setItem('ec.chat.state.v3.old-window', JSON.stringify({
  version: 3,
  turns: [{
    id: 'old-turn',
    user: { active: 0, variants: [{ id: 'old-user', content: '结构化旧问题' }] },
    assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: { 0: [{ id: 'old-assistant', content: '结构化旧回答' }] } },
  }],
}));
localStorage.setItem('gpt_like_shell_theme_clean_v1', 'gold');
localStorage.setItem('cw_name', '迁移中的屋主');
localStorage.setItem('cs_system', '退役系统草稿');
localStorage.setItem('cs_portrait', '退役 Model Partner 画像');
localStorage.setItem('elementera.runControlSettings', JSON.stringify({
  streamingEnabled: true,
  memoryLimit: 5,
  maxHandSeeds: 99,
  conversationSeedLimit: 99,
  globalMemoryLimit: 99,
}));
localStorage.setItem('coast_lighthouse_draft_v095', JSON.stringify({ text: '历史 MCP 对话区草稿' }));

const { createStorage } = await import(`${pathToFileURL(storageFile).href}?test=${Date.now()}`);
const storage = createStorage();
assert.equal(storage.read().preferences.theme, 'gold');
assert.equal(storage.read().preferences.ownerName, '迁移中的屋主');
assert.equal(storage.read().preferences.ownerSignature, '迁移中的屋主');
assert.deepEqual(Object.keys(storage.read().preferences).sort(), ['accent', 'theme', 'userBubble', 'ownerName', 'ownerSignature'].sort());
assert.equal(storage.migrationPending, true);
assert.equal(storage.migrationConversations.length, 1);
assert.equal(storage.migrationConversations[0].id, 'old-window');
assert.equal(storage.migrationConversations[0].state.turns[0].user.variants[0].content, '结构化旧问题');
assert.equal(storage.read().rooms.lighthouse.rooms[0].messages[0].text, '历史 MCP 对话区草稿');
assert.deepEqual(Object.keys(storage.read().runControl), ACTIVE_RUN_KEYS);
assert.equal(storage.read().runControl.streamingEnabled, true);
assert.equal(storage.read().runControl.memoryLimit, 5);
for (const retired of ['maxHandSeeds', 'conversationSeedLimit', 'globalSeedLimit', 'conversationMemoryLimit', 'globalMemoryLimit', 'autoRefreshEveryTurns']) {
  assert.equal(retired in storage.read().runControl, false, `${retired} must not survive active storage`);
}
assert.equal(storage.read().version, 2);
assert.deepEqual(storage.read().daily.cache.moments, []);
assert.equal('legacyStatus' in storage.read().daily, false);
assert.equal('legacyDrafts' in storage.read().daily, false);
assert.equal('legacyCache' in storage.read().daily, false);

const persistedBeforeComplete = JSON.parse(localStorage.getItem('elementera.local.v1'));
assert.equal(persistedBeforeComplete.preferences.systemDraft, undefined);
assert.equal(persistedBeforeComplete.preferences.modelPartnerPortrait, undefined);
assert.equal(persistedBeforeComplete.runControl.maxHandSeeds, undefined);

storage.completeMigration();
assert.equal(localStorage.getItem('coast_main_windows_v097'), null);
assert.equal(localStorage.getItem('ec.chat.state.v3.old-window'), null);
assert.equal(localStorage.getItem('gpt_like_shell_theme_clean_v1'), null);
assert.equal(localStorage.getItem('cs_system'), null);
assert.equal(localStorage.getItem('cs_portrait'), null);
assert.equal(localStorage.getItem('elementera.runControlSettings'), null);
assert.equal(localStorage.getItem('coast_lighthouse_draft_v095'), null);
assert.equal(JSON.parse(localStorage.getItem('elementera.local.v1')).migration.pending, false);

localStorage.clear();
localStorage.setItem('elementera.local.v1', JSON.stringify({
  version: 1,
  preferences: {
    theme: 'light',
    ownerName: '旧资料名',
    systemDraft: '不要写回',
    assistantBubble: 'gold',
    modelPartnerPortrait: '不要写回',
    modelPartnerNote: '不要写回',
    ownerAvatar: 'data:image/png;base64,OLD',
  },
  runControl: {
    recentTurns: 4,
    maxHandSeeds: 3,
    conversationMemoryLimit: 2,
  },
  daily: {
    momentCover: 'data:image/png;base64,COVER',
    moments: [{ id: 'old-moment', date: '2026-07-28', text: '本机碳硅圈草稿', image: 'data:image/png;base64,MOMENT', createdAt: 100 }],
    diaries: [{ id: 'old-diary', date: '2026-07-28', text: '旧日记', updatedAt: 200 }],
    albumItems: [{ id: 'old-album', url: 'https://private.invalid/image' }],
    summaries: [{ id: 'old-summary', date: '2026-07-28', text: '旧总结', updatedAt: 300 }],
    legacyStatus: 'pending',
    legacyDrafts: { secret: 'retired' },
  },
  migration: { pending: false, profile: null },
}));
const secondModule = await import(`${pathToFileURL(storageFile).href}?hard-clean=${Date.now()}`);
const migrated = secondModule.createStorage();
assert.equal(migrated.read().version, 2);
assert.equal(migrated.read().preferences.ownerName, '旧资料名');
assert.equal(migrated.read().preferences.ownerSignature, '旧资料名');
assert.deepEqual(Object.keys(migrated.read().runControl), ACTIVE_RUN_KEYS);
assert.equal(migrated.read().runControl.recentTurns, 4);
assert.equal(migrated.read().runControl.maxHandSeeds, undefined);
assert.deepEqual(migrated.read().daily.cache.moments, [], 'retired top-level Daily payload must not become active cache');
assert.deepEqual(migrated.read().daily.cache.diaries, []);
assert.equal(migrated.read().daily.momentCover, 'data:image/png;base64,COVER');
const persisted = JSON.parse(localStorage.getItem('elementera.local.v1'));
assert.equal(persisted.preferences.systemDraft, undefined);
assert.equal(persisted.preferences.ownerAvatar, undefined);
assert.equal(persisted.daily.summaries, undefined);
assert.equal(persisted.daily.albumItems, undefined);
assert.equal(persisted.daily.legacyDrafts, undefined);
assert.equal(persisted.daily.legacyStatus, undefined);

console.log('storage: ok');
