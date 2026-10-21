import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const entryPath = 'elementera-mcp/deploy-pages/public/features/daily.js';
const entry = await read(entryPath);
const worker = await read('elementera-mcp/deploy-pages/service-worker.js');
const lines = entry.trimEnd().split('\n').length;
assert.ok(lines <= 260, `daily.js regrew to ${lines} lines`);
assert.match(entry, /export function createDaily\(/);
assert.match(entry, /const state = \{/);
assert.match(entry, /createDailyClient\(\)/);
assert.doesNotMatch(entry, /function momentCard\(/);
assert.doesNotMatch(entry, /function diaryCard\(/);
assert.doesNotMatch(entry, /compressImageFile/);

const modules = [
  'daily-constants.js',
  'daily-format.js',
  'daily-profile.js',
  'daily-moments-view.js',
  'daily-diaries-view.js',
  'daily-actions.js',
];
let cluster = entry;
for (const name of modules) {
  const path = `elementera-mcp/deploy-pages/public/features/daily/${name}`;
  const source = await read(path);
  cluster += `\n${source}`;
  assert.ok(source.trim(), `${name} must exist`);
  assert.ok(worker.includes(`/public/features/daily/${name}`), `${name} must be precached`);
}
for (const retired of ['image_refs', 'momentImageRef', 'diaryImageRef', 'summary', 'album', 'draft']) {
  if (retired === 'summary') continue;
  assert.equal(cluster.includes(retired), false, `${retired} must stay retired from Daily runtime`);
}
for (const field of ['owner_avatar_dataurl', 'model_partner_avatar_dataurl', 'moment_cover_dataurl']) {
  assert.ok(cluster.includes(field), `${field} persistence must remain`);
}
const actions = await read('elementera-mcp/deploy-pages/public/features/daily/daily-actions.js');
assert.doesNotMatch(actions, /requestJson\(/);
assert.match(actions, /client\.createMoment/);
assert.match(actions, /client\.createDiary/);
console.log(`daily-ui-split: ok (${lines} lines)`);

const html = await read('elementera-mcp/deploy-pages/index.html');
const icons = await read('elementera-mcp/deploy-pages/public/core/icons.js');
assert.doesNotMatch(html, /data-action="(?:calendar|library):open"/, 'calendar and shelf live in 小组件, not sidebar');
for (const [key, route] of [['calendar','calendar'],['library','library-home']]) {
  assert.match(entry, new RegExp("\\['" + key + "',"), key + ' must have a Daily card');
  assert.match(actions, new RegExp("name === '" + key + "'[^\\n]*router.open\\('" + route + "'\\)"), key + ' must be routed');
  assert.match(icons, new RegExp("  " + (key === 'library' ? 'book' : 'calendar') + ": outline\\("));
}
