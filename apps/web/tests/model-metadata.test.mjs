import assert from 'node:assert/strict';
import {
  createModelMetadataCollector,
  metadataFromProviderCalls,
  sanitizeProviderMetadata,
} from '../functions/models/model-metadata.js';
import { contextMessages } from '../elementera-mcp/deploy-pages/public/features/chat/chat-context.js';

const sanitized = sanitizeProviderMetadata({
  Authorization: 'Bearer super-secret-token-value',
  nested: {
    api_key: 'sk-secret-key-value',
    cookie: 'session=secret-cookie',
  },
  choices: [{
    message: {
      content: 'assistant正文不应复制进 raw metadata',
      encrypted_content: 'ciphertext-that-must-not-be-shown',
      reasoning: '可展示 reasoning',
    },
  }],
});
assert.equal(sanitized.Authorization, '[REDACTED]');
assert.equal(sanitized.nested.api_key, '[REDACTED]');
assert.equal(sanitized.nested.cookie, '[REDACTED]');
assert.equal(sanitized.choices[0].message.content, '[OMITTED_ASSISTANT_CONTENT]');
assert.equal(sanitized.choices[0].message.encrypted_content, '[REDACTED_ENCRYPTED]');
assert.equal(sanitized.choices[0].message.reasoning, '可展示 reasoning');
assert.ok(!JSON.stringify(sanitized).includes('super-secret-token-value'));
assert.ok(!JSON.stringify(sanitized).includes('ciphertext-that-must-not-be-shown'));
assert.ok(!JSON.stringify(sanitized).includes('assistant正文不应复制进 raw metadata'));

const nonStream = await metadataFromProviderCalls({
  requestedModel: 'openai/test-requested',
  requestPayload: {
    model: 'openai/test-requested',
    temperature: 0.3,
    top_p: 0.9,
    max_tokens: 1234,
    reasoning: { effort: 'high', max_tokens: 600 },
  },
  calls: [{
    id: 'gen-1',
    model: 'openai/test-resolved',
    provider_name: 'Example Provider',
    choices: [{
      finish_reason: 'stop',
      message: {
        content: '正式回复',
        reasoning: '先检查，再回答。',
        reasoning_summary: '检查后回答',
        reasoning_details: [{ type: 'summary', text: '结构化摘要' }],
        encrypted_content: 'opaque-encrypted-value',
      },
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 40,
      completion_tokens_details: { reasoning_tokens: 12 },
      prompt_tokens_details: { cached_tokens: 20 },
      total_tokens: 140,
      cost: 0.001,
    },
  }],
});
assert.equal(nonStream.metadata.requested_model, 'openai/test-requested');
assert.equal(nonStream.metadata.resolved_model, 'openai/test-resolved');
assert.equal(nonStream.metadata.provider, 'Example Provider');
assert.equal(nonStream.metadata.reasoning_text, '先检查，再回答。');
assert.equal(nonStream.metadata.reasoning_summary, '检查后回答');
assert.equal(nonStream.metadata.reasoning_status, 'returned');
assert.equal(nonStream.metadata.reasoning_encrypted_content_present, true);
assert.equal(nonStream.metadata.reasoning_encrypted_content_length, 'opaque-encrypted-value'.length);
assert.match(nonStream.metadata.reasoning_encrypted_content_digest, /^[a-f0-9]{64}$/);
assert.equal(nonStream.metadata.usage.prompt_tokens, 100);
assert.equal(nonStream.metadata.usage.completion_tokens, 40);
assert.equal(nonStream.metadata.usage.reasoning_tokens, 12);
assert.equal(nonStream.metadata.usage.cached_tokens, 20);
assert.equal(nonStream.metadata.usage.total_tokens, 140);
assert.equal(nonStream.metadata.finish_reason, 'stop');
assert.equal(nonStream.metadata.request.temperature, 0.3);
assert.equal(nonStream.metadata.request.top_p, 0.9);
assert.equal(nonStream.metadata.request.max_tokens, 1234);
assert.equal(nonStream.metadata.request.reasoning_effort, 'high');
assert.equal(nonStream.metadata.request.reasoning_max_tokens, 600);
assert.ok(!JSON.stringify(nonStream.raw_metadata_sanitized).includes('opaque-encrypted-value'));
assert.ok(!JSON.stringify(nonStream.raw_metadata_sanitized).includes('正式回复'));

const noReasoning = createModelMetadataCollector({
  requestedModel: 'openai/plain',
  requestPayload: {
    temperature: null,
    top_p: null,
    max_tokens: null,
    reasoning: { max_tokens: null },
  },
});
noReasoning.observe({
  model: 'openai/plain',
  choices: [{ finish_reason: 'stop', message: { content: 'hello' } }],
  usage: {
    prompt_tokens: null,
    completion_tokens: null,
    reasoning_tokens: null,
    cached_tokens: null,
    total_tokens: null,
    cost: null,
  },
});
const noReasoningSnapshot = await noReasoning.snapshot();
assert.equal(noReasoningSnapshot.metadata.reasoning_text, null);
assert.equal(noReasoningSnapshot.metadata.reasoning_summary, null);
assert.equal(noReasoningSnapshot.metadata.reasoning_details, null);
assert.equal(noReasoningSnapshot.metadata.reasoning_status, 'not_returned');
assert.equal(noReasoningSnapshot.metadata.usage, null);
assert.equal(noReasoningSnapshot.metadata.request.temperature, null);
assert.equal(noReasoningSnapshot.metadata.request.top_p, null);
assert.equal(noReasoningSnapshot.metadata.request.max_tokens, null);
assert.equal(noReasoningSnapshot.metadata.request.reasoning_max_tokens, null);

const exactlyFullRaw = createModelMetadataCollector({ requestedModel: 'openai/raw-limit' });
for (let index = 0; index < 160; index += 1) {
  exactlyFullRaw.observe({ id: `frame-${index}`, model: 'openai/raw-limit', choices: [] });
}
const exactlyFullRawSnapshot = await exactlyFullRaw.snapshot();
assert.equal(exactlyFullRawSnapshot.raw_metadata_sanitized.provider_calls.length, 160);
assert.equal(exactlyFullRawSnapshot.raw_metadata_sanitized.frames_truncated, false);
exactlyFullRaw.observe({ id: 'frame-160', model: 'openai/raw-limit', choices: [] });
const truncatedRawSnapshot = await exactlyFullRaw.snapshot();
assert.equal(truncatedRawSnapshot.raw_metadata_sanitized.provider_calls.length, 160);
assert.equal(truncatedRawSnapshot.raw_metadata_sanitized.frames_truncated, true);

const context = contextMessages({
  version: 4,
  turns: [
    {
      id: 'turn_1',
      user: {
        active: 0,
        variants: [{ id: 'user_1', content: '第一问', created_at: '2026-09-05T00:00:00Z' }],
      },
      assistant: {
        activeByUserVariant: { '0': 0 },
        variantsByUserVariant: {
          '0': [{
            id: 'assistant_1',
            content: '第一答',
            created_at: '2026-09-05T00:00:01Z',
            reasoning_text: '绝不能进入下一轮',
            model_metadata: { reasoning_text: '也绝不能进入下一轮' },
            raw_metadata_sanitized: { secret: '绝不能进入下一轮' },
          }],
        },
      },
    },
    {
      id: 'turn_2',
      user: {
        active: 0,
        variants: [{ id: 'user_2', content: '第二问', created_at: '2026-09-05T00:01:00Z' }],
      },
      assistant: { activeByUserVariant: { '0': 0 }, variantsByUserVariant: { '0': [] } },
    },
  ],
}, 'turn_2', { recentTurns: 8 });
assert.deepEqual(context, [
  { role: 'user', content: '第一问', turn_id: 'turn_1' },
  { role: 'assistant', content: '第一答', turn_id: 'turn_1' },
  { role: 'user', content: '第二问', turn_id: 'turn_2' },
]);
assert.ok(!JSON.stringify(context).includes('reasoning'));
assert.ok(!JSON.stringify(context).includes('绝不能进入下一轮'));

console.log('model-metadata.test.mjs: ok');
