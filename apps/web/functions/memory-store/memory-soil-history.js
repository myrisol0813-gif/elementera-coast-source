import { getConversation, sanitizeId } from '../chat-store.js';
import { clip, iso, parseJson } from './memory-db.js';
import { ensureMemorySchema } from './memory-schema.js';

// A historical record is presentation-only. It must never be imported by
// context assembly, memory recall, embeddings or model-facing search tools.
export function soilSnapshotStatement(db, conversationId, branch, soil) {
  const turnId = clip(branch?.turn_id || '', 180);
  const messageId = clip(branch?.assistant?.id || '', 180);
  if (!turnId || !messageId || !soil) return null;
  const currentText = String(soil.current_text || '');
  const afterthoughts = Array.isArray(soil.afterthoughts) ? soil.afterthoughts : [];
  return db.prepare(`INSERT OR IGNORE INTO conversation_soil_snapshots (
    conversation_id, turn_id, assistant_message_id, current_text,
    afterthoughts_json, revision, model_label, display_author, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(conversationId, turnId, messageId, currentText, JSON.stringify(afterthoughts),
      Math.max(1, Number(soil.revision) || 1),
      clip(soil.model_label || branch.assistant?.model_id || '', 180),
      clip(soil.display_author || '思维壤', 100), Date.now());
}

export async function saveSoilSnapshot(db, conversationId, branch, soil) {
  await ensureMemorySchema(db);
  const id = sanitizeId(conversationId, 'conversation');
  const statement = soilSnapshotStatement(db, id, branch, soil);
  if (!statement) return false;
  await statement.run();
  return true;
}

export async function listSoilSnapshots(db, conversationId, { limit = 1000, offset = 0 } = {}) {
  await ensureMemorySchema(db);
  const id = sanitizeId(conversationId, 'conversation');
  await getConversation(db, id);
  const pageSize = Math.min(1000, Math.max(1, Math.trunc(Number(limit) || 1000)));
  const pageOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  const result = await db.prepare(`SELECT turn_id, assistant_message_id, current_text,
    afterthoughts_json, revision, model_label, display_author, created_at
    FROM conversation_soil_snapshots
    WHERE conversation_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).bind(id, pageSize + 1, pageOffset).all();
  const rows = result.results || [];
  return {
    snapshots: rows.slice(0, pageSize).map(row => ({
      turn_id: row.turn_id,
      assistant_message_id: row.assistant_message_id,
      current_text: row.current_text || '',
      afterthoughts: parseJson(row.afterthoughts_json, []),
      revision: Number(row.revision || 1),
      model_label: row.model_label || '',
      display_author: row.display_author || '',
      created_at: iso(row.created_at),
    })),
    truncated: rows.length > pageSize,
    next_offset: rows.length > pageSize ? pageOffset + pageSize : null,
  };
}

// Exports must never silently discard older layers. The chat UI can fetch a
// bounded page, but a user-requested snapshot walks the entire archive.
export async function allSoilSnapshots(db, conversationId) {
  const snapshots = [];
  let offset = 0;
  while (true) {
    const page = await listSoilSnapshots(db, conversationId, { limit: 1000, offset });
    snapshots.push(...page.snapshots);
    if (page.next_offset == null) return snapshots;
    offset = page.next_offset;
  }
}
