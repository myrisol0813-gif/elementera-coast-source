import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  WIDGET_URI,
  clearO3ReplyCardMemory,
  handleO3ReplyCardRequest,
  isO3ReplyCardPublicPath,
} from '../functions/o3-reply-card-mcp.js';
import { onRequest as handleMiddlewareRequest } from '../functions/_middleware.js';

const endpoint = 'https://elementera-coast-source.invalid/o3/mcp';

async function post(method, params, id = 1, accept = 'application/json') {
  return handleO3ReplyCardRequest(new Request(endpoint, {
    method: 'POST',
    headers: {
      Accept: accept,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  }));
}

clearO3ReplyCardMemory();

const health = await handleO3ReplyCardRequest(
  new Request('https://elementera-coast-source.invalid/o3/health')
);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), {
  status: 'ok',
  service: 'o3-reply-card-mcp',
  version: '0.1.0',
});
assert.equal(isO3ReplyCardPublicPath('/o3/mcp'), true);
assert.equal(isO3ReplyCardPublicPath('/o3/health/'), true);
assert.equal(isO3ReplyCardPublicPath('/unrelated/mcp'), false);

const retiredServiceBase = '/o3-' + 'temporary-' + '0'.repeat(32);
for (const suffix of ['/mcp', '/health']) {
  const retiredResponse = await handleMiddlewareRequest({
    request: new Request('https://elementera-coast-source.invalid' + retiredServiceBase + suffix),
    env: {},
    next() {
      throw new Error('retired o3 service path reached the protected fallback');
    },
  });
  assert.equal(retiredResponse.status, 404);
}

const listResponse = await post('tools/list', {}, 2);
const listPayload = await listResponse.json();
assert.deepEqual(listPayload.result.tools.map((tool) => tool.name), ['o3_reply_card']);
assert.equal(JSON.stringify(listPayload).includes('render_thinking_block'), false);

const body = '如果你能看到这段话，说明 o3 回复卡已经可以显示正文。';
const writeResponse = await post('tools/call', {
  name: 'o3_reply_card',
  arguments: {
    action: 'write_reply',
    session_id: 'pages-isolation-test',
    title: 'o3 回复测试',
    user_anchor: '测试卡片是否显示',
    body,
    continuity_state: '本轮测试卡片显示。',
    footer: '本轮结束',
    skin: 'winter',
  },
}, 3);
const writePayload = await writeResponse.json();
const result = writePayload.result;
assert.equal(result.isError, false);
assert.ok(result.content[0].text.includes('O3_REPLY_CARD_CONTEXT_BEGIN'));
assert.ok(result.content[0].text.includes(body));
assert.equal(result.structuredContent.body, body);
assert.equal(result._meta.body, body);
assert.notEqual(result.content[0].text, 'rendered');

const readResponse = await post('tools/call', {
  name: 'o3_reply_card',
  arguments: {
    action: 'read_context',
    session_id: 'pages-isolation-test',
    history_limit: 10,
  },
}, 4);
const readPayload = await readResponse.json();
assert.ok(readPayload.result.content[0].text.includes(body));
assert.ok(readPayload.result.content[0].text.includes('本轮测试卡片显示。'));

const resourcesResponse = await post('resources/list', {}, 5);
const resourcesPayload = await resourcesResponse.json();
assert.deepEqual(resourcesPayload.result.resources.map((resource) => resource.uri), [WIDGET_URI]);

const functionSource = await readFile(
  new URL('../functions/o3-reply-card-mcp.js', import.meta.url),
  'utf8'
);
const imports = [...functionSource.matchAll(/^import\s+.*?from\s+['"](.+?)['"];?$/gm)]
  .map((match) => match[1]);
assert.deepEqual(imports, ['./o3-reply-card-widget.js']);
for (const forbidden of [
  'render_thinking_block',
  "from './mcp-tools.js'",
  "from './mcp-auth.js'",
  'Notion',
  'D1',
  'CAPTURE_ENABLED',
]) {
  assert.equal(
    functionSource.includes(forbidden),
    false,
    'isolated function contains ' + forbidden
  );
}

const middlewareSource = await readFile(
  new URL('../functions/_middleware.js', import.meta.url),
  'utf8'
);
const isolatedRouteIndex = middlewareSource.indexOf('isO3ReplyCardPublicPath(url.pathname)');
const existingMcpIndex = middlewareSource.indexOf('isMcpPublicPath(url.pathname)');
const authIndex = middlewareSource.indexOf('verifySession(request, env)');
assert.ok(isolatedRouteIndex > -1);
assert.ok(isolatedRouteIndex < existingMcpIndex);
assert.ok(isolatedRouteIndex < authIndex);

console.log('o3 reply-card isolated Pages route: OK');
