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
  normalizeSoilCandidates,
  patchEntry,
  patchPocket,
  pocketFingerprint,
  readSoil,
  resolvePocket,
  upsertSoilCandidates,
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

const structuredCandidates = normalizeSoilCandidates([{
  candidate_id: 'coast-return',
  title: '回潮后的未竟方向',
  content: '把相关的两段对话压缩保留在这里。',
  source_refs: [{ turn_id: 'turn-structured', role: 'turn' }],
  source_excerpt: '那条路暂时放下，但没有死去。',
}]);
assert.deepEqual(structuredCandidates[0], {
  candidate_id: 'coast-return',
  title: '回潮后的未竟方向',
  content: '把相关的两段对话压缩保留在这里。',
  source_refs: [{ turn_id: 'turn-structured', role: 'turn' }],
  source_excerpt: '那条路暂时放下，但没有死去。',
});
const stringCandidates = normalizeSoilCandidates(['旧壤里的一句话']);
assert.equal(stringCandidates[0].title, '旧壤里的一句话');
assert.equal(stringCandidates[0].content, '旧壤里的一句话');
assert.deepEqual(stringCandidates[0].source_refs, []);

const originalA = await readSoil(db, conversationA.id);
const originalB = await readSoil(db, conversationB.id);
assert.equal(originalA.current_text, '');
assert.equal(originalB.current_text, '');

const afterthoughts = Array.from({ length: 10 }, (_, index) => `余思 ${index}`);
const writtenA = await writeSoil(db, conversationA.id, {
  current_text: '只属于窗口 A',
  afterthoughts,
  memory_candidates: ['候选一'],
  seed_candidates: ['种子候选一'],
});
assert.equal(writtenA.afterthoughts.length, 7, 'thought soil must cap afterthoughts at seven');
assert.equal(writtenA.memory_candidates[0].content, '候选一');
assert.equal(writtenA.seed_candidates[0].content, '种子候选一');
assert.equal(writtenA.manual_locked, true);
assert.equal((await readSoil(db, conversationB.id)).current_text, '', 'conversation soils must not cross windows');

// Legacy columns remain in D1 only for historical compatibility; V2 runtime must ignore them.
db.database.prepare('UPDATE conversation_soils SET pocket_candidates_json = ? WHERE conversation_id = ?')
  .run(JSON.stringify(['来自旧 D1 的 string candidate']), conversationA.id);
const legacySoil = await readSoil(db, conversationA.id);
assert.equal(legacySoil.memory_candidates[0].content, '候选一');
assert.equal(Object.hasOwn(legacySoil, 'pocket_candidates'), false);
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
  content: '潮汐钥匙来自整理当前对话的纸条种子候选，只能先进入待确认区。',
  source_refs: [{ turn_id: 'auto-turn-1', role: 'turn' }],
  source_excerpt: '这部分先放下，之后也许还会发芽。',
};
const expectedFingerprint = await pocketFingerprint(conversationC.id, autoCandidate.content, 'seed');
const firstAutoUpsert = await upsertSoilCandidates(db, conversationC.id, { seed_candidates: [autoCandidate] });
assert.equal(firstAutoUpsert.created, 1, 'a soil seed candidate must automatically create one pending pocket');
let pendingC = await listPockets(db, { conversation_id: conversationC.id, status: 'pending' });
assert.equal(pendingC.length, 1);
assert.equal(pendingC[0].fingerprint, expectedFingerprint);
assert.equal(pendingC[0].source_type, 'soil');
assert.equal(pendingC[0].suggested_destination, 'seed');
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
const confirmedRepeat = await upsertSoilCandidates(db, conversationC.id, { seed_candidates: [autoCandidate] });
assert.equal(confirmedRepeat.suppressed, 1, 'resolved soil candidate must not bounce back into pending');

const memoryCandidate = {
  ...autoCandidate,
  candidate_id: 'memory-candidate',
  title: '回潮记忆',
  content: '回潮记忆被确认后进入统一记忆库。',
};
const memoryUpsert = await upsertSoilCandidates(db, conversationC.id, { memory_candidates: [memoryCandidate] });
assert.equal(memoryUpsert.pockets[0].suggested_destination, 'memory');
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

const discardedCandidate = {
  ...autoCandidate,
  candidate_id: 'discard-once',
  title: '不再弹回',
  content: '只出现一次后被明确丢弃',
};
const discardedUpsert = await upsertSoilCandidates(db, conversationC.id, { memory_candidates: [discardedCandidate] });
await resolvePocket(db, discardedUpsert.pockets[0].id, { action: 'discard' });
const discardedRepeat = await upsertSoilCandidates(db, conversationC.id, { memory_candidates: [discardedCandidate] });
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
  current_text: '登岛信开场已经完成',
  afterthoughts: [],
  memory_candidates: [],
  seed_candidates: [],
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
assert.equal(soilData.soil.afterthoughts.length, 0);
assert.match(soilData.soil.current_text, /登岛信开场已经完成/);
assert.equal(providerPayload.model, 'openai/gpt-5.1', 'thought soil must follow the model currently selected for chat');
assert.equal(providerPayload.max_completion_tokens, 3200, 'thought soil keeps a wider bounded JSON budget for reasoning-capable models');
assert.equal(providerPayload.response_format?.type, 'json_schema', 'soil organize must request structured JSON when the selected model supports it');
assert.equal(providerPayload.response_format?.json_schema?.strict, true);
assert.ok(providerPayload.response_format?.json_schema?.schema?.required?.includes('afterthoughts'));
assert.ok(providerPayload.response_format?.json_schema?.schema?.required?.includes('memory_candidates'));
assert.ok(providerPayload.response_format?.json_schema?.schema?.required?.includes('seed_candidates'));
assert.deepEqual(providerPayload.reasoning, { effort: 'minimal', exclude: true }, 'soil-only reasoning must leave completion room for the JSON payload');
assert.match(providerPayload.messages[0].content, /① 当前｜current_text/, 'soil prompt must define current context');
assert.match(providerPayload.messages[0].content, /② 余思｜afterthoughts/, 'soil prompt must leave room for optional afterthoughts');
assert.match(providerPayload.messages[0].content, /memory_candidates/, 'soil prompt must expose memory destination');
assert.match(providerPayload.messages[0].content, /seed_candidates/, 'soil prompt must expose seed destination');
assert.equal(providerPayload.messages[0].content.includes('do_not_repeat'), false, 'legacy behavior-control fields must not remain in the organizer prompt');

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
  afterthoughts: [],
  memory_candidates: [],
  seed_candidates: [],
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
  turns: [turn('soil-guard-turn', '守住旧壤', '新版整理纸条按此刻重写桌面', '2026-07-14T07:59:00.000Z')],
});
await writeSoil(db, conversationD.id, {
  current_text: '上一版仍需承接的内容',
  afterthoughts: ['上一版留下的余思'],
  memory_candidates: [],
  seed_candidates: [],
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

const emptySnapshotData = await organizeConversationD({
  current_text: '',
  afterthoughts: [],
  memory_candidates: [],
  seed_candidates: [],
});
assert.equal(emptySnapshotData.soil.current_text, '', 'v2 allows the current note to become empty');
assert.deepEqual(emptySnapshotData.soil.afterthoughts, [], 'v2 empty afterthoughts are a valid current snapshot');
assert.deepEqual(emptySnapshotData.soil.memory_candidates, []);
assert.deepEqual(emptySnapshotData.soil.seed_candidates, []);

providerContent = [
  '上一次不是合法 JSON。',
  JSON.stringify({
    current_text: '重试成功整理',
    afterthoughts: ['第二次成功后留下的余思'],
    memory_candidates: [],
    seed_candidates: [],
  }),
];
const retryCallsBefore = providerChatCalls;
const retrySoilData = await organizeConversationDRequest();
assert.equal(providerChatCalls - retryCallsBefore, 2, 'invalid JSON must retry exactly once');
assert.equal(Boolean(retrySoilData.degraded), false);
assert.equal(retrySoilData.soil.current_text, '重试成功整理');
assert.deepEqual(retrySoilData.soil.afterthoughts, ['第二次成功后留下的余思']);

const routedSoilData = await organizeConversationD({
  current_text: '现在承接去处分流',
  afterthoughts: ['想继续看看这条线以后会长成什么'],
  memory_candidates: [{
    title: '应被记住的决定',
    content: '以后再遇见时，希望仍然知道这个决定。',
    source_refs: [{ turn_id: 'soil-guard-turn', role: 'turn' }],
    source_excerpt: '守住旧壤',
  }],
  seed_candidates: [{
    title: '仍可生长的问题',
    content: '这个问题暂时没有答案，但值得以后重新拿起来。',
    source_refs: [{ turn_id: 'soil-guard-turn', role: 'assistant' }],
    source_excerpt: '新版整理纸条按此刻重写桌面',
  }],
});
assert.equal(routedSoilData.soil.afterthoughts.length, 1);
assert.equal(routedSoilData.soil.memory_candidates[0].title, '应被记住的决定');
assert.equal(routedSoilData.soil.seed_candidates[0].title, '仍可生长的问题');
assert.equal(routedSoilData.pocket_sync.created, 2, 'memory and seed suggestions both enter the pending pocket');
const routedPending = await listPockets(db, { conversation_id: conversationD.id, status: 'pending' });
assert.equal(routedPending.some((pocket) => pocket.suggested_destination === 'memory' && pocket.title === '应被记住的决定'), true);
assert.equal(routedPending.some((pocket) => pocket.suggested_destination === 'seed' && pocket.title === '仍可生长的问题'), true);

const nextSnapshotData = await organizeConversationD({
  current_text: '候选已经递往待确认区，当前桌面可以自然放下它们',
  afterthoughts: [],
  memory_candidates: [],
  seed_candidates: [],
});
assert.deepEqual(nextSnapshotData.soil.memory_candidates, [], 'successful v2 organize replaces the temporary candidate snapshot');
assert.deepEqual(nextSnapshotData.soil.seed_candidates, []);
const routedPendingAfterClear = await listPockets(db, { conversation_id: conversationD.id, status: 'pending' });
assert.equal(routedPendingAfterClear.length, routedPending.length, 'clearing the temporary soil snapshot does not delete pending pockets');

const manualClearResponse = await routeMemoryApi(new Request(`https://coast.test/api/memory/soil?conversation_id=${conversationD.id}`, {
  method: 'PUT',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    current_text: '',
    afterthoughts: [],
    memory_candidates: [],
    seed_candidates: [],
    manual_locked: true,
  }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const manualClearData = await manualClearResponse.json();
assert.equal(manualClearResponse.status, 200);
assert.equal(manualClearData.soil.current_text, '');
assert.deepEqual(manualClearData.soil.afterthoughts, []);
assert.deepEqual(manualClearData.soil.memory_candidates, []);
assert.deepEqual(manualClearData.soil.seed_candidates, []);
assert.equal(manualClearData.soil.manual_locked, true, 'an explicit manual clear must still clear and lock the soil');

const partialToggleResponse = await routeMemoryApi(new Request(`https://coast.test/api/memory/soil?conversation_id=${conversationD.id}`, {
  method: 'PUT',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ auto_refresh_enabled: false }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const partialToggleData = await partialToggleResponse.json();
assert.equal(partialToggleResponse.status, 200);
assert.equal(partialToggleData.soil.auto_refresh_enabled, false);
assert.equal(partialToggleData.soil.manual_locked, true, 'partial toggle must preserve the existing manual lock');
const partialReenableResponse = await routeMemoryApi(new Request(`https://coast.test/api/memory/soil?conversation_id=${conversationD.id}`, {
  method: 'PUT',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ auto_refresh_enabled: true }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const partialReenableData = await partialReenableResponse.json();
assert.equal(partialReenableData.soil.auto_refresh_enabled, true);
assert.equal(partialReenableData.soil.manual_locked, true, 're-enable must not silently unlock hand-edited soil');

await writeConversationState(db, conversationC.id, {
  version: 4,
  turns: [
    turn('soil-turn-1', '第一轮问题', '第一轮回答', '2026-07-14T08:00:00.000Z'),
    turn('soil-turn-2', '第二轮问题', '第二轮回答', '2026-07-14T08:01:00.000Z'),
  ],
});
providerContent = `整理结果如下：\n\`\`\`json\n${JSON.stringify({
  current_text: '正在承接第二轮对话',
  afterthoughts: ['第二轮还有一条没说尽的岔路，之后也许值得回来。'],
  memory_candidates: [],
  seed_candidates: [{
    title: '第二轮留下的岔路',
    content: '第一轮与第二轮之间还有一条值得日后重新触碰的岔路。',
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
assert.deepEqual(everyReplySoilData.soil.afterthoughts, ['第二轮还有一条没说尽的岔路，之后也许值得回来。']);
assert.equal(everyReplySoilData.soil.seed_candidates[0].title, '第二轮留下的岔路');
assert.equal(everyReplySoilData.soil.seed_candidates[0].source_refs[0].turn_id, 'soil-turn-2', 'organize must retain a true active turn reference');
assert.equal(everyReplySoilData.pocket_sync.created, 1, 'a successful model organize must upsert its candidate into pending');
const organizedPending = await listPockets(db, { conversation_id: conversationC.id, status: 'pending' });
assert.equal(organizedPending.some((pocket) => pocket.title === '第二轮留下的岔路' && pocket.suggested_destination === 'seed'), true);

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
assert.equal(degradedSoilData.soil.current_text, soilBeforeDegradedOrganize.current_text, 'degraded organize must keep the last successful current note');
assert.deepEqual(degradedSoilData.soil.afterthoughts, soilBeforeDegradedOrganize.afterthoughts, 'degraded organize must keep the last successful afterthoughts');
assert.equal((await readSoil(db, conversationC.id)).revision, soilBeforeDegradedOrganize.revision, 'degraded organize must not advance the successful soil revision');
assert.equal((await listPockets(db, { conversation_id: conversationC.id, status: 'pending' })).length, pendingBeforeDegradedOrganize, 'a degraded organize must not mutate pending pockets');

providerFinishReason = 'length';
providerContent = JSON.stringify({
  current_text: '即使 JSON 看起来完整也不能把截断态写进壤',
  afterthoughts: [],
  memory_candidates: [],
  seed_candidates: [],
});
const truncatedSoilResponse = await routeMemoryApi(new Request('https://coast.test/api/memory/soil/organize', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversation_id: conversationC.id, force: false, trigger: 'reply' }),
}), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
const truncatedSoilData = await truncatedSoilResponse.json();
assert.equal(truncatedSoilData.degraded, true);
assert.equal(truncatedSoilData.reason, 'soil_organize_truncated');
assert.equal(truncatedSoilData.soil.current_text, soilBeforeDegradedOrganize.current_text);
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
assert.equal(providerErrorData.soil.current_text, soilBeforeDegradedOrganize.current_text);
providerStatus = 200;

await writeSoil(db, conversationB.id, {
  current_text: '屋主手动锁定的当前方向',
  afterthoughts: [],
  memory_candidates: [],
  seed_candidates: [],
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
