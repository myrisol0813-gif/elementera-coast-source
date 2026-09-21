import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entryPath = resolve(root, 'functions/memory-store.js');
const entry = await readFile(entryPath, 'utf8');
const lines = entry.split('\n').length;
assert.ok(lines <= 180, `memory-store.js regrew to ${lines} lines`);
assert.doesNotMatch(entry, /CREATE TABLE IF NOT EXISTS conversation_soils/);
assert.doesNotMatch(entry, /function pocketFromRow\s*\(/);
assert.doesNotMatch(entry, /export async function createEntry\s*\(/);

const expectedModules = [
  'memory-db.js',
  'memory-schema.js',
  'memory-normalize.js',
  'memory-soil-store.js',
  'memory-pocket-store.js',
  'memory-entry-store.js',
  'memory-custom-store.js',
  'memory-index.js',
  'global-excerpt-store.js',
];
const sources = {};
for (const name of expectedModules) {
  sources[name] = await readFile(resolve(root, 'functions/memory-store', name), 'utf8');
}
assert.match(sources['memory-schema.js'], /CREATE TABLE IF NOT EXISTS conversation_soils/);
assert.match(sources['memory-schema.js'], /coast-memory-library-v2/);
assert.match(sources['memory-soil-store.js'], /export async function readSoil/);
assert.match(sources['memory-soil-store.js'], /export async function writeSoil/);
assert.match(sources['memory-pocket-store.js'], /export async function createPocket/);
assert.match(sources['memory-pocket-store.js'], /export async function resolvePocket/);
assert.match(sources['memory-entry-store.js'], /export async function createEntry/);
assert.match(sources['memory-entry-store.js'], /export async function listEntries/);
assert.match(sources['memory-index.js'], /export async function listRecallCandidates/);
assert.match(sources['memory-index.js'], /export async function organizedMemoryRecordsInRange/);
assert.match(sources['global-excerpt-store.js'], /GLOBAL_EXCERPT_INITIAL_TEXT/);
assert.match(sources['global-excerpt-store.js'], /GLOBAL_EXCERPT_WRITE_GUIDANCE/);
assert.match(sources['global-excerpt-store.js'], /createGlobalExcerptCandidate/);
assert.match(sources['global-excerpt-store.js'], /confirmGlobalExcerptCandidate/);

const api = await import(`${pathToFileURL(entryPath).href}?split=${Date.now()}`);
for (const name of [
  'MEMORY_OWNER_ID', 'MEMORY_TAGS', 'MemoryStoreError', 'hasMemoryDatabase',
  'normalizeHandSeeds', 'normalizePocketCandidates', 'ensureMemorySchema',
  'readSoil', 'writeSoil', 'writeSoilCurrentText',
  'getPocket', 'createPocket', 'listPockets', 'patchPocket', 'deletePocket',
  'pocketFingerprint', 'upsertSoilPocketCandidates', 'resolvePocket',
  'getEntry', 'createEntry', 'listEntries', 'patchEntry', 'deleteEntry',
  'readCustomInstructions', 'writeCustomInstructions',
  'earliestOrganizedMemoryTimestamp', 'organizedMemoryRecordsInRange',
  'updateEmbeddingState', 'embeddingCounts', 'pendingEmbeddingEntries',
  'listRecallCandidates', 'entriesByIds', 'markEntriesRecalled',
  'GLOBAL_EXCERPT_INITIAL_TEXT', 'GLOBAL_EXCERPT_WRITE_GUIDANCE', 'readGlobalExcerpt', 'setGlobalExcerptWriteEnabled',
  'listGlobalExcerptCandidates', 'createGlobalExcerptCandidate', 'discardGlobalExcerptCandidate',
  'confirmGlobalExcerptCandidate', 'listGlobalExcerptRevisions',
]) assert.ok(name in api, `memory-store.js lost public export ${name}`);

console.log(`memory-store-split: ok (${lines} lines)`);
