import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createConversation, writeConversationState } from '../functions/chat-store.js';
import { routeMemoryApi } from '../functions/memory-router.js';
import { createEntry, readSoil, writeSoil } from '../functions/memory-store.js';
import { buildMemoryContext } from '../functions/memory-recall.js';

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

const turn = (id, user, assistant, createdAt, userExtra = {}) => ({
  id,
  user: { active: 0, variants: [{ id: id + '-user', content: user, created_at: createdAt, ...userExtra }] },
  assistant: {
    activeByUserVariant: { 0: 0 },
    variantsByUserVariant: { 0: [{ id: id + '-assistant', content: assistant, created_at: createdAt }] },
  },
});

const db = new D1Database();
const originalFetch = globalThis.fetch;
let providerPayloads = [];
let providerContent = JSON.stringify({
  current_text: '默认整理成功',
  hand_seeds_mode: 'keep',
  hand_seeds: [],
  do_not_repeat_mode: 'keep',
  do_not_repeat: '',
  pocket_candidates_mode: 'keep',
  pocket_candidates: [],
});
let providerFinishReason = 'stop';
let providerStatus = 200;

globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.includes('/api/v1/models')) {
    return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 Nano', architecture: { output_modalities: ['text'] }, supported_parameters: ['temperature', 'response_format', 'reasoning'], pricing: { prompt: '0', completion: '0' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/api/v1/chat/completions')) {
    const payload = JSON.parse(options.body);
    providerPayloads.push(payload);
    if (providerStatus !== 200) {
      return new Response(JSON.stringify({ error: { message: 'provider unavailable' } }), { status: providerStatus, headers: { 'Content-Type': 'application/json' } });
    }
    const content = Array.isArray(providerContent) ? providerContent.shift() : providerContent;
    const finishReason = Array.isArray(providerFinishReason) ? providerFinishReason.shift() : providerFinishReason;
    return new Response(JSON.stringify({
      model: payload.model,
      choices: [{ message: { content }, finish_reason: finishReason }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/embeddings')) {
    return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error('unexpected fetch: ' + url);
};

async function organize(conversationId, trigger = 'reply') {
  const response = await routeMemoryApi(new Request('https://coast.test/api/memory/soil/organize', {
    method: 'POST',
    headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: conversationId, force: true, trigger, settings: { maxHandSeeds: 7 } }),
  }), { COAST_CHAT_DB: db, OPENROUTER_API_KEY: 'test-key' });
  const data = await response.json();
  assert.equal(response.status, 200);
  return data;
}

const landingConversation = await createConversation(db, 'landing incremental');
await writeConversationState(db, landingConversation.id, {
  version: 4,
  turns: [turn(
    'landing-turn',
    '登岛信完整输入标记：黑金夜海与同轨燕鸥',
    '读信回复标记：已经替这封信点灯',
    '2026-07-15T01:00:00.000Z',
    { hidden: true, input_type: 'landing_letter' },
  )],
});
providerPayloads = [];
providerContent = JSON.stringify({
  current_text: '登岛信开场已经完成',
  hand_seeds_mode: 'clear',
  hand_seeds: [],
  do_not_repeat_mode: 'clear',
  do_not_repeat: '',
  pocket_candidates_mode: 'clear',
  pocket_candidates: [],
});
const landingData = await organize(landingConversation.id, 'landing');
assert.equal(landingData.soil.current_text, '登岛信开场已经完成');
assert.match(providerPayloads.at(-1).messages[0].content, /登岛信完整输入标记/);
assert.match(providerPayloads.at(-1).messages[0].content, /读信回复标记/);

const conversation = await createConversation(db, 'incremental long window');
const turns = [turn(
  'hidden-landing',
  '不应进入普通 reply 的登岛信标记',
  '不应进入普通 reply 的读信回复标记',
  '2026-07-15T01:00:00.000Z',
  { hidden: true, input_type: 'landing_letter' },
)];
for (let index = 0; index < 100; index += 1) {
  turns.push(turn(
    'visible-' + index,
    '第' + index + '轮用户 ' + (index === 98 ? 'previous-visible-marker ' : '') + (index === 99 ? 'latest-visible-user-marker ' : '') + '甲'.repeat(1800),
    '第' + index + '轮助手 ' + (index === 98 ? 'previous-visible-assistant-marker ' : '') + (index === 99 ? 'latest-visible-assistant-marker ' : '') + '乙'.repeat(1800),
    '2026-07-15T02:' + String(index).padStart(2, '0') + ':00.000Z',
  ));
}
await writeConversationState(db, conversation.id, { version: 4, turns });
await writeSoil(db, conversation.id, {
  current_text: '上一版 current_text 里仍悬着的线索：老英国人假胡子与保底纸条。',
  hand_seeds: [{ name: '旧手持', life_core: '旧当前活跃线索应该进入增量整理输入', usage_hint: '', avoid_hint: '' }],
  do_not_repeat: '旧勿复读应该进入增量整理输入',
  pocket_candidates: [{
    candidate_id: 'old-candidate',
    title: '旧候选',
    life_core: '旧候选只作为工作台纸条输入',
    content: '候选内容',
    usage_hint: '',
    avoid_hint: '',
    source_refs: [{ turn_id: 'visible-98', role: 'turn' }],
    source_excerpt: 'previous-visible-marker',
  }],
  manual_locked: false,
  auto_refresh_enabled: true,
});
providerPayloads = [];
providerContent = JSON.stringify({
  current_text: '滚动承接最新一轮',
  hand_seeds_mode: 'keep',
  hand_seeds: [],
  do_not_repeat_mode: 'keep',
  do_not_repeat: '',
  pocket_candidates_mode: 'clear',
  pocket_candidates: [],
});
const replyData = await organize(conversation.id, 'reply');
const replyPrompt = providerPayloads.at(-1).messages[0].content;
assert.equal(replyData.soil.current_text, '滚动承接最新一轮');
assert.equal((await readSoil(db, conversation.id)).organized_through_turn_id, 'visible-99');
assert.match(replyPrompt, /reply_incremental/);
assert.match(replyPrompt, /上一版 current_text 里仍悬着的线索/);
assert.match(replyPrompt, /latest-visible-user-marker/);
assert.match(replyPrompt, /latest-visible-assistant-marker/);
assert.match(replyPrompt, /previous-visible-marker/);
assert.doesNotMatch(replyPrompt, /不应进入普通 reply 的登岛信标记/);
assert.doesNotMatch(replyPrompt, /第0轮用户/);
assert.ok(replyPrompt.length < 30000, 'the 100th-turn soil prompt must remain bounded instead of growing with deep history');
assert.equal(providerPayloads.at(-1).max_completion_tokens, 3200);

const successCursor = (await readSoil(db, conversation.id)).organized_through_turn_id;
turns.push(turn('visible-100', 'degraded-missed-user-marker', 'degraded-missed-assistant-marker', '2026-07-15T03:40:00.000Z'));
await writeConversationState(db, conversation.id, { version: 4, turns });
providerPayloads = [];
providerContent = '这次不是 JSON';
const degradedData = await organize(conversation.id, 'reply');
assert.equal(degradedData.degraded, true);
const degradedSoil = await readSoil(db, conversation.id);
assert.equal(degradedSoil.organized_through_turn_id, successCursor, 'degraded fallback must not advance the successful cursor');
assert.match(degradedSoil.current_text, /degraded-missed-user-marker/);

turns.push(turn('visible-101', 'latest-after-degraded-user-marker', 'latest-after-degraded-assistant-marker', '2026-07-15T03:41:00.000Z'));
await writeConversationState(db, conversation.id, { version: 4, turns });
providerPayloads = [];
providerContent = JSON.stringify({
  current_text: '补读失败轮后继续承接',
  hand_seeds_mode: 'keep',
  hand_seeds: [],
  do_not_repeat_mode: 'keep',
  do_not_repeat: '',
  pocket_candidates_mode: 'clear',
  pocket_candidates: [],
});
const afterDegradedData = await organize(conversation.id, 'reply');
const afterDegradedPrompt = providerPayloads.at(-1).messages[0].content;
assert.equal(afterDegradedData.soil.current_text, '补读失败轮后继续承接');
assert.equal((await readSoil(db, conversation.id)).organized_through_turn_id, 'visible-101');
assert.match(afterDegradedPrompt, /degraded-missed-user-marker/, 'the next successful organize should see the missed visible turn after the old cursor');
assert.match(afterDegradedPrompt, /latest-after-degraded-user-marker/);

providerPayloads = [];
providerContent = [
  '第一次不是合法 JSON',
  JSON.stringify({
    current_text: '重试仍正常',
    hand_seeds_mode: 'keep',
    hand_seeds: [],
    do_not_repeat_mode: 'keep',
    do_not_repeat: '',
    pocket_candidates_mode: 'clear',
    pocket_candidates: [],
  }),
];
const retryData = await organize(conversation.id, 'reply');
assert.equal(Boolean(retryData.degraded), false);
assert.equal(providerPayloads.length, 2, 'invalid JSON should retry exactly once');
assert.match(providerPayloads[1].messages[0].content, /上一次输出不是合法 JSON/);

const seedConversation = await createConversation(db, 'seed recall regression');
await createEntry(db, {
  entry_type: 'seed',
  scope: 'global',
  title: '同轨燕鸥召回种',
  life_core: '同轨燕鸥围绕海岸飞行，而不是把深历史塞回 current_text。',
  content: '统一种子库继续由语义召回系统负责。',
  usage_hint: '再次谈到同轨与海岸时召回。',
  avoid_hint: '',
  tag: '海岸世界观',
  source_ref: { conversation_id: seedConversation.id },
});
const memoryContext = await buildMemoryContext({ COAST_CHAT_DB: db }, 'owner', seedConversation.id, '同轨燕鸥', { limit: 3 });
assert.ok(memoryContext.items.some((entry) => entry.life_core.includes('同轨燕鸥')), 'unified seed semantic recall must still work');

globalThis.fetch = originalFetch;
console.log('soil-incremental: ok');
