export const RECALL_THRESHOLDS = Object.freeze({
  autoMemory: 0.74,
  autoSeed: 0.82,
  explicit: 0.55,
  exactTitle: 0.92,
});

export const RECALL_LIMITS = Object.freeze({
  auto: Object.freeze({ total: 4, memory: 3, seed: 1 }),
  explicit: Object.freeze({ total: 8, memory: 6, seed: 2 }),
});

export const MEMORY_CONFIG = Object.freeze({
  owner: 'owner',
  soil: Object.freeze({
    enabled: true,
    autoRefreshEveryTurns: 1,
    maxHandSeeds: 7,
    contextBudget: 1200,
  }),
  recall: Object.freeze({
    thresholds: RECALL_THRESHOLDS,
    limits: RECALL_LIMITS,
    tagBonus: 0.03,
    sourceWindowBonus: 0.02,
    recencyBonus: 0.03,
    seedPenalty: 0.03,
    dormantPenalty: 0.04,
  }),
  vector: Object.freeze({
    model: '@cf/baai/bge-m3',
    version: 'workers-ai-bge-m3-v1',
    metric: 'cosine',
    index: 'elementera-coast-memory-v1',
    binding: 'COAST_MEMORY_VECTOR',
    retryAfterMs: 15 * 60 * 1000,
  }),
});

function integer(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback;
}

export function recallSettings(value = {}) {
  return {
    thresholds: RECALL_THRESHOLDS,
    limits: RECALL_LIMITS,
    tagBonus: MEMORY_CONFIG.recall.tagBonus,
    sourceWindowBonus: MEMORY_CONFIG.recall.sourceWindowBonus,
    recencyBonus: MEMORY_CONFIG.recall.recencyBonus,
    seedPenalty: MEMORY_CONFIG.recall.seedPenalty,
    dormantPenalty: MEMORY_CONFIG.recall.dormantPenalty,
    soilBudget: integer(value.soilBudget, MEMORY_CONFIG.soil.contextBudget, 200, 2400),
  };
}

export function soilSettings(value = {}) {
  const defaults = MEMORY_CONFIG.soil;
  return {
    autoRefreshEveryTurns: integer(value.autoRefreshEveryTurns, defaults.autoRefreshEveryTurns, 1, 12),
    maxHandSeeds: integer(value.maxHandSeeds, defaults.maxHandSeeds, 1, 7),
    soilBudget: integer(value.soilBudget, defaults.contextBudget, 200, 2400),
  };
}
