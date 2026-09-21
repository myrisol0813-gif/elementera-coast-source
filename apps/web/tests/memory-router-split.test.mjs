import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

const [router, organizer, pockets, entries, soilRoute, searchRoute, customRoute, globalExcerptRoute, request] = await Promise.all([
  read('functions/memory-router.js'),
  read('functions/memory/memory-soil-organizer.js'),
  read('functions/memory/memory-pocket-route.js'),
  read('functions/memory/memory-entry-route.js'),
  read('functions/memory/memory-soil-route.js'),
  read('functions/memory/memory-search-route.js'),
  read('functions/memory/memory-custom-instructions-route.js'),
  read('functions/memory/memory-global-excerpt-route.js'),
  read('functions/memory/memory-request.js'),
]);

assert.ok(router.split('\n').length <= 220, 'memory-router.js must remain a thin routing entry');
for (const retiredFromRouter of ['SOIL_RESPONSE_FORMAT', 'soilPrompt(', 'parseStrictJson(', 'async function pockets(', 'async function entries(']) {
  assert.equal(router.includes(retiredFromRouter), false, `memory-router.js must not own ${retiredFromRouter}`);
}
assert.match(router, /export function isMemoryApiPath/);
assert.match(router, /export async function routeMemoryApi/);
assert.match(router, /routeSoilOrganize/);
assert.match(router, /routeMemoryPockets/);
assert.match(router, /routeMemoryEntries/);

assert.match(organizer, /SOIL_RESPONSE_FORMAT/);
assert.match(organizer, /function soilPrompt\(/);
assert.match(organizer, /organizeConversationSoil/);
assert.match(organizer, /整理当前对话的纸条/);
assert.match(organizer, /upsertSoilPocketCandidates/);
assert.match(organizer, /saveGenerationProvenance/);
assert.equal(organizer.includes('return json('), false, 'soil organizer returns domain objects, not HTTP responses');

assert.match(pockets, /routeMemoryPockets/);
assert.match(pockets, /resolvePocket/);
assert.match(pockets, /syncEntryVector/);
assert.match(entries, /routeMemoryEntries/);
assert.match(entries, /syncEntryVector/);
assert.match(entries, /deleteEntryVector/);
assert.match(soilRoute, /routeSoil/);
assert.match(soilRoute, /routeSoilOrganize/);
assert.match(searchRoute, /routeMemorySearch/);
assert.match(searchRoute, /routeMemoryRecall/);
assert.match(searchRoute, /routeVectorStatus/);
assert.match(customRoute, /routeCustomInstructions/);
assert.match(router, /routeGlobalExcerpt/);
assert.match(globalExcerptRoute, /GLOBAL_EXCERPT_PATH/);
assert.match(globalExcerptRoute, /confirmGlobalExcerptCandidate/);
assert.match(globalExcerptRoute, /discardGlobalExcerptCandidate/);
assert.match(request, /BODY_LIMIT = 48 \* 1024/);
assert.match(request, /请求体不是有效的 JSON。/);
assert.match(request, /请求体过大。/);

console.log('memory-router-split: ok');
