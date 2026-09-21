import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const base = 'elementera-mcp/deploy-pages/public/features/chat/';
const generation = await read(`${base}chat-generation.js`);
const worker = await read('elementera-mcp/deploy-pages/service-worker.js');
const lines = generation.trimEnd().split('\n').length;
assert.ok(lines <= 260, `chat-generation.js regrew to ${lines} lines`);
assert.match(generation, /export function createChatGeneration\(/);
assert.match(generation, /room_type === 'lighthouse'/);
assert.match(generation, /onReplyCompleted/);
assert.match(generation, /saveHistory/);
assert.match(generation, /autoTitle/);
assert.doesNotMatch(generation, /function contextMessages\(/);
assert.doesNotMatch(generation, /function chatRequestContext\(/);
assert.doesNotMatch(generation, /item\.event === 'delta'/);

for (const name of ['chat-context.js', 'chat-request-context.js', 'chat-stream-flow.js', 'chat-local-time.js', 'chat-title-landing.js']) {
  const source = await read(`${base}${name}`);
  assert.ok(source.trim(), `${name} must exist`);
  assert.ok(worker.includes(`/public/features/chat/${name}`), `${name} must be precached`);
}
const context = await read(`${base}chat-context.js`);
assert.match(context, /official_mcp/);
assert.match(context, /recentTurns/);
const request = await read(`${base}chat-request-context.js`);
assert.match(request, /replyTokenBudget/);
assert.match(request, /seedCooldownTurns/);
const stream = await read(`${base}chat-stream-flow.js`);
for (const event of ['desk_slip', 'meta', 'delta', 'usage', 'done', 'error']) assert.ok(stream.includes(`'${event}'`));
assert.match(stream, /stream_incomplete/);
console.log(`chat-generation-split: ok (${lines} lines)`);
