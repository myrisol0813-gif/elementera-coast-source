import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createConversation, readConversationState, writeConversationState, writeProfile } from '../functions/chat-store.js';
import {
  clipGeneratedTitle,
  estimateContextTokens,
  formalChatRequestSettings,
  landingRequestSettings,
  routeChatApi,
} from '../functions/chat-router.js';
import { trimContextToComfortRange } from '../functions/context-comfort-range.js';
import { soilSettings } from '../functions/memory-config.js';
import { routeMemoryApi } from '../functions/memory-router.js';
import {
  deleteEntryVector,
  detectEmbeddingDimensions,
  embeddingText,
  syncEntryVector,
  vectorStatus,
} from '../functions/embedding.js';
import { buildMemoryContext, formatMemoryContext, searchMemory } from '../functions/memory-recall.js';
import {
  createPocket,
  createEntry,
  deletePocket,
  deleteEntry,
  getPocket,
  listEntries,
  listPockets,
  normalizePocketCandidates,
  patchEntry,
  patchPocket,
  pocketFingerprint,
  readSoil,
  resolvePocket,
  upsertSoilPocketCandidates,
  writeSoil,
} from '../functions/memory-store.js';

class D1Statement {
  constructor(database, sql, params = []) { this.database = database; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.database, this.sql, params); }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
  async first() { return this.database.prepare(this.sql).get(...this.params) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.params) }; }
}

class D1Database {
  constructor() { this.database = new DatabaseSync(':memory:'); }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

const db = new D1Database();
const conversationA = await createConversation(db, 'A');
const conversationB = await createConversation(db, 'B');
const conversationC = await createConversation(db, 'C');
const conversationD = await createConversation(db, 'D');

assert.equal(estimateContextTokens('海岸'), 2);
assert.equal(estimateContextTokens('coast'), 2);
assert.equal(clipGeneratedTitle('一二三四五六七八九十十一十二十三'), '一二三四五六七八九十十一');
assert.equal(landingRequestSettings({ outputLength: 'short', max_tokens: 100 }).max_tokens, 700);
assert.equal(landingRequestSettings({ outputLength: 'short', max_tokens: 9999 }).max_tokens, 700);
assert.equal(landingRequestSettings({ outputLength: 'auto', max_tokens: 600 }).max_tokens, null);
assert.equal(landingRequestSettings({ outputLength: 'long', max_tokens: 9999 }).max_tokens, null);
assert.equal(formalChatRequestSettings({ outputLength: 'short', max_tokens: 350 }).max_tokens, 700);
assert.equal(formalChatRequestSettings({ outputLength: 'auto', max_tokens: 600 }).max_tokens, null);
assert.equal(formalChatRequestSettings({ outputLength: 'long', max_tokens: 1200 }).max_tokens, null);
assert.equal(formalChatRequestSettings({ max_tokens: 80 }).max_tokens, 80, 'low-level callers without an output preference keep their explicit budget');
const comfortable = trimContextToComfortRange({
  basePrompt: 'You are the Elementera Coast demo assistant。',
  soilText: `【整理当前对话的纸条】\n当前：${'潮'.repeat(1200)}`,
  memoryItems: Array.from({ length: 10 }, (_, index) => `低相关旧纸条 ${index} ${'记'.repeat(400)}`),
  worldbookItems: Array.from({ length: 6 }, (_, index) => `词典 ${index} ${'词'.repeat(300)}`),
  messages: [
    { role: 'user', content: '旧'.repeat(300) },
    { role: 'assistant', content: 'a'.repeat(2000) },
    { role: 'user', content: '当前输入' },
  ],
  recentTurns: 8,
  maxTokens: 1800,
});
assert.deepEqual(comfortable.modelMessages.at(-1), { role: 'user', content: '当前输入' });
assert.equal(comfortable.currentUserPreserved, true);
assert.ok(comfortable.trimmedCount > 0, '超过舒服区间时应裁掉低相关旧纸条');
assert.deepEqual(soilSettings({ autoRefreshEveryTurns: 99, maxHandSeeds: 0 }), {
  autoRefreshEveryTurns: 12,
  maxHandSeeds: 1,
  soilBudget: 1200,
});

const structuredCandidates = normalizePocketCandidates([{
  candidate_id: 'coast-return',
  title: '回潮后的未竟方向',
  life_core: '暂时不沿这条路走，但它仍能长出新的理解。',
  content: '把相关的两段对话压缩保留在这里。',
  usage_hint: '再次谈到回潮与选择时触碰。',
  avoid_hint: '不要把它当作已经确认的长期记忆。',
  source_refs: [{ turn_id: 'turn-structured', role: 'turn' }],
  source_excerpt: '那条路暂时放下，但没有死去。',
}]);
assert.deepEqual(structuredCandidates[0], {
  candidate_id: 'coast-return',
  title: '回潮后的未竟方向',
  life_core: '暂时不沿这条路走，但它仍能长出新的理解。',
  content: '把相关的两段对话压缩保留在这里。',
  usage_hint: '再次谈到回潮与选择时触碰。',
  avoid_hint: '不要把它当作已经确认的长期记忆。',
  source_refs: [{ turn_id: 'turn-structured', role: 'turn' }],
  source_excerpt: '那条路暂时放下，但没有死去。',
});
const legacyCandidates = normalizePocketCandidates(['旧壤里的一句话']);
assert.equal(legacyCandidates[0].title, '旧壤里的一句话');
assert.equal(legacyCandidates[0].life_core, '旧壤里的一句话');
assert.equal(legacyCandidates[0].content, '旧壤里的一句话');
assert.deepEqual(legacyCandidates[0].source_refs, []);

const originalA = await readSoil(db, conversationA.id);
const originalB = await readSoil(db, conversationB.id);
assert.equal(originalA.current_text, '');
assert.equal(originalB.current_text, '');

const seeds = Array.from({ length: 10 }, (_, index) => ({
  name: `种子 ${index}`,
  life_core: `生命核 ${index}`,
  usage_hint: '需要时使用',
  avoid_hint: '不要复读',
}));
const writtenA = await writeSoil(db, conversationA.id, {
  current_text: '只属于窗口 A',
  hand_seeds: seeds,
  do_not_repeat: '已经确认',
  pocket_candidates: ['候选一'],
});
assert.equal(writtenA.hand_seeds.length, 7, 'thought soil must cap hand seeds at seven');
assert.equal(writtenA.pocket_candidates[0].life_core, '候选一');
assert.equal(writtenA.manual_locked, true);
assert.equal((await readSoil(db, conversationB.id)).current_text, '', 'conversation soils must not cross windows');
db.database.prepare('UPDATE conversation_soils SET pocket_candidates_json = ? WHERE conversation_id = ?')
  .run(JSON.stringify(['来自旧 D1 的 string candidate']), conversationA.id);
const legacySoil = await readSoil(db, conversationA.id);
assert.equal(legacySoil.pocket_candidates[0].title, '来自旧 D1 的 string candidate');
assert.equal(legacySoil.pocket_candidates[0].usage_hint, '');
await assert.rejects(
  () => writeSoil(db, conversationA.id, { current_text: 'automatic overwrite' }, { automatic: true }),
  (error) => error.type === 'soil_locked' && error.status === 409,
);

const noVectorEnv = { COAST_CHAT_DB: db };

await assert.rejects(
  () => createPocket(db, {
    conversation_id: conversationA.id,
    source_type: 'message',
    source_text: '旧长按原文入口必须失效',
  }),
  (error) => error.type === 'invalid_source_type' && error.status === 400,
);

const autoCandidate = {
  candidate_id: 'sleeping-tide-drawer',
  title: '潮汐钥匙',
  life_core: '潮汐钥匙来自整理当前对话的纸条候选，只能先进入待确认区。',
  content: 'Memory v2 只保留 soil/turn candidate，不保存长按 active variant 原文。',
  usage_hint: '再次谈到潮汐钥匙时使用',
  avoid_hint: '不要把 pending 当成已确认记忆',
  source_refs: [{ turn_id: 'auto-turn-1', role: 'turn' }],
  source_excerpt: '这部分先放下，之后也许还会发芽。',
};
const expectedFingerprint = await pocketFingerprint(conversationC.id, autoCandidate.life_core);
const firstAutoUpsert = await upsertSoilPocketCandidates(db, conversationC.id, [autoCandidate]);
assert.equal(firstAutoUpsert.created, 1, 'a soil candidate must automatically create one pending pocket');
let pendingC = await listPockets(db, { conversation_id: conversationC.id, status: 'pending' });
assert.equal(pendingC.length, 1);
assert.equal(pendingC[0].fingerprint, expectedFingerprint);
assert.equal(pendingC[0].source_type, 'soil');
assert.equal(pendingC[0].source_refs[0].turn_id, 'auto-turn-1');
const pendingRecall = await buildMemoryContext(noVectorEnv, 'owner', conversationC.id, '潮汐钥匙', { conversation_turns: 8 });
assert.deepEqual(pendingRecall.items, [], 'pending pockets must never participate in recall');
assert.deepEqual(pendingRecall.selected_ids, []);

const seedResult = await resolvePocket(db, pendingC[0].id, {
  action: 'seed',
  tag: '工程技术',
  title: '潮汐钥匙',
  life_core: '潮汐钥匙已经由屋主确认进入种子库。',
});
assert.equal(seedResult.pocket.status, 'confirmed');
assert.equal(seedResult.entry.entry_type, 'seed');
assert.equal(seedResult.entry.scope, 'global');
assert.equal(seedResult.entry.conversation_id, null);
assert.equal(seedResult.entry.tag, '工程技术');
const confirmedRepeat = await upsertSoilPocketCandidates(db, conversationC.id, [autoCandidate]);
assert.equal(confirmedRepeat.suppressed, 1, 'resolved soil candidate must not bounce back into pending');

const memoryCandidate = {
  ...autoCandidate,
  candidate_id: 'memory-candidate',
  title: '回潮记忆',
  life_core: '回潮记忆被确认后进入统一记忆库。',
};
const memoryUpsert = await upsertSoilPocketCandidates(db, conversationC.id, [memoryCandidate]);
await assert.rejects(
  () => resolvePocket(db, memoryUpsert.pockets[0].id, { action: 'memory' }),
  (error) => error.type === 'invalid_memory_tag' && error.status === 400,
  'memory/seed confirmation must carry one of the six Memory v2 tags',
);
const memoryResult = await resolvePocket(db, memoryUpsert.pockets[0].id, {
  action: 'memory',
  tag: '历史锚点',
  title: '回潮记忆',
  life_core: '回潮记忆被确认后进入统一记忆库。',
});
assert.equal(memoryResult.entry.entry_type, 'memory');
assert.equal(memoryResult.entry.scope, 'global');
assert.equal(memoryResult.entry.tag, '历史锚点');

const discardedCandidate = { ...autoCandidate, candidate_id: 'discard-once', life_core: '只出现一次后被明确丢弃', title: '不再弹回' };
const discardedUpsert = await upsertSoilPocketCandidates(db, conversationC.id, [discardedCandidate]);
await resolvePocket(db, discardedUpsert.pockets[0].id, { action: 'discard' });
const discardedRepeat = await upsertSoilPocketCandidates(db, conversationC.id, [discardedCandidate]);
assert.equal(discardedRepeat.suppressed, 1);

const firstRecall = await buildMemoryContext(noVectorEnv, 'owner', conversationA.id, '潮汐钥匙', { conversation_turns: 8 });
assert.ok(firstRecall.items.some((entry) => entry.id === seedResult.entry.id));
assert.equal(Object.hasOwn(firstRecall, 'conversation_seeds'), false);
assert.equal(Object.hasOwn(firstRecall, 'global_seeds'), false);
assert.equal(Object.hasOwn(firstRecall, 'conversation_pockets'), false);
assert.equal(Object.hasOwn(firstRecall, 'global_pockets'), false);
assert.match(formatMemoryContext(firstRecall), /【相关记忆】/);
const explicitSearch = await searchMemory(noVectorEnv, 'owner', { query: '潮汐钥匙', limit: 8 });
assert.ok(explicitSearch.entries.some((entry) => entry.id === seedResult.entry.id));

const vectorCalls = { upserts: [], deletes: [], queries: [] };
const fakeAi = {
  async run(model, input) {
    assert.equal(model, '@cf/baai/bge-m3');
    return { data: input.text.map(() => [0.1, 0.2, 0.3, 0.4, 0.5]) };
  },
};
const fakeVector = {
  async upsert(vectors) { vectorCalls.upserts.push(...vectors); },
  async deleteByIds(ids) { vectorCalls.deletes.push(...ids); },
  async query(_values, options) { vectorCalls.queries.push(options); return { matches: [] }; },
};
const vectorEnv = { COAST_CHAT_DB: db, AI: fakeAi, COAST_MEMORY_VECTOR: fakeVector };
assert.equal(await detectEmbeddingDimensions(vectorEnv), 5, 'embedding dimensions must come from the actual response shape');
const confirmed = await createEntry(db, {
  entry_type: 'memory',
  title: '向量家具',
  life_core: '只有已确认 memory / seed 才建立索引',
  content: '更新后需要重新 upsert',
  tag: '工程技术',
  source_ref: { private_chat_text: '不能拼进 embedding' },
});
assert.equal(vectorCalls.upserts.length, 0, 'D1 writes do not implicitly index pending or confirmed data');
assert.equal(embeddingText(confirmed).includes('private_chat_text'), false, 'source references cannot enter embedding text');
const indexed = await syncEntryVector(vectorEnv, db, confirmed);
assert.equal(indexed.entry.embedding_status, 'ready');
assert.equal(indexed.dimensions, 5);
assert.equal(vectorCalls.upserts.length, 1);
const deletedConfirmed = await deleteEntry(db, confirmed.id);
await deleteEntryVector(vectorEnv, deletedConfirmed);
assert.deepEqual(vectorCalls.deletes, [confirmed.id], 'soft deletion must remove the derived entry vector');
const status = await vectorStatus(vectorEnv);
assert.equal(status.detected_dimensions, 5);
assert.equal(status.index_ready, true);

const deletablePending = await createPocket(db, {
  conversation_id: conversationC.id,
  source_type: 'turn',
  source_ref: { conversation_id: conversationC.id, turn_id: 'delete-pocket', role: 'turn' },
  source_text: '待确认候选仍可从待确认区删除',
});
const deletePocketResponse = await routeMemoryApi(new Request(`https://coast.test/api/memory/pockets/${deletablePending.id}`, {
  method: 'DELETE',
  headers: { Origin: 'https://coast.test' },
}), vectorEnv);
assert.equal(deletePocketResponse.status, 200);
const deletePocketData = await deletePocketResponse.json();
assert.equal(deletePocketData.deleted, true);
assert.equal(vectorCalls.deletes.length, 1, 'deleting a pending pocket must not touch Vectorize');

const originalFetch = globalThis.fetch;
let providerPayload = null;
let providerContent = '带着轻量上下文回答。';
let providerFinishReason = 'stop';
let providerStatus = 200;
let providerChatCalls = 0;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.includes('/api/v1/models')) {
    return new Response(JSON.stringify({ data: [
      {
        id: 'openai/gpt-4.1-nano',
        name: 'GPT-4.1 Nano',
        architecture: { output_modalities: ['text'] },
        supported_parameters: ['temperature'],
        pricing: { prompt: '0.1', completion: '0.2' },
      },
      {
        id: 'openai/gpt-5.1',
        name: 'GPT-5.1',
        architecture: { output_modalities: ['text'] },
        supported_parameters: ['response_format', 'reasoning'],
        pricing: { prompt: '0.2', completion: '0.4' },
      },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/api/v1/chat/completions')) {
    providerChatCalls += 1;
    providerPayload = JSON.parse(options.body);
    if (providerStatus !== 200) {
      return new Response(JSON.stringify({ error: { message: 'provider unavailable' } }), { status: providerStatus, headers: { 'Content-Type': 'application/json' } });
    }
    const content = Array.isArray(providerContent) ? providerContent.shift() : providerContent;
    const finishReason = Array.isArray(providerFinishReason) ? providerFinishReason.shift() : providerFinishReason;
    return new Response(JSON.stringify({
      model: providerPayload.model,
      choices: [{ message: { content }, finish_reason: finishReason }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`unexpected fetch: ${url}`);
};
const chatResponse = await routeChatApi(new Request('https://coast.test/api/chat', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    conversation_id: conversationA.id,
    model: 'openai/gpt-4.1-nano',
    messages: [{ role: 'user', content: '潮汐钥匙' }],
    settings: { recentTurns: 2, contextBudget: 2000, conversationSeedLimit: 3, globalSeedLimit: 1, max_tokens: 80, temperature: 0.2 },
  }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const chatData = await chatResponse.json();
assert.equal(chatResponse.status, 200);
assert.equal(providerPayload.messages[0].role, 'system');
assert.match(providerPayload.messages[0].content, /整理当前对话的纸条/);
assert.match(providerPayload.messages[0].content, /【相关记忆】/);
assert.match(providerPayload.messages[0].content, /潮汐钥匙/);
assert.doesNotMatch(providerPayload.messages[0].content, /上下文目录|海岸环境|记忆球｜当前情境面/);
assert.deepEqual(providerPayload.messages.at(-1), { role: 'user', content: '潮汐钥匙' });
assert.ok(chatData.memory.selected_entry_ids.length > 0);
assert.equal(typeof chatData.desk_slip?.summary, 'string');
assert.equal(Object.hasOwn(chatData, 'context'), false, '聊天 API 不应再返回旧预算 / trace 报告');

const naturalLongReply = '这是一段由模型自行决定长度的回复。'.repeat(1500);
providerContent = naturalLongReply;
providerFinishReason = 'length';
const normalFloorResponse = await routeChatApi(new Request('https://coast.test/api/chat', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    conversation_id: conversationA.id,
    model: 'openai/gpt-4.1-nano',
    messages: [{ role: 'user', content: '请完整回答。' }],
    settings: { outputLength: 'auto', max_tokens: 600, maxOutputTokens: 8000, temperature: 0.2 },
  }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const normalFloorData = await normalFloorResponse.json();
assert.equal(normalFloorResponse.status, 200);
assert.equal(providerPayload.max_completion_tokens, 8000, 'natural output must send the configured application ceiling');
assert.equal('max_tokens' in providerPayload, false);
assert.equal(normalFloorData.max_tokens, null);
assert.equal(normalFloorData.finish_reason, 'length');
assert.equal(normalFloorData.message.content, naturalLongReply, 'the formal route must not slice a long provider response');

providerContent = '我已经完整读完这封登岛信。';
providerFinishReason = 'length';
const landingResponse = await routeChatApi(new Request('https://coast.test/api/chat/landing-letter', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    conversation_id: conversationB.id,
    model: 'openai/gpt-4.1-nano',
    letter_text: '请把这封登岛信当作当前窗口的第一轮开场。',
    settings: { outputLength: 'auto', max_tokens: 600, maxOutputTokens: 8000, temperature: 0.2 },
  }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const landingData = await landingResponse.json();
assert.equal(landingResponse.status, 200);
assert.equal(providerPayload.max_completion_tokens, 8000, 'landing natural output must use the configured application ceiling');
assert.equal('max_tokens' in providerPayload, false);
assert.equal(landingData.max_tokens, null);
assert.equal(landingData.finish_reason, 'length');
assert.equal(landingData.history.turns.at(-1).user.variants[0].hidden, true);
assert.equal(landingData.history.turns.at(-1).assistant.variantsByUserVariant['0'][0].finish_reason, 'length');
assert.equal((await readConversationState(db, conversationB.id)).turns.at(-1).assistant.variantsByUserVariant['0'][0].finish_reason, 'length');

await writeProfile(db, {
  current_chat_model: 'openai/gpt-5.1',
  model_box: { chat: ['openai/gpt-5.1'], free: [], image: [] },
});
providerContent = JSON.stringify({
  current_text: '',
  hand_seeds: [],
  do_not_repeat: '',
  pocket_candidates: [],
});
providerFinishReason = 'stop';
const soilResponse = await routeMemoryApi(new Request('https://coast.test/api/memory/soil/organize', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    conversation_id: conversationB.id,
    force: true,
    trigger: 'landing',
    settings: { maxHandSeeds: 3, autoRefreshEveryTurns: 5 },
  }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const soilData = await soilResponse.json();
assert.equal(soilResponse.status, 200);
assert.equal(soilData.soil.hand_seeds.length, 0);
assert.match(soilData.soil.current_text, /登岛信开场已经完成/);
assert.equal(providerPayload.model, 'openai/gpt-5.1', 'thought soil must follow the model currently selected for chat');
assert.equal(providerPayload.max_completion_tokens, 3200, 'thought soil keeps a wider bounded JSON budget for reasoning-capable models');
assert.equal(providerPayload.response_format?.type, 'json_schema', 'soil organize must request structured JSON when the selected model supports it');
assert.equal(providerPayload.response_format?.json_schema?.strict, true);
assert.ok(providerPayload.response_format?.json_schema?.schema?.required?.includes('hand_seeds_mode'));
assert.deepEqual(providerPayload.reasoning, { effort: 'minimal', exclude: true }, 'soil-only reasoning must leave completion room for the JSON payload');
assert.match(providerPayload.messages[0].content, /工作台小纸条/, 'soil prompt must frame the soil as a temporary workbench');
assert.match(providerPayload.messages[0].content, /hand_seeds_mode/, 'soil prompt must request explicit hand seed intent');
assert.match(providerPayload.messages[0].content, /删除过时旧种/, 'soil prompt must permit old hand seeds to leave');
assert.match(providerPayload.messages[0].content, /先 upsert 到 pending/, 'soil prompt must explain that old candidates may leave the display after pending sync');

const turn = (id, user, assistant, createdAt) => ({
  id,
  user: { active: 0, variants: [{ id: `${id}-user`, content: user, created_at: createdAt }] },
  assistant: {
    activeByUserVariant: { 0: 0 },
    variantsByUserVariant: { 0: [{ id: `${id}-assistant`, content: assistant, created_at: createdAt }] },
  },
});

const conversationLong = await createConversation(db, 'long soil prompt');
const longTurns = Array.from({ length: 12 }, (_, index) => turn(
  `long-soil-${index}`,
  `第${index}轮用户 ${index === 11 ? '最新用户完整尾标 ' : ''}${'甲'.repeat(7200)}`,
  `第${index}轮助手 ${index === 11 ? '最新助手完整尾标 ' : ''}${'乙'.repeat(7200)}`,
  `2026-07-14T08:${String(index).padStart(2, '0')}:00.000Z`,
));
await writeConversationState(db, conversationLong.id, { version: 4, turns: longTurns });
providerContent = JSON.stringify({
  current_text: '长回复后仍能整理',
  hand_seeds_mode: 'clear',
  hand_seeds: [],
  do_not_repeat_mode: 'clear',
  do_not_repeat: '',
  pocket_candidates_mode: 'clear',
  pocket_candidates: [],
});
const longSoilResponse = await routeMemoryApi(new Request('https://coast.test/api/memory/soil/organize', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversation_id: conversationLong.id, force: true, trigger: 'reply', settings: { maxHandSeeds: 7 } }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const longSoilData = await longSoilResponse.json();
assert.equal(longSoilResponse.status, 200);
assert.equal(longSoilData.soil.current_text, '长回复后仍能整理');
assert.equal(providerPayload.max_completion_tokens, 3200);
assert.match(providerPayload.messages[0].content, /最新用户完整尾标/, 'latest long user content should be preserved in the soil prompt');
assert.match(providerPayload.messages[0].content, /最新助手完整尾标/, 'latest long assistant content should be preserved in the soil prompt');
assert.ok(providerPayload.messages[0].content.length < 90000, 'soil prompt should keep a bounded total input size');

await writeConversationState(db, conversationD.id, {
  version: 4,
  turns: [turn('soil-guard-turn', '守住旧壤', '自动整理不能把旧壤冲空', '2026-07-14T07:59:00.000Z')],
});
const guardedCandidate = {
  candidate_id: 'guarded-old-candidate',
  title: '下一轮前先落袋的旧候选',
  life_core: '旧候选必须先进入待确认区，再允许展示层换壤。',
  content: '这条候选只存在于旧整理当前对话的纸条，尚未进入 pending。',
  usage_hint: '验证下一轮自动整理前的 pending 路径。',
  avoid_hint: '不要依赖模型再次返回它。',
  source_refs: [{ turn_id: 'soil-guard-turn', role: 'assistant' }],
  source_excerpt: '自动整理不能把旧壤冲空',
};
const oldHandSeeds = [
  { name: '旧当前活跃线索甲', life_core: '第一粒旧种不能被事故空数组冲掉', usage_hint: '', avoid_hint: '' },
  { name: '旧当前活跃线索乙', life_core: '第二粒旧种用于验证 replace 可以主动取舍', usage_hint: '', avoid_hint: '' },
];
await writeSoil(db, conversationD.id, {
  current_text: '守护旧壤字段',
  hand_seeds: oldHandSeeds,
  do_not_repeat: '旧的勿复读不能被事故空字符串清除',
  pocket_candidates: [guardedCandidate],
  manual_locked: false,
  auto_refresh_enabled: true,
});

async function organizeConversationDRequest(extra = {}) {
  const response = await routeMemoryApi(new Request('https://coast.test/api/memory/soil/organize', {
    method: 'POST',
    headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: conversationD.id, force: false, trigger: 'reply', ...extra }),
  }), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
  const data = await response.json();
  assert.equal(response.status, 200);
  return data;
}

async function organizeConversationD(output, extra = {}) {
  providerContent = JSON.stringify(output);
  return organizeConversationDRequest(extra);
}

assert.equal((await listPockets(db, { conversation_id: conversationD.id, status: 'pending' })).length, 0);
const guardedSoilData = await organizeConversationD({
  current_text: '',
  hand_seeds: [],
  do_not_repeat: '',
  pocket_candidates: [],
});
assert.equal(guardedSoilData.soil.hand_seeds.length, 2);
assert.equal(guardedSoilData.soil.hand_seeds[0].life_core, oldHandSeeds[0].life_core, 'missing mode plus an empty seed list must preserve old seeds');
assert.equal(guardedSoilData.soil.do_not_repeat, '旧的勿复读不能被事故空字符串清除', 'missing mode plus empty do-not-repeat must preserve the old value');
assert.equal(guardedSoilData.soil.pocket_candidates.length, 1, 'missing mode plus an empty candidate list must preserve old soil candidates');
assert.equal(guardedSoilData.soil.pocket_candidates[0].life_core, guardedCandidate.life_core);
assert.equal(guardedSoilData.pocket_sync.created, 1, 'old soil candidates must enter pending before the new soil is written');
const guardedPending = await listPockets(db, { conversation_id: conversationD.id, status: 'pending' });
assert.equal(guardedPending.length, 1);
assert.equal(guardedPending[0].life_core, guardedCandidate.life_core);

providerContent = [
  '上一次不是合法 JSON。',
  JSON.stringify({
    current_text: '重试成功整理',
    hand_seeds_mode: 'replace',
    hand_seeds: [{ name: '重试种', life_core: '第一次 JSON 失败后第二次成功', usage_hint: '', avoid_hint: '' }],
    do_not_repeat_mode: 'replace',
    do_not_repeat: '重试后写入的新勿复读',
    pocket_candidates_mode: 'clear',
    pocket_candidates: [],
  }),
];
const retryCallsBefore = providerChatCalls;
const retrySoilData = await organizeConversationDRequest();
assert.equal(providerChatCalls - retryCallsBefore, 2, 'invalid JSON must retry exactly once');
assert.equal(Boolean(retrySoilData.degraded), false);
assert.equal(retrySoilData.soil.current_text, '重试成功整理');
assert.equal(retrySoilData.soil.hand_seeds[0].life_core, '第一次 JSON 失败后第二次成功');

const replacedSoilData = await organizeConversationD({
  current_text: '主动替换旧手持',
  hand_seeds_mode: 'replace',
  hand_seeds: [{ name: '新当前活跃线索', life_core: '只留下此刻真正值得手持的一粒', usage_hint: '', avoid_hint: '' }],
  do_not_repeat_mode: 'replace',
  do_not_repeat: '新的勿复读提醒',
  pocket_candidates_mode: 'keep',
  pocket_candidates: [],
});
assert.equal(replacedSoilData.soil.hand_seeds.length, 1, 'replace may return fewer seeds than the old soil');
assert.equal(replacedSoilData.soil.hand_seeds[0].life_core, '只留下此刻真正值得手持的一粒');
assert.equal(replacedSoilData.soil.hand_seeds.some((seed) => seed.life_core === oldHandSeeds[1].life_core), false, 'replace must let stale seeds leave');
assert.equal(replacedSoilData.soil.do_not_repeat, '新的勿复读提醒');

const keptSoilData = await organizeConversationD({
  current_text: '明确保留工作台纸条',
  hand_seeds_mode: 'keep',
  hand_seeds: [{ name: '不应写入', life_core: 'keep mode 不应使用这粒返回值', usage_hint: '', avoid_hint: '' }],
  do_not_repeat_mode: 'keep',
  do_not_repeat: 'keep mode 不应使用这段返回值',
  pocket_candidates_mode: 'keep',
  pocket_candidates: [],
});
assert.equal(keptSoilData.soil.hand_seeds.length, 1);
assert.equal(keptSoilData.soil.hand_seeds[0].life_core, '只留下此刻真正值得手持的一粒', 'keep must preserve old hand seeds');
assert.equal(keptSoilData.soil.do_not_repeat, '新的勿复读提醒', 'keep must preserve old do-not-repeat');

const clearedSoilData = await organizeConversationD({
  current_text: '明确清理过时提醒',
  hand_seeds_mode: 'clear',
  hand_seeds: [{ name: 'clear 忽略值', life_core: '这粒不应写入', usage_hint: '', avoid_hint: '' }],
  do_not_repeat_mode: 'clear',
  do_not_repeat: '这段也不应写入',
  pocket_candidates_mode: 'keep',
  pocket_candidates: [],
});
assert.deepEqual(clearedSoilData.soil.hand_seeds, [], 'clear must empty hand seeds');
assert.equal(clearedSoilData.soil.do_not_repeat, '', 'clear must empty do-not-repeat');

const clearCandidate = {
  candidate_id: 'clear-display-candidate',
  title: '退出展示层的旧候选',
  life_core: '候选退出整理当前对话的纸条展示前必须先进入 pending。',
  content: '清理展示层不等于删除待确认区。',
  usage_hint: '验证 clear mode 的展示层边界。',
  avoid_hint: '不要把 clear 解释成删除 pocket。',
  source_refs: [{ turn_id: 'soil-guard-turn', role: 'assistant' }],
  source_excerpt: '自动整理不能把旧壤冲空',
};
const beforePocketClearSoil = await readSoil(db, conversationD.id);
await writeSoil(db, conversationD.id, {
  current_text: beforePocketClearSoil.current_text,
  hand_seeds: [{ name: '候选清理时仍保留', life_core: '清候选不影响当前活跃线索', usage_hint: '', avoid_hint: '' }],
  do_not_repeat: '清候选不影响勿复读',
  pocket_candidates: [clearCandidate],
  manual_locked: false,
  auto_refresh_enabled: true,
});
const confirmedBeforeClear = await createPocket(db, {
  conversation_id: conversationD.id,
  source_type: 'soil',
  source_ref: { conversation_id: conversationD.id, turn_id: 'soil-guard-turn', role: 'turn' },
  source_text: '已经确认的落袋不受整理当前对话的纸条 clear 影响',
});
const confirmedBeforeClearResult = await resolvePocket(db, confirmedBeforeClear.id, { action: 'memory', tag: '工程技术' });
const confirmedBeforeClearId = confirmedBeforeClearResult.pocket.id;
const confirmedCountBeforeClear = (await listPockets(db, { conversation_id: conversationD.id, status: 'confirmed' })).length;
const pendingCountBeforePocketClear = (await listPockets(db, { conversation_id: conversationD.id, status: 'pending' })).length;
const pocketClearData = await organizeConversationD({
  current_text: '让旧候选退出工作台展示',
  hand_seeds_mode: 'keep',
  hand_seeds: [],
  do_not_repeat_mode: 'keep',
  do_not_repeat: '',
  pocket_candidates_mode: 'clear',
  pocket_candidates: [{ ...clearCandidate, candidate_id: 'clear-mode-ignored-return', life_core: 'clear mode 不应把返回候选重新挂回展示层' }],
});
assert.deepEqual(pocketClearData.soil.pocket_candidates, [], 'pocket clear only empties the soil display layer');
assert.equal(pocketClearData.soil.hand_seeds[0].life_core, '清候选不影响当前活跃线索');
assert.equal(pocketClearData.soil.do_not_repeat, '清候选不影响勿复读');
const pendingAfterPocketClear = await listPockets(db, { conversation_id: conversationD.id, status: 'pending' });
assert.equal(pendingAfterPocketClear.length, pendingCountBeforePocketClear + 1, 'old soil candidate must upsert pending before clear writes the display layer');
assert.equal(pendingAfterPocketClear.some((pocket) => pocket.life_core === clearCandidate.life_core), true);
assert.equal(pendingAfterPocketClear.some((pocket) => pocket.life_core === 'clear mode 不应把返回候选重新挂回展示层'), false);
const confirmedAfterPocketClear = await listPockets(db, { conversation_id: conversationD.id, status: 'confirmed' });
assert.equal(confirmedAfterPocketClear.length, confirmedCountBeforeClear, 'soil clear mode must not delete confirmed pockets');
assert.equal(confirmedAfterPocketClear.some((pocket) => pocket.id === confirmedBeforeClearId), true);

const manualClearResponse = await routeMemoryApi(new Request(`https://coast.test/api/memory/soil?conversation_id=${conversationD.id}`, {
  method: 'PUT',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ current_text: '', hand_seeds: [], do_not_repeat: '', pocket_candidates: [], manual_locked: true }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const manualClearData = await manualClearResponse.json();
assert.equal(manualClearResponse.status, 200);
assert.equal(manualClearData.soil.current_text, '');
assert.deepEqual(manualClearData.soil.hand_seeds, []);
assert.equal(manualClearData.soil.do_not_repeat, '');
assert.deepEqual(manualClearData.soil.pocket_candidates, []);
assert.equal(manualClearData.soil.manual_locked, true, 'an explicit manual clear must still clear and lock the soil');

await writeConversationState(db, conversationC.id, {
  version: 4,
  turns: [
    turn('soil-turn-1', '第一轮问题', '第一轮回答', '2026-07-14T08:00:00.000Z'),
    turn('soil-turn-2', '第二轮问题', '第二轮回答', '2026-07-14T08:01:00.000Z'),
  ],
});
providerContent = `整理结果如下：\n\`\`\`json\n${JSON.stringify({
  current_text: '正在承接第二轮对话',
  hand_seeds: [{ name: '第二轮', life_core: '每轮都要接住', usage_hint: '', avoid_hint: '' }],
  do_not_repeat: '',
  pocket_candidates: [{
    candidate_id: 'second-turn-unfinished',
    title: '第二轮留下的岔路',
    life_core: '第二轮里暂时放下但仍能再生的方向',
    content: '第一轮与第二轮之间还有一条值得日后重新触碰的岔路。',
    usage_hint: '再次谈到这条岔路时使用。',
    avoid_hint: '不要升级成长期记忆。',
    source_refs: [{ turn_id: 'soil-turn-2', role: 'assistant' }],
    source_excerpt: '第二轮回答',
  }],
})}\n\`\`\`\n已完成。`;
const everyReplySoilResponse = await routeMemoryApi(new Request('https://coast.test/api/memory/soil/organize', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    conversation_id: conversationC.id,
    force: false,
    trigger: 'reply',
    settings: { maxHandSeeds: 3, autoRefreshEveryTurns: 12 },
  }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const everyReplySoilData = await everyReplySoilResponse.json();
assert.equal(everyReplySoilResponse.status, 200);
assert.equal(everyReplySoilData.skipped, undefined, 'a completed reply must not be skipped by the old interval');
assert.equal(everyReplySoilData.soil.current_text, '正在承接第二轮对话');
assert.equal(everyReplySoilData.soil.hand_seeds.length, 1);
assert.equal(everyReplySoilData.soil.pocket_candidates[0].title, '第二轮留下的岔路');
assert.equal(everyReplySoilData.soil.pocket_candidates[0].source_refs[0].turn_id, 'soil-turn-2', 'organize must retain a true active turn reference');
assert.equal(everyReplySoilData.pocket_sync.created, 1, 'a successful model organize must upsert its candidate into pending');
const organizedPending = await listPockets(db, { conversation_id: conversationC.id, status: 'pending' });
assert.equal(organizedPending.some((pocket) => pocket.life_core === '第二轮里暂时放下但仍能再生的方向'), true);

await writeConversationState(db, conversationC.id, {
  version: 4,
  turns: [
    turn('soil-turn-1', '第一轮问题', '第一轮回答', '2026-07-14T08:00:00.000Z'),
    turn('soil-turn-2', '第二轮问题', '第二轮回答', '2026-07-14T08:01:00.000Z'),
    turn('soil-turn-3', '第三轮需要兜底', '第三轮回答', '2099-07-14T08:02:00.000Z'),
  ],
});
const soilBeforeDegradedOrganize = await readSoil(db, conversationC.id);
providerContent = '这次上游没有按要求返回 JSON。';
const pendingBeforeDegradedOrganize = (await listPockets(db, { conversation_id: conversationC.id, status: 'pending' })).length;
const degradedSoilResponse = await routeMemoryApi(new Request('https://coast.test/api/memory/soil/organize', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversation_id: conversationC.id, force: false, trigger: 'reply' }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const degradedSoilData = await degradedSoilResponse.json();
assert.equal(degradedSoilResponse.status, 200);
assert.equal(degradedSoilData.degraded, true);
assert.equal(degradedSoilData.reason, 'soil_organize_invalid');
assert.match(degradedSoilData.soil.current_text, /第三轮需要兜底/, 'degraded organize should write a soft fallback current note');
assert.equal(degradedSoilData.soil.hand_seeds.length, soilBeforeDegradedOrganize.hand_seeds.length, 'degraded organize must keep old hand seeds');
assert.ok((await readSoil(db, conversationC.id)).revision > soilBeforeDegradedOrganize.revision, 'a degraded organize should save the soft fallback state');
assert.equal((await listPockets(db, { conversation_id: conversationC.id, status: 'pending' })).length, pendingBeforeDegradedOrganize, 'a degraded organize must not mutate pending pockets');

providerFinishReason = 'length';
providerContent = JSON.stringify({
  current_text: '即使 JSON 看起来完整也不能把截断态写进壤',
  hand_seeds_mode: 'clear',
  hand_seeds: [],
  do_not_repeat_mode: 'clear',
  do_not_repeat: '',
  pocket_candidates_mode: 'clear',
  pocket_candidates: [],
});
const truncatedSoilResponse = await routeMemoryApi(new Request('https://coast.test/api/memory/soil/organize', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversation_id: conversationC.id, force: false, trigger: 'reply' }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const truncatedSoilData = await truncatedSoilResponse.json();
assert.equal(truncatedSoilData.degraded, true);
assert.equal(truncatedSoilData.reason, 'soil_organize_truncated');
assert.match(truncatedSoilData.soil.current_text, /第三轮需要兜底/);
providerFinishReason = 'stop';

providerStatus = 503;
const providerErrorResponse = await routeMemoryApi(new Request('https://coast.test/api/memory/soil/organize', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversation_id: conversationC.id, force: false, trigger: 'reply' }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const providerErrorData = await providerErrorResponse.json();
assert.equal(providerErrorResponse.status, 200);
assert.equal(providerErrorData.degraded, true);
assert.equal(providerErrorData.reason, 'provider_unavailable');
assert.match(providerErrorData.soil.current_text, /第三轮需要兜底/);
providerStatus = 200;

await writeSoil(db, conversationB.id, {
  current_text: '屋主手动锁定的当前方向',
  hand_seeds: [],
  manual_locked: true,
});
const callsBeforeLockedLanding = providerChatCalls;
const lockedSoilResponse = await routeMemoryApi(new Request('https://coast.test/api/memory/soil/organize', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversation_id: conversationB.id, force: true, trigger: 'landing' }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const lockedSoilData = await lockedSoilResponse.json();
assert.equal(lockedSoilResponse.status, 200);
assert.equal(lockedSoilData.skipped, true);
assert.equal(lockedSoilData.reason, 'manual_locked');
assert.equal(lockedSoilData.soil.current_text, '屋主手动锁定的当前方向');
assert.equal(providerChatCalls, callsBeforeLockedLanding, 'landing organize must not call the model through a manual lock');
const lockedReplyResponse = await routeMemoryApi(new Request('https://coast.test/api/memory/soil/organize', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversation_id: conversationB.id, force: true, trigger: 'reply' }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const lockedReplyData = await lockedReplyResponse.json();
assert.equal(lockedReplyResponse.status, 200);
assert.equal(lockedReplyData.reason, 'manual_locked');
assert.equal(lockedReplyData.soil.current_text, '屋主手动锁定的当前方向');
assert.equal(providerChatCalls, callsBeforeLockedLanding, 'per-reply organization must also preserve a manual lock');
globalThis.fetch = originalFetch;

console.log('memory: ok');
