import { ensureTreasureSchema, TREASURE_LIMITS } from './coast-vault-treasures.js';

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
  let recognized = 0, inserted = 0, oversized = 0;
  for (const row of rows) {
    let state;
    try { state = JSON.parse(row.state_json); } catch { continue; }
    for (const turn of state.turns || []) {
      for (const variants of Object.values(turn?.assistant?.variantsByUserVariant || {})) {
        for (const item of variants || []) {
          if (item?.favorite !== true || !item.id || typeof item.content !== 'string') continue;
          recognized += 1;
          // Never silently slice away an owner's long historic heart.
          // Keep its original state untouched and report it for manual selection.
          if (item.content.length > TREASURE_LIMITS.excerpt_chars) {
            oversized += 1;
            continue;
          }
          if (!apply) continue;
          const timestamp = Date.parse(item.created_at || '') || Date.now();
          const response = await db.prepare(
            'INSERT OR IGNORE INTO coast_vault_treasures ' +
            '(id,source_key,kind,conversation_id,turn_id,message_id,source_id,role,excerpt,selections_json,notes,created_at,updated_at) ' +
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
          ).bind('treasure_' + crypto.randomUUID(), 'text:' + row.conversation_id + ':' + item.id, 'text',
            row.conversation_id, turn.id, item.id, item.id, 'assistant',
            item.content, '[]', '', timestamp, timestamp).run();
          inserted += Number(response?.meta?.changes) || 0;
        }
      }
    }
  }
  return {
    dry_run: !apply, recognized, inserted, oversized,
    next_cursor: (read?.results || []).length > LEGACY_HEART_BATCH
      ? String(offset + LEGACY_HEART_BATCH) : null,
    note: '只补充完整可保存的旧红心；超长原文保留在旧窗口中并计入 oversized，不静默截断。不会清除旧红心或覆盖备注。',
  };
}
