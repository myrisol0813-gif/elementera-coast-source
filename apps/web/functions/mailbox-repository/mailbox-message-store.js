import { ensureMailboxSchema } from '../mailbox-schema.js';
import {
  MailboxRepositoryError,
  PATROL_MESSAGE_LIMIT,
  all,
  boundedLimit,
  first,
  now,
} from './mailbox-db.js';
import { messageFromRow } from './mailbox-mappers.js';

export async function listMailboxMessages(db, visitorId, limit = 500) {
  await ensureMailboxSchema(db);
  const rows = await all(db, `SELECT * FROM mailbox_messages
    WHERE visitor_id = ? AND status != 'hidden'
    ORDER BY created_at ASC, id ASC LIMIT ?`, [visitorId, limit]);
  return rows.map(messageFromRow);
}

export async function writeVisitorMailboxMessage(db, visitorId, content) {
  await ensureMailboxSchema(db);
  const messageId = `mailbox-message-${crypto.randomUUID()}`;
  const queueId = `mailbox-queue-${visitorId}`;
  const timestamp = now();
  await db.batch([
    db.prepare(`INSERT INTO mailbox_messages (
      id, visitor_id, role, content, created_at, updated_at, status,
      reply_batch_id, is_visible_to_owner, safety_flag
    ) VALUES (?, ?, 'visitor', ?, ?, ?, 'waiting_for_model_partner', NULL, 0, NULL)`).bind(
      messageId,
      visitorId,
      content,
      timestamp,
      timestamp,
    ),
    db.prepare(`INSERT INTO mailbox_reply_queue (
      id, visitor_id, latest_message_id, status, created_at, updated_at,
      processed_at, processed_by, error_note, needs_owner_attention,
      owner_attention_reason, processing_batch_id
    ) VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, 0, NULL, NULL)
    ON CONFLICT(visitor_id) DO UPDATE SET
      latest_message_id = excluded.latest_message_id,
      status = 'pending',
      updated_at = excluded.updated_at,
      processed_at = NULL,
      processed_by = NULL,
      error_note = NULL,
      processing_batch_id = NULL`).bind(
      queueId,
      visitorId,
      messageId,
      timestamp,
      timestamp,
    ),
    db.prepare(`UPDATE mailbox_visitors
      SET last_seen_at = ?, updated_at = ?
      WHERE id = ? AND is_active = 1`).bind(timestamp, timestamp, visitorId),
  ]);
  return messageFromRow(await first(db, 'SELECT * FROM mailbox_messages WHERE id = ?', [messageId]));
}

async function mailboxMessageForVisitor(db, visitorId, messageId) {
  return first(db, `SELECT * FROM mailbox_messages
    WHERE id = ? AND visitor_id = ? AND status != 'hidden'`, [messageId, visitorId]);
}

async function soleReplyForVisitorMessage(db, message) {
  if (message?.role !== 'visitor' || !message.reply_batch_id) return null;
  const sibling = await first(db, `SELECT id FROM mailbox_messages
    WHERE visitor_id = ? AND role = 'visitor' AND reply_batch_id = ?
      AND id != ? AND status != 'hidden' LIMIT 1`, [
    message.visitor_id,
    message.reply_batch_id,
    message.id,
  ]);
  if (sibling) return null;
  return first(db, `SELECT * FROM mailbox_messages
    WHERE visitor_id = ? AND role = 'model_partner' AND reply_batch_id = ?
      AND status != 'hidden' LIMIT 1`, [message.visitor_id, message.reply_batch_id]);
}

function detachMessageStatements(db, visitorId, messageId) {
  return [
    db.prepare(`UPDATE mailbox_thought_soils SET
      source_message_id = CASE WHEN source_message_id = ? THEN NULL ELSE source_message_id END,
      organized_through_message_id = CASE
        WHEN organized_through_message_id = ? THEN NULL ELSE organized_through_message_id END
      WHERE visitor_id = ?`).bind(messageId, messageId, visitorId),
    db.prepare(`UPDATE mailbox_memory_pockets SET source_message_id = NULL
      WHERE visitor_id = ? AND source_message_id = ?`).bind(visitorId, messageId),
    db.prepare(`UPDATE visitor_notebook_entries SET source_message_id = NULL
      WHERE visitor_id = ? AND source_message_id = ?`).bind(visitorId, messageId),
  ];
}

function upsertPendingQueueStatement(db, visitorId, timestamp, excludeMessageId = '') {
  const queueId = `mailbox-queue-${visitorId}`;
  return db.prepare(`INSERT INTO mailbox_reply_queue (
      id, visitor_id, latest_message_id, status, created_at, updated_at,
      processed_at, processed_by, error_note, needs_owner_attention,
      owner_attention_reason, processing_batch_id
    ) SELECT ?, ?, m.id, 'pending', ?, ?, NULL, NULL, NULL, 0, NULL, NULL
      FROM mailbox_messages m
      WHERE m.visitor_id = ? AND m.role = 'visitor'
        AND m.status = 'waiting_for_model_partner' AND m.id != ?
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    ON CONFLICT(visitor_id) DO UPDATE SET
      latest_message_id = excluded.latest_message_id,
      status = 'pending',
      updated_at = excluded.updated_at,
      processed_at = NULL,
      processed_by = NULL,
      error_note = NULL,
      needs_owner_attention = 0,
      owner_attention_reason = NULL,
      processing_batch_id = NULL`).bind(
    queueId,
    visitorId,
    timestamp,
    timestamp,
    visitorId,
    excludeMessageId,
  );
}

export async function editVisitorMailboxMessage(db, visitorId, messageId, content) {
  await ensureMailboxSchema(db);
  const message = await mailboxMessageForVisitor(db, visitorId, messageId);
  if (!message || message.role !== 'visitor') {
    throw new MailboxRepositoryError('mailbox_message_not_editable', '这封来信不存在，或不能由访客编辑。', 404);
  }
  const relatedReply = await soleReplyForVisitorMessage(db, message);
  const timestamp = now();
  const statements = [];
  if (relatedReply) {
    statements.push(
      ...detachMessageStatements(db, visitorId, relatedReply.id),
      db.prepare(`DELETE FROM mailbox_messages
        WHERE id = ? AND visitor_id = ? AND role = 'model_partner'`).bind(relatedReply.id, visitorId),
    );
  }
  statements.push(
    db.prepare(`UPDATE mailbox_messages SET
      content = ?, updated_at = ?, status = 'waiting_for_model_partner', reply_batch_id = NULL
      WHERE id = ? AND visitor_id = ? AND role = 'visitor'`).bind(
      content,
      timestamp,
      messageId,
      visitorId,
    ),
    upsertPendingQueueStatement(db, visitorId, timestamp),
    db.prepare(`UPDATE mailbox_visitors SET updated_at = ?, last_seen_at = ?
      WHERE id = ? AND is_active = 1`).bind(timestamp, timestamp, visitorId),
  );
  await db.batch(statements);
  return messageFromRow(await mailboxMessageForVisitor(db, visitorId, messageId));
}

export async function deleteMailboxMessage(db, visitorId, messageId) {
  await ensureMailboxSchema(db);
  const message = await mailboxMessageForVisitor(db, visitorId, messageId);
  if (!message || !['visitor', 'model_partner'].includes(message.role)) {
    throw new MailboxRepositoryError('mailbox_message_not_found', '这条信箱消息不存在。', 404);
  }
  const relatedReply = await soleReplyForVisitorMessage(db, message);
  const timestamp = now();
  const statements = [];
  if (message.role === 'visitor') {
    statements.push(
      upsertPendingQueueStatement(db, visitorId, timestamp, message.id),
      db.prepare(`DELETE FROM mailbox_reply_queue
        WHERE visitor_id = ?
          AND NOT EXISTS (SELECT 1 FROM mailbox_messages m
            WHERE m.visitor_id = ? AND m.role = 'visitor'
              AND m.status = 'waiting_for_model_partner' AND m.id != ?)`).bind(
        visitorId,
        visitorId,
        message.id,
      ),
    );
  }
  statements.push(...detachMessageStatements(db, visitorId, message.id));
  if (relatedReply) {
    statements.push(
      ...detachMessageStatements(db, visitorId, relatedReply.id),
      db.prepare(`DELETE FROM mailbox_messages
        WHERE id = ? AND visitor_id = ? AND role = 'model_partner'`).bind(relatedReply.id, visitorId),
    );
  }
  statements.push(
    db.prepare(`DELETE FROM mailbox_messages
      WHERE id = ? AND visitor_id = ? AND role IN ('visitor', 'model_partner')`).bind(message.id, visitorId),
    db.prepare(`UPDATE mailbox_visitors SET updated_at = ?, last_seen_at = ?
      WHERE id = ? AND is_active = 1`).bind(timestamp, timestamp, visitorId),
  );
  await db.batch(statements);
  return {
    id: message.id,
    deleted: true,
    related_reply_id: relatedReply?.id || null,
  };
}

export async function mailboxStatusForVisitor(db, visitorId) {
  await ensureMailboxSchema(db);
  const row = await first(db, `SELECT
      (SELECT COUNT(*) FROM mailbox_messages
        WHERE visitor_id = ? AND role = 'visitor' AND status = 'waiting_for_model_partner') AS pending_count,
      (SELECT MAX(created_at) FROM mailbox_messages
        WHERE visitor_id = ? AND role = 'model_partner' AND status != 'hidden') AS last_model_partner_reply_at,
      (SELECT MAX(created_at) FROM mailbox_messages
        WHERE visitor_id = ? AND role = 'visitor' AND status != 'hidden') AS last_visitor_message_at,
      (SELECT status FROM mailbox_reply_queue WHERE visitor_id = ?) AS queue_status`, [
    visitorId,
    visitorId,
    visitorId,
    visitorId,
  ]);
  return {
    pending_count: Number(row?.pending_count || 0),
    last_model_partner_reply_at: row?.last_model_partner_reply_at || null,
    last_visitor_message_at: row?.last_visitor_message_at || null,
    queue_status: row?.queue_status || 'idle',
  };
}

export async function recentMessagesForPatrol(db, visitorId, limit) {
  const readLimit = boundedLimit(limit, 60, PATROL_MESSAGE_LIMIT);
  const rows = await all(db, `SELECT * FROM (
      SELECT * FROM mailbox_messages
      WHERE visitor_id = ? AND status != 'hidden'
      ORDER BY created_at DESC, id DESC LIMIT ?
    ) ORDER BY created_at ASC, id ASC`, [visitorId, readLimit]);
  return rows.map(messageFromRow);
}
