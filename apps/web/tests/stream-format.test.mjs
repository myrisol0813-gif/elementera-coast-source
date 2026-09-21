import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SseParseError as BackendSseParseError,
  encodeSseEvent as encodeBackend,
  parseSseEventBlock as parseBackend,
} from '../functions/stream-format.js';
import {
  SseParseError as BrowserSseParseError,
  encodeSseEvent as encodeBrowser,
  parseSseEventBlock as parseBrowser,
} from '../elementera-mcp/deploy-pages/public/core/stream-format.js';
import { createCoastSseParser } from '../elementera-mcp/deploy-pages/public/features/chat/chat-stream.js';

const codecs = [
  ['backend', parseBackend, encodeBackend, BackendSseParseError],
  ['browser', parseBrowser, encodeBrowser, BrowserSseParseError],
];

const samples = [
  ['event: delta\ndata: {"content":"海岸"}', { event: 'delta', data: { content: '海岸' } }],
  ['data: {"ok":true}', { event: 'message', data: { ok: true } }],
  ['event: delta\ndata: {"content":\ndata: "多行"}', { event: 'delta', data: { content: '多行' } }],
  [': ping\nevent: usage\ndata: {"total_tokens":3}', { event: 'usage', data: { total_tokens: 3 } }],
  ['id: evt-7\nretry: 1500\nevent: done\ndata: {"finish_reason":"stop"}', {
    event: 'done', data: { finish_reason: 'stop' }, id: 'evt-7', retry: 1500,
  }],
  ['data: [DONE]', { event: 'message', data: '[DONE]' }],
];

for (const [name, parse, encode, ParseError] of codecs) {
  for (const [block, expected] of samples) assert.deepEqual(parse(block), expected, `${name}: ${block}`);
  assert.equal(parse(': comment only'), null);
  assert.throws(() => parse('event: delta\ndata: {bad json}'), (error) => {
    assert.ok(error instanceof ParseError);
    assert.equal(error.type, 'invalid_stream_event');
    return true;
  });
  const encoded = encode('delta', { content: 'roundtrip' }, { id: 'evt-1', retry: 750 });
  assert.equal(encoded, 'id: evt-1\nretry: 750\nevent: delta\ndata: {"content":"roundtrip"}\n\n');
  assert.deepEqual(parse(encoded.trimEnd()), {
    event: 'delta', data: { content: 'roundtrip' }, id: 'evt-1', retry: 750,
  });
}

for (const [block] of samples) assert.deepEqual(parseBrowser(block), parseBackend(block), `codec parity: ${block}`);
assert.equal(encodeBrowser('usage', { total_tokens: 9 }), encodeBackend('usage', { total_tokens: 9 }));

const partial = [];
const parser = createCoastSseParser((event) => partial.push(event));
parser.push('event: delta\ndata: {"content":"半');
assert.equal(partial.length, 0);
parser.push('截"}\n\n');
assert.deepEqual(partial, [{ event: 'delta', data: { content: '半截' } }]);

const formalSource = await readFile(new URL('../functions/models/model-formal-chat-core.js', import.meta.url), 'utf8');
assert.match(formalSource, /parseSseEventBlock/);
assert.doesNotMatch(formalSource, /function sseData\(/);
assert.match(formalSource, /parsedEvent\.data === '\[DONE\]'/);
assert.match(formalSource, /streamChunkError/);
assert.match(formalSource, /appendStreamToolCalls/);

const routerSource = await readFile(new URL('../functions/chat-router.js', import.meta.url), 'utf8');
assert.match(routerSource, /const data = item\.event === 'meta' && metadataContext\.messageId/);
assert.match(routerSource, /message_id: metadataContext\.messageId/);
assert.match(routerSource, /encodeSseEvent\(item\.event, data\)/);
assert.match(routerSource, /encodeSseEvent\('desk_slip'/);
assert.match(routerSource, /encodeSseEvent\('error'/);
assert.doesNotMatch(routerSource, /function sseEvent\(/);

for (const event of ['meta', 'delta', 'usage', 'done', 'error', 'desk_slip']) {
  const encoded = encodeBackend(event, { marker: event });
  assert.deepEqual(parseBrowser(encoded.trimEnd()), { event, data: { marker: event } });
}

const browserStreamSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-stream.js', import.meta.url), 'utf8');
assert.doesNotMatch(browserStreamSource, /function parseSseBlock\(/);
assert.match(browserStreamSource, /parseSseEventBlock/);

console.log('stream-format: ok');
