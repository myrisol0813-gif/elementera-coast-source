import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { APP_CACHE_NAME } from '../scripts/cache-versions.mjs';

const root = resolve(import.meta.dirname, '..');
const memoryPath = resolve(root, 'elementera-mcp/deploy-pages/public/features/memory.js');
const memorySource = await readFile(memoryPath, 'utf8');
const memoryLines = memorySource.split(/\r?\n/).length;

assert.ok(memoryLines <= 350, `memory.js should stay thin (<=350 lines), got ${memoryLines}`);
assert.match(memorySource, /export function createMemory\(/);
for (const forbidden of [
  'function soilBody(',
  'function pocketCard(',
  'function entryCard(',
  'function libraryControls(',
  'function filterMenu(',
]) {
  assert.equal(memorySource.includes(forbidden), false, `memory.js must not re-absorb ${forbidden}`);
}

const moduleNames = [
  'memory-constants.js',
  'memory-format.js',
  'memory-client.js',
  'memory-soil-view.js',
  'memory-pocket-view.js',
  'memory-library-view.js',
  'memory-global-excerpt-view.js',
  'memory-custom-view.js',
  'memory-actions.js',
];
const moduleSources = new Map();
for (const name of moduleNames) {
  const source = await readFile(resolve(root, `elementera-mcp/deploy-pages/public/features/memory/${name}`), 'utf8');
  moduleSources.set(name, source);
}

assert.match(moduleSources.get('memory-constants.js'), /MEMORY_FILTER_KIND_ORDER/);
assert.match(moduleSources.get('memory-client.js'), /API\.memorySoil/);
assert.match(moduleSources.get('memory-client.js'), /API\.memoryPockets/);
assert.match(moduleSources.get('memory-client.js'), /API\.memoryEntries/);
assert.match(moduleSources.get('memory-soil-view.js'), /名称｜生命核｜使用提示｜避免提示/);
assert.match(moduleSources.get('memory-pocket-view.js'), /只有确认后才会进入记忆库或种子库/);
assert.match(moduleSources.get('memory-library-view.js'), /搜索与筛选放在同一处/);
assert.match(moduleSources.get('memory-global-excerpt-view.js'), /写入说明 \/ 收录准则/);
assert.match(moduleSources.get('memory-global-excerpt-view.js'), /正式正文/);
assert.match(moduleSources.get('memory-global-excerpt-view.js'), /待确认修改/);
assert.match(moduleSources.get('memory-global-excerpt-view.js'), /修改记录/);
assert.match(moduleSources.get('memory-custom-view.js'), /自定义指令已保存|当前自定义指令/);
assert.match(moduleSources.get('memory-actions.js'), /已经写入种子库/);
assert.match(moduleSources.get('memory-actions.js'), /整理当前对话的纸条已保存/);

const serviceWorker = await readFile(resolve(root, 'elementera-mcp/deploy-pages/service-worker.js'), 'utf8');
assert.ok(serviceWorker.includes(`const CACHE_NAME = '${APP_CACHE_NAME}';`));
for (const name of moduleNames) {
  assert.ok(
    serviceWorker.includes(`/public/features/memory/${name}`),
    `service worker must precache ${name}`,
  );
}

console.log(`memory-ui-split: ok (${memoryLines} lines)`);
