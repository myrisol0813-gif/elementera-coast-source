import { ensureTreasureSchema, listTreasures, TreasureError } from './coast-vault-treasures.js';

export const VAULT_MODEL_LIMITS = Object.freeze({
  search_results: 8,
  search_excerpt_chars: 180,
  read_items: 3,
  read_excerpt_chars: 4200,
  note_chars: 1200,
});

function cleanId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 160 || !/^[a-zA-Z0-9_:.-]+$/.test(id)) {
    throw new TreasureError('invalid_treasure_id', '请使用检索返回的真实拾潮 ID。');
  }
  return id;
}

function clip(value, max) {
  return String(value || '').slice(0, max);
}

/**
 * Explicit opt-in tool call only. This is never called by the automatic
 * memory recall pipeline or initial model context construction.
 * Search returns short index records, not the saved full text.
 */
export async function searchVaultForModel(db, { query = '', limit = 5, kind = 'all', cursor = 0 } = {}) {
  const needle = String(query || '').trim();
  if (!needle || needle.length > 100) {
    throw new TreasureError('invalid_query', '请先提供 1–100 字的拾潮搜索关键词。');
  }
  const requested = Number(limit);
  const count = Number.isInteger(requested)
    ? Math.min(VAULT_MODEL_LIMITS.search_results, Math.max(1, requested)) : 5;
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    throw new TreasureError('invalid_cursor', '拾潮检索游标无效。');
  }
  const page = await listTreasures(db, { q: needle, kind, cursor: offset });
  const returned = Math.min(page.items.length, count);
  const more = page.items.length > returned || Boolean(page.next_cursor);
  return {
    query: needle,
    count: returned,
    has_more: more,
    next_cursor: more ? String(offset + returned) : null,
    results: page.items.slice(0, count).map((item) => ({
      id: item.id,
      kind: item.kind,
      conversation_id: item.conversation_id,
      turn_id: item.turn_id,
      message_id: item.message_id,
      role: item.role,
      preview: clip(item.excerpt, VAULT_MODEL_LIMITS.search_excerpt_chars),
      notes_preview: clip(item.notes, 140),
      updated_at: item.updated_at,
    })),
    next_step: '先从本页 ID 选必要收藏精读；若仍需寻找且 next_cursor 不为空，使用同一关键词与该 cursor 再查下一页。',
  };
}

/** Read at most three explicitly selected owner-owned treasures, never the
 * entire archive. Missing or removed IDs return a visible unavailable result.
 */
export async function readVaultForModel(db, { ids = [] } = {}) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > VAULT_MODEL_LIMITS.read_items) {
    throw new TreasureError('invalid_ids', '每次只能指定 1–3 个拾潮收藏 ID。');
  }
  const requested = ids.map(cleanId);
  if (new Set(requested).size !== requested.length) {
    throw new TreasureError('duplicate_ids', '请勿重复读取相同的收藏 ID。');
  }
  await ensureTreasureSchema(db);
  const items = [];
  for (const id of requested) {
    const row = await db.prepare(
      "SELECT t.* FROM coast_vault_treasures t JOIN conversations c " +
      "ON c.id = t.conversation_id WHERE t.id = ? AND c.user_id = 'owner' " +
      "AND c.deleted_at IS NULL AND c.conversation_kind = 'chat'"
    ).bind(id).first();
    if (!row) {
      items.push({ id, available: false, reason: 'removed_or_unavailable' });
      continue;
    }
    const excerpt = String(row.excerpt || '');
    const notes = String(row.notes || '');
    items.push({
      id, available: true,
      kind: row.kind,
      conversation_id: row.conversation_id,
      turn_id: row.turn_id,
      message_id: row.message_id,
      role: row.role,
      content: clip(excerpt, VAULT_MODEL_LIMITS.read_excerpt_chars),
      content_truncated: excerpt.length > VAULT_MODEL_LIMITS.read_excerpt_chars,
      notes: clip(notes, VAULT_MODEL_LIMITS.note_chars),
      updated_at: row.updated_at,
    });
  }
  return { items, count: items.filter((item) => item.available).length, requested_count: requested.length };
}
