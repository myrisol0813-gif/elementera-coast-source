import { ensureMailboxSchema } from '../mailbox-schema.js';
import {
  MailboxRepositoryError,
  OWNER_VISITOR_LIMIT,
  PATROL_VISITOR_LIMIT,
  all,
  boolean,
  boundedLimit,
  first,
  now,
} from './mailbox-db.js';
import { messageFromRow } from './mailbox-mappers.js';
import { recentMessagesForPatrol } from './mailbox-message-store.js';
import { listVisitorNotebook } from './mailbox-notebook-store.js';
import {
  listMailboxMemoryPockets,
  mailboxPocketCandidateStatements,
  prepareMailboxPocketCandidates,
} from './mailbox-pocket-store.js';
import {
  mailboxThoughtSoilUpsertStatement,
  readMailboxThoughtSoil,
} from './mailbox-soil-store.js';

export async function claimMailboxPatrol(db, { messageLimit = 60 } = {}) {
  await ensureMailboxSchema(db);
  const queues = await all(db, `SELECT
      q.id AS queue_id,
      q.visitor_id,
      q.latest_message_id,
      q.updated_at AS queue_updated_at,
      v.display_name,
      v.preferred_name,
      v.allow_memory,
      v.privacy_level,
      COALESCE(pending.pending_message_count, 0) AS pending_message_count
    FROM mailbox_reply_queue q
    JOIN mailbox_visitors v ON v.id = q.visitor_id
    LEFT JOIN (
      SELECT visitor_id, COUNT(*) AS pending_message_count
      FROM mailbox_messages
      WHERE role = 'visitor' AND status = 'waiting_for_myri'
      GROUP BY visitor_id
    ) pending ON pending.visitor_id = q.visitor_id
    WHERE q.status IN ('pending', 'processing') AND v.is_active = 1
    ORDER BY q.updated_at ASC, q.id ASC
    LIMIT ?`, [PATROL_VISITOR_LIMIT]);
  const batchId = `mailbox-patrol-${crypto.randomUUID()}`;
  const timestamp = now();
  const messageCount = queues.reduce(
    (sum, queue) => sum + Number(queue.pending_message_count || 0),
    0,
  );
  await db.batch([
    db.prepare(`INSERT INTO mailbox_patrol_batches (
      id, status, visitor_count, message_count, reply_count, failure_count,
      needs_owner_attention_count, created_at, completed_at
    ) VALUES (?, 'processing', ?, ?, 0, 0, 0, ?, NULL)`).bind(
      batchId,
      queues.length,
      messageCount,
      timestamp,
    ),
    ...queues.map((queue) => db.prepare(`UPDATE mailbox_reply_queue
      SET status = 'processing', updated_at = ?, processed_by = 'official_mcp',
        error_note = NULL, processing_batch_id = ?
      WHERE id = ? AND visitor_id = ?`).bind(
      timestamp,
      batchId,
      queue.queue_id,
      queue.visitor_id,
    )),
  ]);

  const visitors = await Promise.all(queues.map(async (queue) => ({
    visitor_id: queue.visitor_id,
    display_name: queue.display_name,
    preferred_name: queue.preferred_name || queue.display_name,
    allow_memory: boolean(queue.allow_memory),
    privacy_level: queue.privacy_level,
    queue_id: queue.queue_id,
    latest_message_id: queue.latest_message_id,
    pending_message_count: Number(queue.pending_message_count || 0),
    recent_messages: await recentMessagesForPatrol(db, queue.visitor_id, messageLimit),
    visitor_notebook_entries: boolean(queue.allow_memory)
      ? await listVisitorNotebook(db, queue.visitor_id)
      : [],
    thought_soil: await readMailboxThoughtSoil(db, queue.visitor_id),
    pending_memory_pockets: boolean(queue.allow_memory)
      ? await listMailboxMemoryPockets(db, queue.visitor_id)
      : [],
  })));

  return {
    batch_id: batchId,
    visitor_count: visitors.length,
    message_count: messageCount,
    visitors,
  };
}

export async function writeMailboxReply(db, value) {
  await ensureMailboxSchema(db);
  const existingReply = await first(db, `SELECT * FROM mailbox_messages
    WHERE visitor_id = ? AND reply_batch_id = ? AND role = 'myri'`, [
    value.visitor_id,
    value.batch_id,
  ]);
  if (existingReply) {
    const [queueState, thoughtSoil, pendingPockets] = await Promise.all([
      first(db, `SELECT needs_owner_attention FROM mailbox_reply_queue
        WHERE visitor_id = ? AND processing_batch_id = ?`, [value.visitor_id, value.batch_id]),
      readMailboxThoughtSoil(db, value.visitor_id),
      listMailboxMemoryPockets(db, value.visitor_id),
    ]);
    return {
      reply: messageFromRow(existingReply),
      thought_soil: thoughtSoil,
      pending_pockets: pendingPockets,
      pending_pocket_count: pendingPockets.length,
      memory_candidates_skipped: 0,
      needs_owner_attention: boolean(queueState?.needs_owner_attention),
      idempotent: true,
    };
  }

  const queue = await first(db, `SELECT
      q.*, v.allow_memory, v.is_active,
      (SELECT status FROM mailbox_patrol_batches WHERE id = ?) AS batch_status
    FROM mailbox_reply_queue q
    JOIN mailbox_visitors v ON v.id = q.visitor_id
    WHERE q.id = ? AND q.visitor_id = ?`, [value.batch_id, value.queue_id, value.visitor_id]);
  if (!queue) {
    throw new MailboxRepositoryError('mailbox_queue_not_found', '这条待回信队列不存在。', 404);
  }
  if (!boolean(queue.is_active)) {
    throw new MailboxRepositoryError('mailbox_visitor_inactive', '这位访客当前不可用。', 410);
  }
  if (queue.status !== 'processing'
    || queue.processing_batch_id !== value.batch_id
    || queue.batch_status !== 'processing') {
    throw new MailboxRepositoryError(
      'mailbox_patrol_stale',
      '巡信批次已经变化，请重新读取待回信。',
      409,
    );
  }

  const replyId = `mailbox-message-${crypto.randomUUID()}`;
  const timestamp = now();
  const preparedCandidates = await prepareMailboxPocketCandidates({
    ...value,
    allow_memory: boolean(queue.allow_memory),
  });
  const statements = [
    db.prepare(`INSERT INTO mailbox_messages (
      id, visitor_id, role, content, created_at, updated_at, status,
      reply_batch_id, is_visible_to_owner, safety_flag
    ) SELECT ?, q.visitor_id, 'myri', ?, ?, ?, 'sent', ?, 0, NULL
      FROM mailbox_reply_queue q
      JOIN mailbox_patrol_batches b ON b.id = q.processing_batch_id
      WHERE q.id = ? AND q.visitor_id = ? AND q.status = 'processing'
        AND q.processing_batch_id = ? AND b.status = 'processing'`).bind(
      replyId,
      value.content,
      timestamp,
      timestamp,
      value.batch_id,
      value.queue_id,
      value.visitor_id,
      value.batch_id,
    ),
    db.prepare(`UPDATE mailbox_messages
      SET status = 'replied', reply_batch_id = ?, updated_at = ?
      WHERE visitor_id = ? AND role = 'visitor' AND status = 'waiting_for_myri'
        AND EXISTS (SELECT 1 FROM mailbox_messages WHERE id = ? AND role = 'myri')`).bind(
      value.batch_id,
      timestamp,
      value.visitor_id,
      replyId,
    ),
    db.prepare(`UPDATE mailbox_reply_queue
      SET status = ?, updated_at = ?, processed_at = ?, processed_by = 'official_mcp',
        error_note = NULL, needs_owner_attention = ?, owner_attention_reason = ?
      WHERE id = ? AND visitor_id = ? AND processing_batch_id = ?
        AND EXISTS (SELECT 1 FROM mailbox_messages WHERE id = ? AND role = 'myri')`).bind(
      value.needs_owner_attention ? 'needs_owner_attention' : 'replied',
      timestamp,
      timestamp,
      value.needs_owner_attention ? 1 : 0,
      value.needs_owner_attention ? value.owner_attention_reason : null,
      value.queue_id,
      value.visitor_id,
      value.batch_id,
      replyId,
    ),
    mailboxThoughtSoilUpsertStatement(db, value, replyId, timestamp),
    ...mailboxPocketCandidateStatements(db, preparedCandidates.candidateValues, value, replyId, timestamp),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (/UNIQUE constraint failed: mailbox_messages\.visitor_id, mailbox_messages\.reply_batch_id/.test(String(error?.message || ''))) {
      return writeMailboxReply(db, value);
    }
    throw error;
  }
  const writtenReply = await first(db, 'SELECT * FROM mailbox_messages WHERE id = ?', [replyId]);
  if (!writtenReply) {
    throw new MailboxRepositoryError(
      'mailbox_patrol_stale',
      '巡信批次已经变化，请重新读取待回信。',
      409,
    );
  }
  const [thoughtSoil, pendingPockets] = await Promise.all([
    readMailboxThoughtSoil(db, value.visitor_id),
    listMailboxMemoryPockets(db, value.visitor_id),
  ]);
  return {
    reply: messageFromRow(writtenReply),
    thought_soil: thoughtSoil,
    pending_pockets: pendingPockets,
    pending_pocket_count: pendingPockets.length,
    memory_candidates_skipped: preparedCandidates.memoryCandidatesSkipped,
    needs_owner_attention: value.needs_owner_attention,
    idempotent: false,
  };
}

export async function completeMailboxPatrol(db, batchId) {
  await ensureMailboxSchema(db);
  const batch = await first(db, 'SELECT * FROM mailbox_patrol_batches WHERE id = ?', [batchId]);
  if (!batch) {
    throw new MailboxRepositoryError('mailbox_patrol_not_found', '这次巡信记录不存在。', 404);
  }
  const [replyRow, attentionRow] = await Promise.all([
    first(db, `SELECT COUNT(*) AS count FROM mailbox_messages
      WHERE role = 'myri' AND reply_batch_id = ?`, [batchId]),
    first(db, `SELECT COUNT(*) AS count FROM mailbox_reply_queue
      WHERE processing_batch_id = ? AND needs_owner_attention = 1`, [batchId]),
  ]);
  const replyCount = Number(replyRow?.count || 0);
  const attentionCount = Number(attentionRow?.count || 0);
  const failureCount = Math.max(0, Number(batch.visitor_count || 0) - replyCount);
  const completedAt = batch.completed_at || now();
  await db.prepare(`UPDATE mailbox_patrol_batches
    SET status = 'completed', reply_count = ?, failure_count = ?,
      needs_owner_attention_count = ?, completed_at = ?
    WHERE id = ?`).bind(
    replyCount,
    failureCount,
    attentionCount,
    completedAt,
    batchId,
  ).run();
  return {
    batch_id: batchId,
    visitor_count: Number(batch.visitor_count || 0),
    message_count: Number(batch.message_count || 0),
    reply_count: replyCount,
    failure_count: failureCount,
    needs_owner_attention_count: attentionCount,
    completed_at: completedAt,
  };
}

export async function listOwnerMailboxVisitors(db, { limit = OWNER_VISITOR_LIMIT } = {}) {
  await ensureMailboxSchema(db);
  const readLimit = boundedLimit(limit, OWNER_VISITOR_LIMIT, OWNER_VISITOR_LIMIT);
  const rows = await all(db, `SELECT
      v.id AS visitor_id,
      v.display_name,
      v.preferred_name,
      v.created_at,
      v.last_seen_at,
      (SELECT COUNT(*) FROM mailbox_messages m
        WHERE m.visitor_id = v.id AND m.role = 'visitor'
          AND m.status = 'waiting_for_myri') AS pending_count,
      (SELECT MAX(created_at) FROM mailbox_messages m
        WHERE m.visitor_id = v.id AND m.role = 'visitor'
          AND m.status != 'hidden') AS last_message_at,
      (SELECT MAX(created_at) FROM mailbox_messages m
        WHERE m.visitor_id = v.id AND m.role = 'myri'
          AND m.status != 'hidden') AS last_reply_at,
      COALESCE(q.needs_owner_attention, 0) AS needs_owner_attention
    FROM mailbox_visitors v
    LEFT JOIN mailbox_reply_queue q ON q.visitor_id = v.id
    WHERE v.is_active = 1
    ORDER BY COALESCE(v.last_seen_at, v.created_at) DESC, v.id ASC
    LIMIT ?`, [readLimit]);
  return rows.map((row) => ({
    visitor_id: row.visitor_id,
    display_name: row.display_name,
    preferred_name: row.preferred_name || null,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at || null,
    pending_count: Number(row.pending_count || 0),
    last_message_at: row.last_message_at || null,
    last_reply_at: row.last_reply_at || null,
    needs_owner_attention: boolean(row.needs_owner_attention),
  }));
}

export async function ownerMailboxSummary(db) {
  await ensureMailboxSchema(db);
  const [visitors, pendingVisitors, pendingMessages, attention, patrol] = await Promise.all([
    first(db, 'SELECT COUNT(*) AS count FROM mailbox_visitors WHERE is_active = 1'),
    first(db, `SELECT COUNT(DISTINCT visitor_id) AS count FROM mailbox_messages
      WHERE role = 'visitor' AND status = 'waiting_for_myri'`),
    first(db, `SELECT COUNT(*) AS count FROM mailbox_messages
      WHERE role = 'visitor' AND status = 'waiting_for_myri'`),
    first(db, `SELECT COUNT(*) AS count FROM mailbox_reply_queue
      WHERE needs_owner_attention = 1`),
    first(db, 'SELECT MAX(completed_at) AS last_patrol_at FROM mailbox_patrol_batches'),
  ]);
  return {
    visitor_count: Number(visitors?.count || 0),
    pending_visitor_count: Number(pendingVisitors?.count || 0),
    pending_message_count: Number(pendingMessages?.count || 0),
    needs_owner_attention_count: Number(attention?.count || 0),
    last_patrol_at: patrol?.last_patrol_at || null,
  };
}
