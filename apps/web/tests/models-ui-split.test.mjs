import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const entry = await read('elementera-mcp/deploy-pages/public/features/models.js');
const worker = await read('elementera-mcp/deploy-pages/service-worker.js');
const lines = entry.trimEnd().split('\n').length;
assert.ok(lines <= 220, `models.js regrew to ${lines} lines`);
assert.match(entry, /export function createModels\(/);
assert.match(entry, /let catalog = null/);
assert.match(entry, /let search = ''/);

const modules = [
  'models-constants.js',
  'models-format.js',
  'models-client.js',
  'models-view.js',
  'models-quick-picker.js',
  'models-actions.js',
];
for (const name of modules) {
  const path = `elementera-mcp/deploy-pages/public/features/models/${name}`;
  const source = await read(path);
  assert.ok(source.trim(), `${name} must exist`);
  assert.ok(worker.includes(`/public/features/models/${name}`), `${name} must be precached`);
}
const client = await read('elementera-mcp/deploy-pages/public/features/models/models-client.js');
assert.match(client, /API\.models/);
for (const name of ['models-view.js', 'models-quick-picker.js', 'models-actions.js']) {
  assert.doesNotMatch(await read(`elementera-mcp/deploy-pages/public/features/models/${name}`), /requestJson\(/);
}
for (const key of ['model_box', 'current_chat_model', 'current_image_model']) assert.ok(entry.includes(key));
console.log(`models-ui-split: ok (${lines} lines)`);
