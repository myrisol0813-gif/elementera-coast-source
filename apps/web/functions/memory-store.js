export { MemoryStoreError, hasMemoryDatabase } from './memory-store/memory-db.js';
export {
  MEMORY_OWNER_ID,
  MEMORY_TAGS,
  normalizeHandSeeds,
  normalizePocketCandidates,
} from './memory-store/memory-normalize.js';
export { ensureMemorySchema } from './memory-store/memory-schema.js';
export {
  readSoil,
  writeSoil,
  writeSoilCurrentText,
} from './memory-store/memory-soil-store.js';
export {
  getPocket,
  createPocket,
  listPockets,
  patchPocket,
  deletePocket,
  pocketFingerprint,
  upsertSoilPocketCandidates,
  resolvePocket,
} from './memory-store/memory-pocket-store.js';
export {
  getEntry,
  createEntry,
  listEntries,
  patchEntry,
  deleteEntry,
} from './memory-store/memory-entry-store.js';
export {
  readCustomInstructions,
  writeCustomInstructions,
} from './memory-store/memory-custom-store.js';
export {
  earliestOrganizedMemoryTimestamp,
  organizedMemoryRecordsInRange,
  updateEmbeddingState,
  embeddingCounts,
  pendingEmbeddingEntries,
  listRecallCandidates,
  entriesByIds,
  markEntriesRecalled,
} from './memory-store/memory-index.js';

export {
  GLOBAL_EXCERPT_ID,
  GLOBAL_EXCERPT_INITIAL_TEXT,
  GLOBAL_EXCERPT_WRITE_GUIDANCE,
  readGlobalExcerpt,
  setGlobalExcerptWriteEnabled,
  listGlobalExcerptCandidates,
  createGlobalExcerptCandidate,
  discardGlobalExcerptCandidate,
  confirmGlobalExcerptCandidate,
  listGlobalExcerptRevisions,
} from './memory-store/global-excerpt-store.js';
