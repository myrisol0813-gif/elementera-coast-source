import { sanitizeId } from '../chat-store.js';
import { MEMORY_CONFIG } from '../memory-config.js';
import { all, first, run, summaryRange } from './memory-db.js';
import { MEMORY_OWNER_ID } from './memory-normalize.js';
import { ensureMemorySchema } from './memory-schema.js';
import { entryFromRow, getEntry, requireEntryRow } from './memory-entry-store.js';
import { pocketFromRow } from './memory-pocket-store.js';
import { soilFromRow } from './memory-soil-store.js';

function withConversationTitle(item, row) {
  return {
    ...item,
    conversation_title: row.conversation_title || null,
  };
}

export async function earliestOrganizedMemoryTimestamp(db) {
  await ensureMemorySchema(db);
  const row = await first(db, `SELECT MIN(recorded_at) AS recorded_at FROM (
    SELECT s.created_at AS recorded_at
    FROM conversation_soils s
    INNER JOIN conversations c ON c.id = s.conversation_id
    WHERE c.user_id = ? AND c.deleted_at IS NULL
      AND NOT (c.conversation_kind IN ('radio', 'lighthouse') AND s.surface = 'web_manual')
      AND (
        s.current_text <> ''
        OR s.hand_seeds_json <> '[]'
        OR s.do_not_repeat <> ''
        OR s.pocket_candidates_json <> '[]'
      )
    UNION ALL
    SELECT p.created_at AS recorded_at
    FROM memory_pockets p
    INNER JOIN conversations c ON c.id = p.conversation_id
    WHERE p.user_id = ? AND p.deleted_at IS NULL
      AND p.status IN ('pending', 'confirmed', 'stone', 'archived')
      AND c.user_id = ? AND c.deleted_at IS NULL
    UNION ALL
    SELECT e.created_at AS recorded_at
    FROM memory_entries e
    LEFT JOIN conversations c ON c.id = e.conversation_id
    WHERE e.user_id = ? AND e.deleted_at IS NULL
      AND e.status IN ('active', 'dormant', 'archived', 'stone')
      AND (
        (e.scope = 'global' AND e.conversation_id IS NULL)
        OR (e.scope = 'conversation' AND c.user_id = ? AND c.deleted_at IS NULL)
      )
  )`, [
    MEMORY_OWNER_ID,
    MEMORY_OWNER_ID,
    MEMORY_OWNER_ID,
    MEMORY_OWNER_ID,
    MEMORY_OWNER_ID,
  ]);
  const value = Number(row?.recorded_at);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function organizedMemoryRecordsInRange(db, value = {}) {
  await ensureMemorySchema(db);
  const range = summaryRange(value);
  const timeParams = [range.from, range.to, range.from, range.to];
  const [soilRows, pocketRows, entryRows] = await Promise.all([
    all(db, `SELECT s.*, c.title AS conversation_title
      FROM conversation_soils s
      INNER JOIN conversations c ON c.id = s.conversation_id
      WHERE c.user_id = ? AND c.deleted_at IS NULL
        AND NOT (c.conversation_kind IN ('radio', 'lighthouse') AND s.surface = 'web_manual')
        AND (
          s.current_text <> ''
          OR s.hand_seeds_json <> '[]'
          OR s.do_not_repeat <> ''
          OR s.pocket_candidates_json <> '[]'
        )
        AND (
          s.created_at BETWEEN ? AND ?
          OR s.updated_at BETWEEN ? AND ?
        )
      ORDER BY s.updated_at ASC, s.created_at ASC`, [MEMORY_OWNER_ID, ...timeParams]),
    all(db, `SELECT p.*, c.title AS conversation_title
      FROM memory_pockets p
      INNER JOIN conversations c ON c.id = p.conversation_id
      WHERE p.user_id = ? AND p.deleted_at IS NULL
        AND p.status IN ('pending', 'confirmed', 'stone', 'archived')
        AND c.user_id = ? AND c.deleted_at IS NULL
        AND (
          p.created_at BETWEEN ? AND ?
          OR p.updated_at BETWEEN ? AND ?
        )
      ORDER BY p.updated_at ASC, p.created_at ASC`, [
      MEMORY_OWNER_ID,
      MEMORY_OWNER_ID,
      ...timeParams,
    ]),
    all(db, `SELECT e.*, c.title AS conversation_title
      FROM memory_entries e
      LEFT JOIN conversations c ON c.id = e.conversation_id
      WHERE e.user_id = ? AND e.deleted_at IS NULL
        AND e.status IN ('active', 'dormant', 'archived', 'stone')
        AND (
          (e.scope = 'global' AND e.conversation_id IS NULL)
          OR (e.scope = 'conversation' AND c.user_id = ? AND c.deleted_at IS NULL)
        )
        AND (
          e.created_at BETWEEN ? AND ?
          OR e.updated_at BETWEEN ? AND ?
        )
      ORDER BY e.updated_at ASC, e.created_at ASC`, [
      MEMORY_OWNER_ID,
      MEMORY_OWNER_ID,
      ...timeParams,
    ]),
  ]);
  return {
    soils: soilRows.map((row) => withConversationTitle(soilFromRow(row), row)),
    pockets: pocketRows.map((row) => withConversationTitle(pocketFromRow(row), row)),
    entries: entryRows.map((row) => withConversationTitle(entryFromRow(row), row)),
  };
}

export async function updateEmbeddingState(db, id, value = {}) {
  await ensureMemorySchema(db);
  const row = await requireEntryRow(db, id);
  const status = ['pending', 'ready', 'error'].includes(value.embedding_status)
    ? value.embedding_status
    : row.embedding_status;
  const timestamp = Date.now();
  await run(db, `UPDATE memory_entries SET
    vector_id = ?, embedding_model = ?, embedding_version = ?, embedding_status = ?,
    embedded_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [
    value.vector_id === undefined ? row.vector_id : value.vector_id,
    value.embedding_model === undefined ? row.embedding_model : value.embedding_model,
    value.embedding_version === undefined ? row.embedding_version : value.embedding_version,
    status,
    value.embedded_at === undefined ? row.embedded_at : value.embedded_at,
    timestamp,
    row.id,
    MEMORY_OWNER_ID,
  ]);
  return getEntry(db, row.id);
}

export async function embeddingCounts(db) {
  await ensureMemorySchema(db);
  const rows = await all(db, `SELECT embedding_status, COUNT(*) AS count
    FROM memory_entries
    WHERE user_id = ? AND deleted_at IS NULL AND user_confirmed = 1
      AND status IN ('active', 'dormant')
    GROUP BY embedding_status`, [MEMORY_OWNER_ID]);
  const counts = { pending: 0, ready: 0, error: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(counts, row.embedding_status)) counts[row.embedding_status] = Number(row.count || 0);
  }
  return counts;
}

export async function pendingEmbeddingEntries(db, limit = 4) {
  await ensureMemorySchema(db);
  const rows = await all(db, `SELECT * FROM memory_entries
    WHERE user_id = ? AND user_confirmed = 1 AND deleted_at IS NULL
      AND status IN ('active', 'dormant')
      AND (embedding_status = 'pending' OR (embedding_status = 'error' AND updated_at < ?))
    ORDER BY updated_at ASC
    LIMIT ?`, [MEMORY_OWNER_ID, Date.now() - MEMORY_CONFIG.vector.retryAfterMs, Math.min(20, Math.max(1, Number(limit) || 4))]);
  return rows.map(entryFromRow);
}

export async function listRecallCandidates(db, { limit = 500 } = {}) {
  await ensureMemorySchema(db);
  const rows = await all(db, `SELECT * FROM memory_entries
    WHERE user_id = ? AND deleted_at IS NULL AND user_confirmed = 1
      AND status IN ('active', 'dormant')
      AND entry_type IN ('memory', 'seed')
    ORDER BY updated_at DESC
    LIMIT ?`, [MEMORY_OWNER_ID, Math.min(500, Math.max(1, Number(limit) || 500))]);
  return rows.map(entryFromRow);
}

export async function entriesByIds(db, ids = []) {
  await ensureMemorySchema(db);
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map((id) => sanitizeId(id, 'memory')).filter(Boolean))].slice(0, 100);
  if (!clean.length) return [];
  const placeholders = clean.map(() => '?').join(',');
  const rows = await all(db, `SELECT * FROM memory_entries
    WHERE user_id = ? AND id IN (${placeholders}) AND user_confirmed = 1
      AND status IN ('active', 'dormant') AND deleted_at IS NULL`, [MEMORY_OWNER_ID, ...clean]);
  const order = new Map(clean.map((id, index) => [id, index]));
  return rows.map(entryFromRow).sort((left, right) => order.get(left.id) - order.get(right.id));
}

export async function markEntriesRecalled(db, ids = []) {
  await ensureMemorySchema(db);
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map((id) => sanitizeId(id, 'memory')).filter(Boolean))].slice(0, 20);
  if (!clean.length) return;
  const timestamp = Date.now();
  await db.batch(clean.flatMap((id) => [
    db.prepare(`UPDATE memory_entries
      SET recall_count = recall_count + 1, last_recalled_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).bind(timestamp, id, MEMORY_OWNER_ID),
    db.prepare(`UPDATE memory_pockets
      SET recall_count = recall_count + 1, last_recalled_at = ?
      WHERE id = ? AND user_id = ? AND status = 'confirmed' AND deleted_at IS NULL`).bind(timestamp, id, MEMORY_OWNER_ID),
  ]));
}
