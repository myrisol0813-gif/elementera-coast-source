import { MEMORY_CONFIG } from './memory-config.js';
import { safeLogError } from './http.js';
import { embeddingCounts, pendingEmbeddingEntries, updateEmbeddingState } from './memory-store.js';

const dimensionPromises = new WeakMap();

export function hasAiBinding(env) {
  return Boolean(env?.AI && typeof env.AI.run === 'function');
}

export function hasVectorBinding(env) {
  return Boolean(env?.COAST_MEMORY_VECTOR
    && typeof env.COAST_MEMORY_VECTOR.query === 'function'
    && typeof env.COAST_MEMORY_VECTOR.upsert === 'function');
}

function normalizedVector(result) {
  const candidates = [result?.data, result?.result?.data, result?.embeddings, result?.result?.embeddings];
  for (const candidate of candidates) {
    if (Array.isArray(candidate?.[0])) {
      const vector = candidate[0].map(Number);
      if (vector.length && vector.every(Number.isFinite)) return vector;
    }
    if (Array.isArray(candidate) && candidate.length && candidate.every((item) => Number.isFinite(Number(item)))) {
      return candidate.map(Number);
    }
  }
  throw new Error('embedding_shape_invalid');
}

export async function embedText(env, text) {
  if (!hasAiBinding(env)) throw new Error('ai_binding_missing');
  const result = await env.AI.run(MEMORY_CONFIG.vector.model, { text: [String(text || '').slice(0, 12000)] });
  return normalizedVector(result);
}

export async function detectEmbeddingDimensions(env) {
  if (!hasAiBinding(env)) return null;
  let ready = dimensionPromises.get(env.AI);
  if (!ready) {
    ready = embedText(env, '维度测试').then((vector) => vector.length);
    dimensionPromises.set(env.AI, ready);
  }
  try { return await ready; }
  catch (error) { dimensionPromises.delete(env.AI); throw error; }
}

export function embeddingText(entry) {
  const fields = entry.entry_type === 'seed'
    ? [entry.title, entry.life_core, entry.usage_hint, entry.avoid_hint]
    : [entry.title, entry.life_core, entry.content, entry.usage_hint, entry.avoid_hint];
  return fields.map((field) => String(field || '').trim()).filter(Boolean).join('\n').slice(0, 12000);
}

function metadata(entry) {
  return {
    user_id: MEMORY_CONFIG.owner,
    entry_id: entry.id,
    entry_type: entry.entry_type,
    status: entry.status,
    memory_level: entry.memory_level,
    tag: entry.tag || '',
    source_window: entry.source_window || '',
  };
}

export async function deleteEntryVector(env, entry) {
  if (!entry?.vector_id || !hasVectorBinding(env) || typeof env.COAST_MEMORY_VECTOR.deleteByIds !== 'function') {
    return { deleted: false, reason: 'vector_not_connected' };
  }
  try {
    await env.COAST_MEMORY_VECTOR.deleteByIds([entry.vector_id]);
    return { deleted: true };
  } catch (error) {
    safeLogError('memory-vector:delete', error);
    return { deleted: false, reason: 'vector_delete_failed' };
  }
}

export async function syncEntryVector(env, db, entry) {
  if (!entry?.user_confirmed || entry.deleted_at) return { entry, indexed: false, reason: 'not_confirmed' };
  if (!['active', 'dormant'].includes(entry.status)) {
    const removal = await deleteEntryVector(env, entry);
    const updated = await updateEmbeddingState(db, entry.id, {
      vector_id: removal.deleted ? null : entry.vector_id,
      embedding_status: removal.deleted ? 'pending' : entry.embedding_status,
      embedded_at: removal.deleted ? null : undefined,
    });
    return { entry: updated, indexed: false, reason: 'status_not_recallable' };
  }
  if (!hasAiBinding(env) || !hasVectorBinding(env)) return { entry, indexed: false, reason: 'vector_not_connected' };
  try {
    const values = await embedText(env, embeddingText(entry));
    const vectorId = entry.vector_id || entry.id;
    await env.COAST_MEMORY_VECTOR.upsert([{ id: vectorId, values, metadata: metadata(entry) }]);
    const updated = await updateEmbeddingState(db, entry.id, {
      vector_id: vectorId,
      embedding_model: MEMORY_CONFIG.vector.model,
      embedding_version: MEMORY_CONFIG.vector.version,
      embedding_status: 'ready',
      embedded_at: Date.now(),
    });
    return { entry: updated, indexed: true, dimensions: values.length };
  } catch (error) {
    safeLogError('memory-vector:upsert', error);
    const updated = await updateEmbeddingState(db, entry.id, {
      embedding_model: MEMORY_CONFIG.vector.model,
      embedding_version: MEMORY_CONFIG.vector.version,
      embedding_status: 'error',
    });
    return { entry: updated, indexed: false, reason: 'vector_upsert_failed' };
  }
}

export async function syncPendingEntries(env, db, limit = 4) {
  if (!hasAiBinding(env) || !hasVectorBinding(env)) return [];
  const entries = await pendingEmbeddingEntries(db, limit);
  const results = [];
  for (const entry of entries) results.push(await syncEntryVector(env, db, entry));
  return results;
}

export async function queryVector(env, query, { topK = 16, filter, values = null } = {}) {
  if (!hasAiBinding(env) || !hasVectorBinding(env)) return [];
  const vector = values || await embedText(env, query);
  const result = await env.COAST_MEMORY_VECTOR.query(vector, {
    topK: Math.min(40, Math.max(1, Number(topK) || 16)),
    returnMetadata: 'all',
    ...(filter ? { filter } : {}),
  });
  return (Array.isArray(result?.matches) ? result.matches : []).map((match) => ({
    id: String(match.metadata?.entry_id || match.id || ''),
    score: Number(match.score || 0),
    metadata: match.metadata || {},
  })).filter((match) => match.id);
}

export async function vectorStatus(env) {
  const aiBinding = hasAiBinding(env);
  const vectorBinding = hasVectorBinding(env);
  const counts = env?.COAST_CHAT_DB ? await embeddingCounts(env.COAST_CHAT_DB) : { pending: 0, ready: 0, error: 0 };
  let detectedDimensions = null;
  let probeError = null;
  if (aiBinding) {
    try { detectedDimensions = await detectEmbeddingDimensions(env); }
    catch (error) { probeError = String(error?.message || 'embedding_probe_failed').slice(0, 120); }
  }
  return {
    ai_binding: aiBinding,
    vector_binding: vectorBinding,
    embedding_model: MEMORY_CONFIG.vector.model,
    detected_dimensions: detectedDimensions,
    index_ready: vectorBinding,
    index_name: MEMORY_CONFIG.vector.index,
    binding_name: MEMORY_CONFIG.vector.binding,
    pending_count: counts.pending,
    error_count: counts.error,
    ready_count: counts.ready,
    ...(probeError ? { probe_error: probeError } : {}),
  };
}
