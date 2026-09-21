import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const entry = await read('tests/dom.test.mjs');
const lines = entry.trimEnd().split('\n').length;
assert.ok(lines <= 260, `dom.test.mjs regrew to ${lines} lines`);

const modules = [
  'dom-harness.mjs',
  'dom-chat-flow.test.mjs',
  'dom-memory-flow.test.mjs',
  'dom-daily-flow.test.mjs',
  'dom-desk-flow.test.mjs',
];
const sources = {};
for (const name of modules) {
  sources[name] = await read(`tests/dom/${name}`);
  assert.ok(sources[name].trim(), `${name} must exist`);
  assert.ok(entry.includes(name), `${name} must be wired by dom.test.mjs`);
}
const calls = [
  'await bootstrapDomHarness()',
  'await runChatPrelude()',
  'await runMemoryFlow()',
  'await runDeskFlow()',
  'await runDailyFlow()',
  'await runChatTypedRooms()',
];
let previous = -1;
for (const call of calls) {
  const index = entry.indexOf(call);
  assert.ok(index > previous, `${call} must preserve the integration-flow execution order`);
  previous = index;
}

const chat = sources['dom-chat-flow.test.mjs'];
for (const marker of ['mock: a1', 'landing regenerate request', 'radio web message receives API reply', 'lighthouse web send must not call formal chat generation']) {
  assert.ok(chat.includes(marker), `chat flow must retain: ${marker}`);
}
const memory = sources['dom-memory-flow.test.mjs'];
for (const marker of ['pending pocket route', 'write canonical pocket to memory library', 'manual memory saved']) assert.ok(memory.includes(marker));
const daily = sources['dom-daily-flow.test.mjs'];
for (const marker of ['direct Diary create', 'direct Moment create', 'Moment like', 'confirmed Daily comment delete']) assert.ok(daily.includes(marker));
const desk = sources['dom-desk-flow.test.mjs'];
for (const marker of ['屋主设置 route', 'basic settings route', 'action log route through Event Spine', 'model quick picker', 'model search']) assert.ok(desk.includes(marker));
const harness = sources['dom-harness.mjs'];
assert.match(harness, /new Window\(/);
assert.match(harness, /globalThis\.fetch/);
assert.equal(harness.includes('image_refs'), false, 'retired Daily image refs must not survive in the DOM harness');
console.log(`dom-split: ok (${lines} lines)`);
