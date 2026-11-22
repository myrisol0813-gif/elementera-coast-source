import { ensureTreasureSchema } from './coast-vault-treasures.js';

export const LEGACY_HEART_BATCH = 12;

// Explicit, resumable and idempotent. This routine never clears historical
// favorite booleans or overwrites notes in newer treasure records.
export async function inspectLegacyHearts(db, { cursor = 0, apply = false } = {}) {
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    throw new Error('legacy_cursor_invalid');
  }
  await ensureTreasureSchema(db);
  const read = await db.prepare(
    "SELECT c.id AS conversation_id, s.state_json FROM conversations c " +
    "JOIN conversation_states s ON s.conversation_id = c.id " +
    "WHERE c.user_id = 'owner' AND c.deleted_at IS NULL AND c.conversation_kind = 'chat' " +
    "AND s.state_json LIKE '%\"favorite\":true%' " +
    "ORDER BY c.created_at ASC, c.id ASC LIMIT ? OFFSET ?"
  ).bind(LEGACY_HEART_BATCH + 1, offset).all();
  const rows = (read?.results || []).slice(0, LEGACY_HEART_BATCH);
  let recognized = 0, inserted = 0;
  for (const row of rows) {
    let state;
    try { state = JSON.parse(row.state_json); } catch { continue; }
    for (const turn of state.turns || []) {
      for (const variants of Object.values(turn?.assistant?.variantsByUserVariant || {})) {
        for (const item of variants || []) {
          if (item?.favorite !== true || !item.id || typeof item.content !== 'string') continue;
          recognized += 1;
          if (!apply) continue;
          const timestamp = Date.parse(item.created_at || '') || Date.now();
          const response = await db.prepare(
            'INSERT OR IGNORE INTO coast_vault_treasures ' +
            '(id,source_key,kind,conversation_id,turn_id,message_id,source_id,role,excerpt,selections_json,notes,created_at,updated_at) ' +
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
          ).bind('treasure_' + crypto.randomUUID(), 'text:' + row.conversation_id + ':' + item.id, 'text',
            row.conversation_id, turn.id, item.id, item.id, 'assistant',
            item.content.slice(0, 12000), '[]', '', timestamp, timestamp).run();
          inserted += Number(response?.meta?.changes) || 0;
        }
      }
    }
  }
  return {
    dry_run: !apply, recognized, inserted,
    next_cursor: (read?.results || []).length > LEGACY_HEART_BATCH
      ? String(offset + LEGACY_HEART_BATCH) : null,
    note: '迁移只补充旧红心到拾潮，不清除旧标记，不覆盖已有收藏和备注。',
  };
}
