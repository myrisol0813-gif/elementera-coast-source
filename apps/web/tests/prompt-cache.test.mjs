import assert from 'node:assert/strict';
import { addUsage, normalizeUsage } from '../functions/models/model-validation.js';
import { performFormalChatStream } from '../functions/models.js';
import { cacheHitRate } from '../elementera-mcp/deploy-pages/public/features/chat/chat-model-metadata.js';
import { trimContextToComfortRange } from '../functions/context-comfort-range.js';

// Cache hits and writes must survive ordinary JSON and streaming usage paths.
assert.deepEqual(normalizeUsage({
  prompt_tokens: 1250,
  completion_tokens: 9,
  total_tokens: 1259,
  prompt_tokens_details: { cached_tokens: 1024, cache_write_tokens: 0 },
  cache_discount: 0,
}), { prompt_tokens: 1250, completion_tokens: 9, total_tokens: 1259,
  cached_tokens: 1024, cache_write_tokens: 0, cache_discount: 0 });
assert.deepEqual(normalizeUsage({ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }),
  { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
  'older providers must remain compatible without inventing cache=0');
assert.deepEqual(addUsage(
  { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cached_tokens: 0, cache_write_tokens: 80 },
  { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230, prompt_tokens_details: { cached_tokens: 180, cache_write_tokens: 0 } },
), { prompt_tokens: 300, completion_tokens: 50, total_tokens: 350,
  cached_tokens: 180, cache_write_tokens: 80 });
assert.equal(cacheHitRate({ prompt_tokens: 10000, cached_tokens: 7500 }), '75%');
assert.equal(cacheHitRate({ prompt_tokens: 300, cached_tokens: 100 }), '33.3%');
assert.equal(cacheHitRate({ prompt_tokens: 100, cached_tokens: 0 }), '0%');
assert.equal(cacheHitRate({ prompt_tokens: 100 }), null, 'missing cache receipt must not become 0%');
assert.equal(cacheHitRate({ prompt_tokens: 0, cached_tokens: 0 }), null);
assert.equal(cacheHitRate({ prompt_tokens: 100, cached_tokens: 101 }), null);

// Changing later sources must not perturb the reusable system prompt prefix.
const stable = {
  basePrompt: '你是模型伙伴。',
  customInstructionsText: '稳定的核心自定义内容'.repeat(320),
  globalExcerptText: '长期保留的摘录内容'.repeat(100),
  recentTurns: 8,
  maxTokens: 20000,
};
const first = trimContextToComfortRange({
  ...stable, soilText: '当前对话纸条第一种状态',
  messages: [{ role: 'user', content: '第一问' }],
});
const second = trimContextToComfortRange({
  ...stable, soilText: '当前对话纸条第二种状态',
  messages: [{ role: 'user', content: '第二问' }],
});
const stablePrefix = '你是模型伙伴。\n\n';
assert.ok(first.modelMessages[0].content.startsWith(stablePrefix));
const stableEnd = first.modelMessages[0].content.indexOf('【整理当前对话的纸条】');
assert.ok(stableEnd > 1024);
assert.equal(first.modelMessages[0].content.slice(0, stableEnd),
  second.modelMessages[0].content.slice(0, second.modelMessages[0].content.indexOf('【整理当前对话的纸条】')));

const originalFetch = globalThis.fetch;
const requested = [];
const responses = [
  { cached_tokens: 0, cache_write_tokens: 1100 },
  { cached_tokens: 1050, cache_write_tokens: 0 },
];
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('/api/v1/models')) return new Response(JSON.stringify({
    data: [{
      id: 'coast/test-free:free',
      name: 'Free test',
      pricing: { prompt: '0', completion: '0' },
      architecture: { output_modalities: ['text'] },
      supported_parameters: ['temperature'],
    }],
  }), { status: 200 });
  if (!String(url).includes('/api/v1/chat/completions')) throw new Error('unexpected endpoint');
  const payload = JSON.parse(options.body);
  requested.push(payload);
  assert.equal(payload.model, 'coast/test-free:free');
  assert.equal(payload.session_id, 'a'.repeat(64));
  assert.equal(payload.stream_options.include_usage, true);
  const details = responses.shift();
  const usage = { prompt_tokens: 1250, completion_tokens: 2, total_tokens: 1252,
    prompt_tokens_details: details, cache_discount: 0 };
  const sse = [
    'data: ' + JSON.stringify({ model: 'coast/test-free:free',
      choices: [{ delta: { content: '好呀' }, finish_reason: 'stop' }] }),
    'data: ' + JSON.stringify({ model: 'coast/test-free:free', choices: [], usage }),
    'data: [DONE]',
    '',
  ].join('\n\n');
  return new Response(sse, { status: 200,
    headers: { 'Content-Type': 'text/event-stream' } });
};
try {
  const snapshots = [];
  const emitted = [];
  for (let i = 0; i < 2; i++) {
    const events = [];
    for await (const item of performFormalChatStream(
      { OPENROUTER_API_KEY: 'test-only-no-real-requests' },
      {
        model: 'coast/test-free:free',
        messages: [{ role: 'system', content: stable.customInstructionsText },
          { role: 'user', content: '你好' }],
        settings: { max_tokens: 48 },
        session_id: 'a'.repeat(64),
      },
      { allowSystem: true, onMetadata: async (record) => snapshots.push(record) },
    )) events.push(item);
    emitted.push(events);
  }
  assert.equal(requested.length, 2);
  assert.deepEqual(requested[0].messages, requested[1].messages, 'unchanged context should preserve cache key');
  assert.equal(emitted[0].find((x) => x.event === 'usage').data.cached_tokens, 0);
  assert.equal(emitted[0].find((x) => x.event === 'usage').data.cache_write_tokens, 1100);
  assert.equal(emitted[1].find((x) => x.event === 'usage').data.cached_tokens, 1050);
  assert.equal(emitted[1].find((x) => x.event === 'usage').data.cache_write_tokens, 0);
  assert.equal(snapshots[1].metadata.usage.cached_tokens, 1050);
  assert.equal(snapshots[0].metadata.usage.cache_write_tokens, 1100);
  assert.equal(snapshots[1].metadata.usage.cache_discount, 0);
  assert.equal(cacheHitRate(snapshots[1].metadata.usage), '84%');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('prompt-cache.test.mjs: ok');
