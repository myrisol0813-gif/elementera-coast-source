import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shortModelName as sharedShortModelName } from '../elementera-mcp/deploy-pages/public/core/model-format.js';
import { shortModelName as chatShortModelName } from '../elementera-mcp/deploy-pages/public/features/chat/chat-profile.js';
import { shortModelName as dailyShortModelName } from '../elementera-mcp/deploy-pages/public/features/daily/daily-format.js';
import { shortModelName as memoryShortModelName } from '../elementera-mcp/deploy-pages/public/features/memory/memory-format.js';

const cases = new Map([
  ['openai/gpt-4.1-nano', 'GPT-4.1 nano'],
  ['openai/gpt-4.1-mini', 'GPT-4.1 mini'],
  ['openai/gpt-4.1-micro', 'GPT-4.1 micro'],
  ['openai/gpt-5.5-thinking', 'GPT-5.5-thinking'],
  ['nvidia/nemotron-3-super-120b-a12b:free', 'nemotron-3-super-120b-a12b'],
  ['vendor/unknown-model', 'unknown-model'],
  ['', ''],
  [null, ''],
]);

for (const [modelId, expected] of cases) {
  assert.equal(sharedShortModelName(modelId), expected);
  assert.equal(chatShortModelName(modelId), expected);
  assert.equal(dailyShortModelName(modelId), expected);
  assert.equal(memoryShortModelName(modelId), expected);
}
assert.strictEqual(chatShortModelName, sharedShortModelName);
assert.strictEqual(dailyShortModelName, sharedShortModelName);
assert.strictEqual(memoryShortModelName, sharedShortModelName);

const settingsSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/settings.js', import.meta.url), 'utf8');
assert.match(settingsSource, /import \{ shortModelName \} from '\.\.\/core\/model-format\.js';/);
assert.doesNotMatch(settingsSource, /function shortModelName\(/);
for (const path of [
  '../elementera-mcp/deploy-pages/public/features/chat/chat-profile.js',
  '../elementera-mcp/deploy-pages/public/features/daily/daily-format.js',
  '../elementera-mcp/deploy-pages/public/features/memory/memory-format.js',
]) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /function shortModelName\(/);
}
console.log('model-format: ok');
