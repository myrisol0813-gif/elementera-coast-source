import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  searchMatchesForConversation, CHAT_SEARCH_LIMITS, ChatSearchError,
} from '../functions/chat-search.js';
import {
  selectTreasureParagraphs, TREASURE_LIMITS, TreasureError,
} from '../functions/coast-vault-treasures.js';

const state = {
  turns: [
    {
      id: 'turn-1',
      user: { active: 1, variants: [
        { id: 'user-a', content: '用户说：阳光是书页', created_at: '2026-01-01' },
        { id: 'user-b', content: '第二种说法，没有关键词' },
      ] },
      assistant: { variantsByUserVariant: {
        0: [{ id: 'ai-a', content: '我把阳光的书页拾起来' },
            { id: 'ai-b', content: '重生成的另一段阳光' }],
        1: [{ id: 'ai-c', content: '当前回答，无命中' }],
      } },
    },
    {
      id: 'turn-2',
      user: { active: 0, variants: [
        { id: 'hidden', content: '阳光秘密', hidden: true },
      ] },
      assistant: { variantsByUserVariant: { 0: [] } },
    },
  ],
};
const row = { id: 'conversation-a', title: '阅读随笔', room_type: 'main', state_json: JSON.stringify(state) };
const found = searchMatchesForConversation(row, '阳光');
assert.equal(found.length, 3, 'only actual visible variants, not full JSON field keys');
assert.deepEqual(found.map(item => item.message_id), ['user-a', 'ai-a', 'ai-b']);
assert.equal(found[0].user_variant_index, 0);
assert.equal(found[2].assistant_variant_index, 1);
assert.equal(found[2].turn_id, 'turn-1');
assert.equal(found[2].role, 'assistant');
assert.equal(found[2].kind, 'message');
assert.ok(found.every(item => item.conversation_id === 'conversation-a'));
assert.equal(searchMatchesForConversation({ ...row, title: '阳光主题' }, '阳光').length, 4);
assert.equal(searchMatchesForConversation({ ...row, state_json: '{broken' }, '阳光').length, 0);
assert.ok(CHAT_SEARCH_LIMITS.page_results <= 50);

const all = selectTreasureParagraphs('第一段\n\n第二段\n\n第三段', null);
assert.equal(all.excerpt, '第一段\n\n第二段\n\n第三段');
assert.deepEqual(all.indices, []);
const picked = selectTreasureParagraphs('第一段\n\n第二段\n\n第三段', [2, 0]);
assert.equal(picked.excerpt, '第一段\n\n第三段');
assert.deepEqual(picked.indices, [0, 2]);
assert.throws(() => selectTreasureParagraphs('第一段\n\n第二段', [1, 1]), TreasureError);
assert.throws(() => selectTreasureParagraphs('第一段\n\n第二段', [3]), TreasureError);
assert.ok(TREASURE_LIMITS.note_chars >= 1000);

// Regression contracts: the new read APIs must not be silently added to
// the automatic memory/context assembly path.
const route = readFileSync(new URL('../functions/api-router.js', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../functions/chat-router.js', import.meta.url), 'utf8');
const media = readFileSync(new URL('../functions/coast-vault-media.js', import.meta.url), 'utf8');
const vaultApi = readFileSync(new URL('../functions/coast-vault-api.js', import.meta.url), 'utf8');
const pwa = readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/sidebar-search.js', import.meta.url), 'utf8');
assert.match(route, /isCoastVaultApiPath/);
assert.match(chat, /searchChatMessages/);
assert.match(chat, /pathname === '\/api\/chat\/search'/);
assert.match(media, /coast_voice_clips/);
assert.match(media, /chat_attachments/);
assert.doesNotMatch(media, /text-to-speech|ELEVENLABS_API_KEY/);
assert.match(vaultApi, /routeCoastVaultApi/);
assert.match(pwa, /openSearchResult/);
const treasureUi = readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-treasures.js', import.meta.url), 'utf8');
assert.match(treasureUi, /mediaChoices/);
assert.match(treasureUi, /paragraph_indices/);
assert.match(treasureUi, /'DELETE'/);
const chatRender = readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-render.js', import.meta.url), 'utf8');
const chatLoader = readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-conversations.js', import.meta.url), 'utf8');
const vaultUi = readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/vault.js', import.meta.url), 'utf8');
assert.match(chatRender, /treasureIndicators/, 'PWA heart buttons must use persisted server treasures');
assert.match(chatRender, /assistantSaved/, 'assistant saved state must be visible');
assert.match(chatRender, /userSaved/, 'user saved state must be visible');
assert.match(treasureUi, /refreshIndex/, 'saving a favorite must refresh its visible heart');
assert.match(chatLoader, /refreshTreasureIndex/, 'reloaded windows must refresh their saved heart state');
assert.match(vaultUi, /transferLegacyHearts/, 'old favorite migration is an explicit user option');
assert.match(vaultUi, /JSON 导出备份/, 'migration UI must request an owner backup');
assert.match(vaultUi, /confirm: true/, 'migration route must never run silently on page load');

console.log('coast vault & cross-window message search: ok');


// Live SQLite/D1 compatibility: test the real service, not just a mocked result.
const { D1Database } = await import('./d1-helper.mjs');
const { createConversation, writeConversationState, readConversationState, deleteConversation } = await import('../functions/chat-store.js');
const { uploadChatAttachment, bindChatAttachmentsToTurn } = await import('../functions/chat-attachments.js');
const { ensureVoiceSchema } = await import('../functions/voice-clips.js');
const { searchChatMessages } = await import('../functions/chat-search.js');
const { listMediaLibrary } = await import('../functions/coast-vault-media.js');
const {
  saveTreasure, listTreasures, updateTreasure, removeTreasure,
} = await import('../functions/coast-vault-treasures.js');
const { inspectLegacyHearts } = await import('../functions/coast-vault-legacy.js');

const db = new D1Database();
const conversation = await createConversation(db, '阳光与旧诗', 'main');
const upload = await uploadChatAttachment(db, conversation.id, {
  name: 'snow.png', type: 'image/png', size: 5,
  async arrayBuffer() { return Uint8Array.of(1, 2, 3, 4, 5).buffer; },
});
await writeConversationState(db, conversation.id, {
  version: 4,
  turns: [{
    id: 'turn-vault-1',
    user: { active: 0, variants: [{
      id: 'user-vault-1', content: '阳光就是被烧上天的书页。',
      attachments: [{ ...upload, id: upload.id, type: 'image', name: 'snow.png', mime: 'image/png', size: 5 }],
    }] },
    assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: {
      0: [{ id: 'assistant-vault-1', content: '我将书页留在档案里。', favorite: true }],
    } },
  }],
});
await bindChatAttachmentsToTurn(db, conversation.id, 'turn-vault-1', [upload.id]);
await ensureVoiceSchema(db);
await db.prepare(
  'INSERT INTO coast_voice_clips (id,conversation_id,turn_id,message_id,source,model_label,voice_id,text,audio_bytes,created_at) ' +
  'VALUES (?,?,?,?,?,?,?,?,?,?)'
).bind('voice-vault-1', conversation.id, 'turn-vault-1', 'assistant-vault-1',
  'manual', null, 'voice-demo', '晚风里有阳光', 3, Date.now()).run();
await db.prepare('INSERT INTO coast_voice_chunks (clip_id,chunk_index,body_b64) VALUES (?,?,?)')
  .bind('voice-vault-1', 0, 'AQID').run();

const searched = await searchChatMessages(db, { q: '书页' });
assert.equal(searched.results.filter(item => item.kind === 'message').length, 2);
assert.equal(searched.results.find(item => item.role === 'assistant').message_id, 'assistant-vault-1');
assert.equal(searched.next_cursor, null);

const catalog = await listMediaLibrary(db);
assert.equal(catalog.items.length, 2);
assert.deepEqual(new Set(catalog.items.map(item => item.kind)), new Set(['audio', 'image']));
const imageItem = catalog.items.find(item => item.kind === 'image');
assert.equal(imageItem.message_id, 'user-vault-1');
assert.equal(imageItem.favorited, false);
const audioItem = catalog.items.find(item => item.kind === 'audio');
assert.equal(audioItem.message_id, 'assistant-vault-1');
assert.match(audioItem.url, /voice\/clips/);

const textFavorite = await saveTreasure(db, {
  kind: 'text', conversation_id: conversation.id, source_id: 'user-vault-1',
  notes: '这是一段收藏备注',
});
assert.equal(textFavorite.excerpt, '阳光就是被烧上天的书页。');
const fileFavorite = await saveTreasure(db, {
  kind: 'image', conversation_id: conversation.id, source_id: upload.id,
  notes: '第一次查看文件',
});
assert.equal((await listTreasures(db, { q: '第一次查看文件' })).items[0].id, fileFavorite.id);
const scoped = await listTreasures(db, { conversation_id: conversation.id, turn_id: 'turn-vault-1' });
assert.equal(scoped.items.length, 2, 'scoped message sheet sees only this conversation turn');
assert.equal((await listTreasures(db, { conversation_id: conversation.id, turn_id: 'missing-turn' })).items.length, 0);
const afterSave = await listMediaLibrary(db, { kind: 'image' });
assert.equal(afterSave.items[0].favorited, true);
const modified = await updateTreasure(db, fileFavorite.id, { notes: '更新过的文件备注' });
assert.equal(modified.notes, '更新过的文件备注');
const afterCancel = await removeTreasure(db, fileFavorite.id);
assert.equal(afterCancel.media_deleted, false);
assert.equal((await listMediaLibrary(db, { kind: 'image' })).items[0].favorited, false);

const preview = await inspectLegacyHearts(db);
assert.equal(preview.dry_run, true);
assert.equal(preview.recognized, 1);
const applied = await inspectLegacyHearts(db, { apply: true });
assert.equal(applied.inserted, 1);
assert.equal((await inspectLegacyHearts(db, { apply: true })).inserted, 0);
assert.equal((await listTreasures(db, { q: '书页' })).items.length, 2);
assert.equal((await listTreasures(db, { q: '这是一段收藏备注' })).items[0].id, textFavorite.id);
const { executeModelTool, executeRegisteredTool, resolveToolSelection } =
  await import('../functions/tool-registry.js');
const vaultModelNames = resolveToolSelection({ permission: 'owner', surface: 'main_chat' })
  .modelVisibleTools.map(item => item.function.name);
assert.ok(vaultModelNames.includes('vault_search_index'));
assert.ok(vaultModelNames.includes('vault_read_selected'));

const vaultContext = {
  env: { COAST_CHAT_DB: db }, permission: 'owner', surface: 'main_chat',
  conversation_id: conversation.id, actor: 'model_partner',
};
const indexed = await executeModelTool(db, {
  id: 'vault-search-test',
  function: { name: 'vault_search_index', arguments: JSON.stringify({
    query: '这是一段收藏备注', limit: 2,
  }) },
}, vaultContext);
assert.equal(indexed.count, 1);
assert.deepEqual(indexed.results.map(item => item.id), [textFavorite.id]);
assert.equal(indexed.results[0].notes_preview, '这是一段收藏备注');
assert.equal(Object.hasOwn(indexed.results[0], 'content'), false,
  'search stage must not return saved full content');

// Two-stage directory results must allow walking past the first bounded page
// without returning full treasured text to the model.
const firstVaultPage = await executeModelTool(db, {
  id: 'vault-paging-first',
  function: { name: 'vault_search_index', arguments: JSON.stringify({
    query: '书页', limit: 1, cursor: 0,
  }) },
}, vaultContext);
assert.equal(firstVaultPage.count, 1);
assert.equal(firstVaultPage.has_more, true);
assert.equal(firstVaultPage.next_cursor, '1');
const secondVaultPage = await executeModelTool(db, {
  id: 'vault-paging-next',
  function: { name: 'vault_search_index', arguments: JSON.stringify({
    query: '书页', limit: 1, cursor: 1,
  }) },
}, vaultContext);
assert.equal(secondVaultPage.count, 1);
assert.equal(secondVaultPage.next_cursor, null);
assert.notEqual(firstVaultPage.results[0].id, secondVaultPage.results[0].id);
await assert.rejects(() => executeRegisteredTool(db, 'vault.search',
  { query: '书页', cursor: -2 }, vaultContext), /游标/);

const selectedRead = await executeModelTool(db, {
  id: 'vault-read-test',
  function: { name: 'vault_read_selected', arguments: JSON.stringify({
    ids: [textFavorite.id, fileFavorite.id],
  }) },
}, vaultContext);
assert.equal(selectedRead.requested_count, 2);
assert.equal(selectedRead.count, 1, 'removed favorite is not silently recreated');
assert.equal(selectedRead.items[0].content, '阳光就是被烧上天的书页。');
assert.equal(selectedRead.items[0].notes, '这是一段收藏备注');
assert.equal(selectedRead.items[1].available, false);
await assert.rejects(() => executeRegisteredTool(db, 'vault.search',
  { query: '书页' }, { permission: 'visitor', surface: 'mailbox_visitor', visitorId: 'visitor-a' }),
  /当前房间|权限/);
await assert.rejects(() => executeRegisteredTool(db, 'vault.read',
  { ids: [textFavorite.id, textFavorite.id] }, vaultContext), /重复/);
const { listToolRuns } = await import('../functions/tool-run-log.js');
const recordedVault = (await listToolRuns(db)).filter(item => item.tool_key.startsWith('vault.'));
assert.ok(recordedVault.length >= 2);
assert.doesNotMatch(JSON.stringify(recordedVault), /极光就是被烧上天的书页|这是一段收藏备注/,
  'tool logs may not contain private treasure content');
const autoMemory = readFileSync(new URL('../functions/memory-recall.js', import.meta.url), 'utf8');
assert.doesNotMatch(autoMemory, /coast-vault-model-tools|vault_read_selected|vault_search_index/,
  'treasures must be available only on explicit model tool calls');

const { exportCoastVault } = await import('../functions/snapshot-api.js');
const vaultSnapshot = await exportCoastVault(db);
assert.equal(vaultSnapshot.basic_media.count, 2, 'global snapshot includes both persisted media');
assert.equal(vaultSnapshot.treasures.count, 2, 'global snapshot includes selected text/old hearts');
assert.equal(vaultSnapshot.treasures.complete, true);
const settingsExport = readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/settings.js', import.meta.url), 'utf8');
assert.match(settingsExport, /snapshot\.coast_vault/, 'global HTML must render vault snapshot as well');
const { saveSoilSnapshot } = await import('../functions/memory-store.js');
await saveSoilSnapshot(db, conversation.id, {
  turn_id: 'turn-vault-1',
  assistant: { id: 'assistant-vault-1', model_id: 'test-model' },
}, {
  current_text: '旧思维壤第一段\\n\\n旧思维壤第二段'.replaceAll('\\n', '\n'),
  afterthoughts: ['余思此刻值得珍藏'],
  revision: 1,
  display_author: 'test-model',
});
const soilFavorite = await saveTreasure(db, {
  kind: 'soil', conversation_id: conversation.id, source_id: 'assistant-vault-1',
  paragraph_indices: [1, 2], notes: '旧土层索引',
});
assert.equal(soilFavorite.excerpt, '旧思维壤第二段\n\n余思此刻值得珍藏');
assert.deepEqual(soilFavorite.paragraph_indices, [1, 2]);
assert.equal(soilFavorite.turn_id, 'turn-vault-1');
assert.equal(soilFavorite.message_id, 'assistant-vault-1');
assert.equal((await listTreasures(db, { q: '旧土层索引', kind: 'soil' })).items[0].id, soilFavorite.id);
const readSoilTreasure = await executeRegisteredTool(db, 'vault.read', {
  ids: [soilFavorite.id],
}, vaultContext);
assert.equal(readSoilTreasure.items[0].content, '旧思维壤第二段\n\n余思此刻值得珍藏');
assert.equal(readSoilTreasure.items[0].notes, '旧土层索引');
const fromSoilIndex = await executeRegisteredTool(db, 'vault.search', {
  query: '旧土层索引', kind: 'soil',
}, vaultContext);
assert.equal(fromSoilIndex.results[0].kind, 'soil');

// A removed conversation must not remain searchable through saved excerpts.
await deleteConversation(db, conversation.id);
assert.equal((await listTreasures(db)).items.length, 0, 'deleted chat stays hidden from treasure shelves');
assert.equal((await listTreasures(db, { q: '书页' })).items.length, 0);
await assert.rejects(() => updateTreasure(db, textFavorite.id, { notes: '不可复活已删窗口' }), TreasureError);
assert.equal((await removeTreasure(db, textFavorite.id)).removed, false,
  'deleted chat treasures cannot be mutated by the normal owner shelf endpoint');
const chatFeature = readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat.js', import.meta.url), 'utf8');
const chatRenderPreview = readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-render.js', import.meta.url), 'utf8');
const chatActionsPreview = readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-actions.js', import.meta.url), 'utf8');
const chatConversationsPreview = readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-conversations.js', import.meta.url), 'utf8');
const chatTreasuresPreview = readFileSync(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-treasures.js', import.meta.url), 'utf8');
assert.match(chatFeature, /runtime\.searchPreview\.set\(hit\.conversation_id, state\)/,
  'a historical search must put an inactive variant into transient preview only');
assert.doesNotMatch(chatFeature, /setHistory\(hit\.conversation_id, state\)/,
  'a search must not replace canonical history before the next send');
assert.match(chatRenderPreview, /preview \|\| runtime\.histories\.get/,
  'preview is only a presentation layer');
assert.match(chatRenderPreview, /chat:end-search-preview/,
  'a user can return to canonical active branch before sending');
assert.match(chatActionsPreview, /runtime\.searchPreview\?\.has\(runtime\.currentId\)/,
  'sending and edits are blocked while an old branch is being previewed');
assert.match(chatActionsPreview, /runtime\.searchPreview\?\.get\(runtime\.currentId\) \|\| currentHistory\(\)/,
  'copying a historical message must copy the displayed version');
assert.match(chatTreasuresPreview, /runtime\.searchPreview\?\.get\(conversationId\) \|\| currentHistory\(\)/,
  'saving a historical favorite uses the displayed original variant ID');
assert.match(chatConversationsPreview, /runtime\.searchPreview\?\.clear\(\)/,
  'opening another room ends transient preview without writing it');

// Two independent imported chat windows may reuse provider-generated message IDs.
// A favorite must remain in its original window rather than silently stealing
// the other window's entry or overwriting its notes.
const sameIdChats = [];
for (const title of ['导入窗口一', '导入窗口二']) {
  const item = await createConversation(db, title, 'main');
  await writeConversationState(db, item.id, {
    version: 4, turns: [{
      id: 'same-imported-turn-id',
      user: { active: 0, variants: [{ id: 'same-imported-user-id', content: title }] },
      assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: {
        0: [{ id: 'same-imported-assistant-id', content: '共享 ID，但各自独立：' + title, favorite: true }],
      } },
    }],
  });
  const favorite = await saveTreasure(db, { kind: 'text', conversation_id: item.id,
    source_id: 'same-imported-user-id', notes: title + '的备注' });
  assert.equal(favorite.conversation_id, item.id);
  assert.equal(favorite.excerpt, title);
  sameIdChats.push({ conversation: item, favorite });
}
assert.notEqual(sameIdChats[0].favorite.id, sameIdChats[1].favorite.id,
  'same message ID in different chat windows must produce different treasures');
assert.equal((await listTreasures(db, { q: '导入窗口' })).items.length, 2);
assert.equal((await listTreasures(db, { conversation_id: sameIdChats[0].conversation.id }))
  .items[0].notes, '导入窗口一的备注');
assert.equal((await listTreasures(db, { conversation_id: sameIdChats[1].conversation.id }))
  .items[0].notes, '导入窗口二的备注');
assert.equal((await inspectLegacyHearts(db, { apply: true })).inserted, 2,
  'old assistant favorites also use conversation-scoped IDs');
assert.equal((await inspectLegacyHearts(db, { apply: true })).inserted, 0,
  'repeating legacy migration must stay idempotent across imported windows');

// Full preservation takes precedence over truncating a legacy heart in silence.
const longLegacyConversation = await createConversation(db, '超长旧红心', 'main');
const longLegacyBody = '旧'.repeat(12001);
await writeConversationState(db, longLegacyConversation.id, {
  version: 4, turns: [{
    id: 'long-legacy-turn',
    user: { active: 0, variants: [{ id: 'long-user', content: '保留旧话' }] },
    assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: {
      0: [{ id: 'long-assistant', content: longLegacyBody, favorite: true }],
    } },
  }],
});
const longPreview = await inspectLegacyHearts(db);
assert.equal(longPreview.oversized, 1, 'preview must identify a heart longer than excerpt limit');
const longApplied = await inspectLegacyHearts(db, { apply: true });
assert.equal(longApplied.oversized, 1, 'apply must not silently truncate long original');
assert.equal(longApplied.inserted, 0, 'oversized originals need explicit separate selection');
assert.equal((await readConversationState(db, longLegacyConversation.id))
  .turns[0].assistant.variantsByUserVariant['0'][0].content.length, 12001);
assert.equal((await listTreasures(db, { conversation_id: longLegacyConversation.id }))
  .items.length, 0, 'original remains in chat rather than creating a truncated treasure');

console.log('coast vault SQLite integration: ok');
