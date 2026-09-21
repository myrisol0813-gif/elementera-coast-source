import assert from 'node:assert/strict';
import { handleLogin, unauthorized, verifySession } from '../functions/auth.js';
import { onRequest } from '../functions/_middleware.js';
import {
  isRequestBodyError,
  methodNotAllowed,
  requestBodyError,
  safeLogError,
  unexpectedApiError,
} from '../functions/http.js';
import {
  ModelRequestError,
  buildModelCatalog,
  normalizeUsage,
  performFormalChat,
  performFormalChatStream,
  performFormalChatWithTools,
} from '../functions/models.js';

const encoder = new TextEncoder();
const digest = await crypto.subtle.digest('SHA-256', encoder.encode('coast-password'));
const passwordHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const env = {
  COAST_PASSWORD_HASH: passwordHash,
  COAST_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
};

const disallowed = methodNotAllowed('GET, POST');
assert.equal(disallowed.status, 405);
assert.deepEqual(await disallowed.json(), {
  ok: false,
  error: { type: 'method_not_allowed', message: 'Method not allowed.', allow: 'GET, POST' },
});
const oversizedBodyError = Object.assign(new Error('body_too_large'), { status: 413 });
assert.equal(isRequestBodyError(oversizedBodyError), true);
assert.deepEqual(requestBodyError(oversizedBodyError), {
  type: 'body_too_large',
  message: '请求内容过长。',
  status: 413,
});
assert.deepEqual(requestBodyError(new Error('invalid_json'), {
  invalidType: 'invalid_request',
  invalidMessage: '请求体不是有效的 JSON。',
}), {
  type: 'invalid_request',
  message: '请求体不是有效的 JSON。',
  status: 400,
});

const originalConsoleError = console.error;
const safeLogLines = [];
console.error = (...values) => safeLogLines.push(values.join(' '));
const sensitiveError = Object.assign(new Error('访客正文绝不能进入日志'), {
  type: 'mailbox_failed',
  status: 500,
  details: { visitor_body: 'sealed' },
});
safeLogError('mailbox-api', sensitiveError, { reference: 'ref12345' });
const unexpected = unexpectedApiError('mailbox-api', sensitiveError, 'mailbox_failed', '访客信箱操作失败');
console.error = originalConsoleError;
assert.equal(safeLogLines.length, 2);
assert.ok(safeLogLines.every((line) => line.includes('mailbox_failed')));
assert.ok(safeLogLines.every((line) => !line.includes('访客正文')));
assert.ok(safeLogLines.every((line) => !line.includes('sealed')));
assert.equal(unexpected.status, 500);
assert.match((await unexpected.json()).error.message, /^访客信箱操作失败（[a-f0-9]{8}）。$/);

const login = await handleLogin(new Request('https://coast.test/login', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'password=coast-password',
}), env);
assert.equal(login.status, 302);
assert.equal(login.headers.get('location'), '/');
const cookie = login.headers.get('set-cookie');
assert.match(cookie, /^__Host-coast_session=/);
assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
assert.match(cookie, /Max-Age=315360000/, 'new owner login persists until explicit logout instead of expiring after 12 hours');

const token = cookie.split(';')[0];
const session = await verifySession(new Request('https://coast.test/', { headers: { Cookie: token } }), env);
assert.equal(session.v, 2);
assert.equal(session.persistence, 'until_logout');
assert.equal(Object.hasOwn(session, 'exp'), false, 'persistent owner sessions do not carry an automatic expiry timestamp');

const forbidden = await handleLogin(new Request('https://coast.test/login', {
  method: 'POST',
  headers: { Origin: 'https://evil.test' },
  body: 'password=coast-password',
}), env);
assert.equal(forbidden.status, 403);

const opaqueOriginLogin = await handleLogin(new Request('https://coast.test/login', {
  method: 'POST',
  headers: { Origin: 'null', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'password=coast-password',
}), env);
assert.equal(opaqueOriginLogin.status, 302);

const opaqueCrossSite = await handleLogin(new Request('https://coast.test/login', {
  method: 'POST',
  headers: { Origin: 'null', Referer: 'https://evil.test/form' },
  body: 'password=coast-password',
}), env);
assert.equal(opaqueCrossSite.status, 403);
assert.equal(unauthorized(new Request('https://coast.test/api/health')).status, 401);
assert.equal(unauthorized(new Request('https://coast.test/')).status, 302);

for (const pathname of [
  '/manifest.json',
  '/public/icons/icon-16.png',
  '/public/icons/icon-32.png',
  '/public/icons/apple-touch-icon.png',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
  '/public/icons/icon-maskable-512.png',
]) {
  let reachedStaticAsset = false;
  const response = await onRequest({
    request: new Request(`https://coast.test${pathname}`),
    env,
    next: async () => {
      reachedStaticAsset = true;
      return new Response('asset');
    },
  });
  assert.equal(response.status, 200, `${pathname} must remain available to PWA installers`);
  assert.equal(reachedStaticAsset, true, `${pathname} must bypass only the session gate`);
}
const protectedAppAsset = await onRequest({
  request: new Request('https://coast.test/public/app.js'),
  env,
  next: async () => { throw new Error('protected app asset must not bypass the session gate'); },
});
assert.equal(protectedAppAsset.status, 401);
const protectedMainHouse = await onRequest({
  request: new Request('https://coast.test/'),
  env,
  next: async () => { throw new Error('main house must not bypass the session gate'); },
});
assert.equal(protectedMainHouse.status, 302);

const catalog = buildModelCatalog({
  data: [
    { id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 Nano', architecture: { output_modalities: ['text'] }, pricing: { prompt: '0.1', completion: '0.2' } },
    { id: 'openai/gpt-image-2', name: 'GPT Image 2', architecture: { output_modalities: ['image'] }, pricing: { prompt: '0.1', completion: '0.2' } },
    { id: 'vendor/free:free', name: 'Free text', architecture: { output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'openai/text-embedding-3-small', name: 'Embedding', architecture: { output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } },
  ],
});
assert.deepEqual(catalog.groups.openai_chat.map((model) => model.id), ['openai/gpt-4.1-nano']);
assert.deepEqual(catalog.groups.openai_image.map((model) => model.id), ['openai/gpt-image-2']);
assert.ok(catalog.groups.free_test.some((model) => model.id === 'vendor/free:free'));
assert.equal(catalog.groups.free_test.some((model) => model.id === 'nvidia/nemotron-3-super-120b-a12b:free'), false, 'retired sandbox model must not be injected');
assert.equal(normalizeUsage({ total_tokens: 99 }), null, 'incomplete provider usage must not be treated as real usage');

const originalFetch = globalThis.fetch;
const modelCatalogPayload = {
  data: [{
    id: 'openai/gpt-4.1-nano',
    name: 'GPT-4.1 Nano',
    architecture: { output_modalities: ['text'] },
    pricing: { prompt: '0.1', completion: '0.2' },
    supported_parameters: ['temperature', 'tools', 'tool_choice'],
  }],
};
const modelEnv = { OPENROUTER_API_KEY: 'test-key' };
let nonStreamingPayload = null;
let fetchCount = 0;
globalThis.fetch = async (url, options = {}) => {
  fetchCount += 1;
  if (String(url).includes('/models?')) {
    return new Response(JSON.stringify(modelCatalogPayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  nonStreamingPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({
    model: 'openai/gpt-4.1-nano',
    choices: [{ message: { role: 'assistant', content: 'JSON reply' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const nonStreaming = await performFormalChat(modelEnv, {
  model: 'openai/gpt-4.1-nano',
  messages: [{ role: 'user', content: 'hello' }],
  settings: { max_tokens: 100, temperature: 0.2 },
});
assert.equal(fetchCount, 2);
assert.equal('stream' in nonStreamingPayload, false, 'non-streaming path must keep the JSON provider request');
assert.equal(nonStreaming.message.content, 'JSON reply');
assert.deepEqual(nonStreaming.usage, { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 });
assert.equal(nonStreaming.finish_reason, 'stop');
await performFormalChat(modelEnv, {
  model: 'openai/gpt-4.1-nano',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: '看图' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
    ],
  }],
  settings: { max_tokens: 100, temperature: 0.2 },
});
assert.equal(Array.isArray(nonStreamingPayload.messages[0].content), true, 'validated image parts reach the provider payload');
assert.equal(nonStreamingPayload.messages[0].content[1].type, 'image_url');


await performFormalChat(modelEnv, {
  model: 'openai/gpt-4.1-nano',
  messages: [{ role: 'user', content: 'configured output ceiling' }],
  settings: { max_tokens: null, maxOutputTokens: 1234, temperature: 0.2 },
});
assert.equal(nonStreamingPayload.max_completion_tokens, 1234, 'configured output ceiling must be sent to OpenRouter');

let webSearchPayload = null;
globalThis.fetch = async (_url, options = {}) => {
  webSearchPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({
    model: 'openai/gpt-4.1-nano',
    choices: [{
      message: {
        role: 'assistant',
        content: '这里是最新资料。',
        annotations: [{
          type: 'url_citation',
          url_citation: {
            url: 'https://example.com/latest',
            title: 'Latest Example',
            content: 'Fresh source excerpt.',
          },
        }],
      },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 6,
      total_tokens: 26,
      server_tool_use: { web_search_requests: 2 },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const webSearchResult = await performFormalChat(modelEnv, {
  model: 'openai/gpt-4.1-nano',
  messages: [{ role: 'user', content: '查一下最新资料' }],
  tools: [{
    type: 'openrouter:web_search',
    parameters: { engine: 'auto', max_results: 5, max_total_results: 10, search_context_size: 'medium' },
  }],
  web_search_query: '查一下最新资料',
});
assert.equal(webSearchPayload.tools[0].type, 'openrouter:web_search');
assert.equal(webSearchPayload.tools[0].parameters.max_results, 5);
assert.equal(webSearchResult.server_tools.web_search.available, true);
assert.equal(webSearchResult.server_tools.web_search.used, true);
assert.equal(webSearchResult.server_tools.web_search.requests, 2);
assert.equal(webSearchResult.server_tools.web_search.results_count, 1);
assert.equal(webSearchResult.server_tools.web_search.results[0].url, 'https://example.com/latest');
assert.equal(webSearchResult.server_tools.web_search.requested_query, '查一下最新资料');

const testTools = [{
  type: 'function',
  function: {
    name: 'create_moment',
    description: 'test',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
}];
const toolPayloads = [];
let executedTool = null;
globalThis.fetch = async (_url, options = {}) => {
  const payload = JSON.parse(options.body);
  toolPayloads.push(payload);
  if (toolPayloads.length === 1) {
    return new Response(JSON.stringify({
      model: 'openai/gpt-4.1-nano',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call-json-1',
            type: 'function',
            function: { name: 'create_moment', arguments: '{"text":"海岸动态"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    model: 'openai/gpt-4.1-nano',
    choices: [{ message: { role: 'assistant', content: '已经写进碳硅圈。' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const toolResult = await performFormalChatWithTools(modelEnv, {
  model: 'openai/gpt-4.1-nano',
  messages: [{ role: 'user', content: '发一条动态' }],
  tools: testTools,
}, {
  executeTool: async (call) => {
    executedTool = call;
    return { ok: true, id: 'moment-1' };
  },
});
assert.equal(executedTool.id, 'call-json-1');
assert.equal(executedTool.function.name, 'create_moment');
assert.equal(toolPayloads[0].tools[0].function.name, 'create_moment');
assert.equal(toolPayloads[1].tool_choice, 'auto', 'tool loop keeps tools available until the model finishes');
assert.equal(toolPayloads[1].tools[0].function.name, 'create_moment');
assert.equal(toolPayloads[1].messages.at(-1).role, 'tool');
assert.equal(toolResult.message.content, '已经写进碳硅圈。');
assert.deepEqual(toolResult.usage, { prompt_tokens: 25, completion_tokens: 7, total_tokens: 32 });
assert.equal(toolResult.tool_results[0].result.id, 'moment-1');

let streamingPayload = null;
const streamBytes = [
  ': keepalive\n\n',
  'data: {"id":"gen-1","model":"openai/gpt-4.1-nano","choices":[{"delta":{"content":"海"}}]}\n\n',
  'data: {"id":"gen-1","model":"openai/gpt-4.1-nano","choices":[{"delta":{"content":"岸"}}],"usa',
  'ge":{"prompt_tokens":21,"completion_tokens":2,"total_tokens":23}}\n\n',
  'data: {"id":"gen-1","model":"openai/gpt-4.1-nano","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n',
];
globalThis.fetch = async (_url, options = {}) => {
  streamingPayload = JSON.parse(options.body);
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of streamBytes) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(source, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};
const streamEvents = [];
for await (const item of performFormalChatStream(modelEnv, {
  model: 'openai/gpt-4.1-nano',
  messages: [{ role: 'user', content: 'stream' }],
  settings: { max_tokens: 100, temperature: 0.2 },
}, {
  executeTool: async () => ({ ok: true }),
})) streamEvents.push(item);
assert.equal(streamingPayload.stream, true);
assert.equal(streamingPayload.stream_options.include_usage, true);
assert.deepEqual(streamEvents.map((item) => item.event), ['meta', 'delta', 'delta', 'server_tools', 'usage', 'done']);
assert.deepEqual(streamEvents[0].data, { model: 'openai/gpt-4.1-nano', generation_id: 'gen-1' });
assert.equal(streamEvents.filter((item) => item.event === 'delta').map((item) => item.data.content).join(''), '海岸');
assert.deepEqual(streamEvents.find((item) => item.event === 'usage').data, { prompt_tokens: 21, completion_tokens: 2, total_tokens: 23 });
assert.equal(streamEvents.find((item) => item.event === 'server_tools').data.web_search.available, false);
assert.equal(streamEvents.at(-1).data.finish_reason, 'stop');

const toolStreamPayloads = [];
let streamedTool = null;
const toolStreamResponses = [
  [
    'data: {"id":"gen-tool-1","model":"openai/gpt-4.1-nano","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-stream-1","type":"function","function":{"name":"create_","arguments":"{\\"text\\":\\""}}]}}]}\n\n',
    'data: {"id":"gen-tool-1","model":"openai/gpt-4.1-nano","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"moment","arguments":"海岸动态\\"}"}}]}}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
    'data: {"id":"gen-tool-1","model":"openai/gpt-4.1-nano","choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    'data: [DONE]\n\n',
  ],
  [
    'data: {"id":"gen-tool-2","model":"openai/gpt-4.1-nano","choices":[{"delta":{"content":"已经"}}]}\n\n',
    'data: {"id":"gen-tool-2","model":"openai/gpt-4.1-nano","choices":[{"delta":{"content":"发布。"}}],"usage":{"prompt_tokens":15,"completion_tokens":3,"total_tokens":18}}\n\n',
    'data: {"id":"gen-tool-2","model":"openai/gpt-4.1-nano","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ],
];
globalThis.fetch = async (_url, options = {}) => {
  toolStreamPayloads.push(JSON.parse(options.body));
  const chunks = toolStreamResponses[toolStreamPayloads.length - 1];
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};
const toolStreamEvents = [];
for await (const item of performFormalChatStream(modelEnv, {
  model: 'openai/gpt-4.1-nano',
  messages: [{ role: 'user', content: '流式发布动态' }],
  tools: testTools,
}, {
  executeTool: async (call) => {
    streamedTool = call;
    return { ok: true, id: 'moment-stream-1' };
  },
})) toolStreamEvents.push(item);
assert.equal(streamedTool.function.arguments, '{"text":"海岸动态"}');
assert.equal(toolStreamPayloads.length, 2);
assert.equal(toolStreamPayloads[1].tool_choice, 'auto', 'streaming tool loop keeps tools available until the model finishes');
assert.equal(toolStreamPayloads[1].messages.at(-1).role, 'tool');
assert.equal(toolStreamEvents.find((item) => item.event === 'tool').data.ok, true);
assert.equal(toolStreamEvents.find((item) => item.event === 'server_tools').data.web_search.available, false);
assert.equal(toolStreamEvents.filter((item) => item.event === 'delta').map((item) => item.data.content).join(''), '已经发布。');
assert.deepEqual(toolStreamEvents.find((item) => item.event === 'usage').data, {
  prompt_tokens: 25,
  completion_tokens: 5,
  total_tokens: 30,
});
assert.equal(toolStreamEvents.at(-1).data.finish_reason, 'stop');

let incompleteError = null;
globalThis.fetch = async () => new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(encoder.encode('data: {"id":"gen-cut","model":"openai/gpt-4.1-nano","choices":[{"delta":{"content":"partial"}}]}\n\n'));
    controller.close();
  },
}), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
try {
  for await (const _item of performFormalChatStream(modelEnv, {
    model: 'openai/gpt-4.1-nano', messages: [{ role: 'user', content: 'cut' }],
  }, {
    executeTool: async () => ({ ok: true }),
  })) { /* consume */ }
} catch (error) {
  incompleteError = error;
}
assert.ok(incompleteError instanceof ModelRequestError);
assert.equal(incompleteError.type, 'stream_incomplete');

let providerStreamError = null;
globalThis.fetch = async () => new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(encoder.encode('data: {"error":{"code":503,"message":"secret upstream diagnostic"}}\n\n'));
    controller.close();
  },
}), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
try {
  for await (const _item of performFormalChatStream(modelEnv, {
    model: 'openai/gpt-4.1-nano', messages: [{ role: 'user', content: 'error' }],
  }, {
    executeTool: async () => ({ ok: true }),
  })) { /* consume */ }
} catch (error) {
  providerStreamError = error;
}
assert.equal(providerStreamError.type, 'provider_unavailable');
assert.doesNotMatch(providerStreamError.message, /secret upstream diagnostic/i, 'provider raw stream diagnostics must not leak');

globalThis.fetch = originalFetch;

console.log('backend: ok');
