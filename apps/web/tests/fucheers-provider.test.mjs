import assert from 'node:assert/strict';
import { fetchModelCatalog, providerRoute } from '../functions/models/model-catalog.js';
import { prepareFormalChat } from '../functions/models/model-payload.js';
import { requestProviderChat, performFormalChatStream } from '../functions/models/model-formal-chat-core.js';

const originalFetch = globalThis.fetch;
const env = { OPENROUTER_API_KEY: 'test-openrouter', FUCHEERS_API_KEY: 'test-fucheers' };
const sent = [];
let failFucheers = false;
globalThis.fetch = async (url, options = {}) => {
  const address = String(url);
  sent.push({ address, options });
  if (address.endsWith('/models') || address.includes('/models?')) {
    if (address.includes('fucheers')) {
      if (failFucheers) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ data: [{ id: 'gpt-5.5', name: 'GPT-5.5' }, { id: 'claude-karo' }] }) };
    }
    return { ok: true, json: async () => ({ data: [{
      id: 'openai/gpt-5.5', name: 'GPT-5.5 via OpenRouter',
      architecture: { output_modalities: ['text'] },
      supported_parameters: ['tools', 'temperature'],
      pricing: { prompt: '1', completion: '2' },
    }] }) };
  }
  if (address.includes('fucheers')) {
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'gpt-5.5');
    assert.equal(options.headers.Authorization, 'Bearer test-fucheers');
    assert.equal('session_id' in payload, false);
    assert.equal(options.headers['HTTP-Referer'], undefined);
    if (payload.stream) {
      const bytes = new TextEncoder().encode(
        'data: ' + JSON.stringify({ id: 'test', model: 'gpt-5.5', choices: [{ delta: { content: '你好' }, finish_reason: 'stop' }] }) +
        '\n\ndata: [DONE]\n\n'
      );
      return { ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
    }
    return { ok: true, json: async () => ({ model: 'gpt-5.5', choices: [{ message: { content: '你好' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) };
  }
  throw new Error('Unexpected request ' + address);
};
try {
  const catalog = await fetchModelCatalog(env, true);
  assert.equal(catalog.providers.fucheers.status, 'ok');
  assert.equal(catalog.groups.fucheers_chat[0].id, 'fucheers:gpt-5.5');
  assert.equal(catalog.groups.fucheers_chat.length, 1);
  assert.equal(catalog.groups.openai_chat[0].id, 'openai/gpt-5.5');
  assert.equal(providerRoute(env, 'fucheers:gpt-5.5').upstreamModel, 'gpt-5.5');

  const prepared = await prepareFormalChat(env, { model: 'fucheers:gpt-5.5', messages: [{ role: 'user', content: '你好' }] }, false);
  assert.equal(prepared.modelId, 'fucheers:gpt-5.5');
  const answer = await requestProviderChat(env, prepared.payload, 'test');
  assert.equal(answer.model, 'gpt-5.5');
  const stream = [];
  for await (const event of performFormalChatStream(env, {
    model: 'fucheers:gpt-5.5',
    messages: [{ role: 'user', content: '你好' }],
  })) stream.push(event);
  assert.equal(stream.find((item) => item.event === 'meta')?.data.model, 'fucheers:gpt-5.5');
  assert.equal(stream.find((item) => item.event === 'delta')?.data.content, '你好');

  failFucheers = true;
  const refreshed = await fetchModelCatalog(env, true);
  assert.equal(refreshed.providers.openrouter.status, 'ok');
  assert.equal(refreshed.providers.fucheers.status, 'error');
  assert.equal(refreshed.groups.fucheers_chat[0].id, 'fucheers:gpt-5.5');
  assert.ok(refreshed.providers.fucheers.last_success);
  assert.equal(sent.some((request) => request.address.includes('fucheers') &&
    request.options.headers?.Authorization === 'Bearer test-fucheers'), true);
  console.log('fucheers-provider: ok');
} finally {
  globalThis.fetch = originalFetch;
}
