import { ensureMailboxSchema } from '../mailbox-schema.js';
import { MailboxRepositoryError, first, now } from './mailbox-db.js';
import { visitorFromRow } from './mailbox-mappers.js';

export async function createMailboxVisitor(db, value) {
  await ensureMailboxSchema(db);
  const id = `mailbox-visitor-${crypto.randomUUID()}`;
  const timestamp = now();
  await db.batch([
    db.prepare(`INSERT INTO mailbox_visitors (
      id, display_name, preferred_name, passphrase_hash, passphrase_lookup,
      created_at, updated_at, last_seen_at, is_active, allow_memory, privacy_level, note_for_owner
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'sealed', NULL)`).bind(
      id,
      value.display_name,
      value.preferred_name || null,
      value.passphrase_hash,
      value.passphrase_lookup,
      timestamp,
      timestamp,
      timestamp,
      value.allow_memory ? 1 : 0,
    ),
    db.prepare(`INSERT INTO mailbox_thought_soils (
      visitor_id, current_text, hand_seeds_json, do_not_repeat,
      pocket_candidates_json, source_message_id, organized_through_message_id,
      manual_locked, auto_refresh_enabled, revision, model_label, model_nickname,
      source_conversation_id, source_turn_id, tool_call_id, created_at, updated_at
    ) VALUES (?, '', '[]', '', '[]', NULL, NULL, 0, 1, 1,
      NULL, NULL, NULL, NULL, NULL, ?, ?)`).bind(id, timestamp, timestamp),
  ]);
  return visitorFromRow(await first(db, 'SELECT * FROM mailbox_visitors WHERE id = ?', [id]));
}

export async function findMailboxVisitorByLookup(db, lookup) {
  await ensureMailboxSchema(db);
  const row = await first(db, 'SELECT * FROM mailbox_visitors WHERE passphrase_lookup = ?', [lookup]);
  if (!row) return null;
  return {
    visitor: visitorFromRow(row),
    passphrase_hash: row.passphrase_hash,
  };
}

export async function getMailboxVisitor(db, visitorId) {
  await ensureMailboxSchema(db);
  return visitorFromRow(await first(db, 'SELECT * FROM mailbox_visitors WHERE id = ?', [visitorId]));
}

export async function touchMailboxVisitor(db, visitorId) {
  await ensureMailboxSchema(db);
  const timestamp = now();
  await db.prepare(`UPDATE mailbox_visitors
    SET last_seen_at = ?, updated_at = ?
    WHERE id = ? AND is_active = 1`).bind(timestamp, timestamp, visitorId).run();
  return getMailboxVisitor(db, visitorId);
}

export async function deleteMailboxVisitorAccount(db, visitorId) {
  await ensureMailboxSchema(db);
  const visitor = await getMailboxVisitor(db, visitorId);
  if (!visitor?.is_active) {
    throw new MailboxRepositoryError('mailbox_visitor_not_found', '这个访客房间已经不存在。', 404);
  }
  await db.batch([
    db.prepare('DELETE FROM mailbox_thinking_notes WHERE visitor_id = ?').bind(visitorId),
    db.prepare('DELETE FROM mailbox_thought_soils WHERE visitor_id = ?').bind(visitorId),
    db.prepare('DELETE FROM visitor_notebook_entries WHERE visitor_id = ?').bind(visitorId),
    db.prepare('DELETE FROM mailbox_memory_pockets WHERE visitor_id = ?').bind(visitorId),
    db.prepare('DELETE FROM mailbox_reply_queue WHERE visitor_id = ?').bind(visitorId),
    db.prepare('DELETE FROM mailbox_messages WHERE visitor_id = ?').bind(visitorId),
    db.prepare('DELETE FROM mailbox_visitors WHERE id = ?').bind(visitorId),
  ]);
  return { visitor_id: visitorId, deleted: true };
}
