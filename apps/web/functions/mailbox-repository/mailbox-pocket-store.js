import { ensureMailboxSchema } from '../mailbox-schema.js';
import {
  MailboxRepositoryError,
  VISITOR_POCKET_LIMIT,
  all,
  boundedLimit,
  first,
  now,
} from './mailbox-db.js';
import { notebookFromRow, pocketFromRow } from './mailbox-mappers.js';
import { getMailboxVisitor } from './mailbox-visitor-store.js';

export async function pocketFingerprint(visitorId, lifeCore) {
  const normalized = String(lifeCore || '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/g, ' ')
    .trim();
  const bytes = new TextEncoder().encode(`${visitorId}\u0000${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `mailbox-soil:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function listMailboxMemoryPockets(db, visitorId, {
  status = 'pending',
  limit = VISITOR_POCKET_LIMIT,
} = {}) {
  await ensureMailboxSchema(db);
  const readLimit = boundedLimit(limit, VISITOR_POCKET_LIMIT, VISITOR_POCKET_LIMIT);
  const rows = await all(db, `SELECT * FROM mailbox_memory_pockets
    WHERE visitor_id = ? AND status = ?
    ORDER BY updated_at DESC, id DESC LIMIT ?`, [visitorId, status, readLimit]);
  return rows.map(pocketFromRow);
}

export async function prepareMailboxPocketCandidates(value) {
  const memoryAllowed = Number(value.allow_memory || 0) === 1 || value.allow_memory === true;
  const candidateValues = memoryAllowed
    ? await Promise.all(value.thought_soil.pocket_candidates.map(async (candidate) => ({
      ...candidate,
      id: `mailbox-pocket-${crypto.randomUUID()}`,
      fingerprint: await pocketFingerprint(value.visitor_id, candidate.life_core),
    })))
    : [];
  return {
    candidateValues,
    memoryCandidatesSkipped: memoryAllowed ? 0 : value.thought_soil.pocket_candidates.length,
  };
}

export function mailboxPocketCandidateStatements(db, candidateValues, value, replyId, timestamp) {
  return candidateValues.map((candidate) => db.prepare(`INSERT INTO mailbox_memory_pockets (
      id, visitor_id, fingerprint, source_message_id, title, life_core,
      content, usage_hint, avoid_hint, source_excerpt, status,
      resolved_entry_id, generated_by_model, model_nickname, generation_source,
      source_conversation_id, source_turn_id, tool_call_id,
      created_at, updated_at, resolved_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?,
        'official_mcp', ?, ?, ?, ?, ?, NULL
      WHERE EXISTS (SELECT 1 FROM mailbox_messages WHERE id = ? AND role = 'myri')
    ON CONFLICT(visitor_id, fingerprint) DO UPDATE SET
      source_message_id = excluded.source_message_id,
      title = excluded.title,
      life_core = excluded.life_core,
      content = excluded.content,
      usage_hint = excluded.usage_hint,
      avoid_hint = excluded.avoid_hint,
      source_excerpt = excluded.source_excerpt,
      generated_by_model = excluded.generated_by_model,
      model_nickname = excluded.model_nickname,
      source_conversation_id = excluded.source_conversation_id,
      source_turn_id = excluded.source_turn_id,
      tool_call_id = excluded.tool_call_id,
      updated_at = excluded.updated_at
    WHERE mailbox_memory_pockets.status = 'pending'`).bind(
    candidate.id,
    value.visitor_id,
    candidate.fingerprint,
    replyId,
    candidate.title,
    candidate.life_core,
    candidate.content,
    candidate.usage_hint,
    candidate.avoid_hint,
    candidate.source_excerpt,
    value.model_label,
    value.model_nickname || null,
    value.source_conversation_id || null,
    value.source_turn_id || replyId,
    value.tool_call_id || null,
    timestamp,
    timestamp,
    replyId,
  ));
}

export async function resolveMailboxMemoryPocket(db, value) {
  await ensureMailboxSchema(db);
  const visitor = await getMailboxVisitor(db, value.visitor_id);
  if (!visitor?.is_active) {
    throw new MailboxRepositoryError('mailbox_visitor_not_found', '这位访客当前不可用。', 410);
  }
  if (!visitor.allow_memory && value.action === 'remember') {
    throw new MailboxRepositoryError(
      'mailbox_memory_not_allowed',
      '这位访客没有允许写入访客记事本。',
      409,
    );
  }
  const pocket = await first(db, `SELECT * FROM mailbox_memory_pockets
    WHERE id = ? AND visitor_id = ?`, [value.pocket_id, value.visitor_id]);
  if (!pocket) {
    throw new MailboxRepositoryError('mailbox_pocket_not_found', '这条待确认内容不存在。', 404);
  }
  if (value.action === 'discard') {
    if (pocket.status === 'discarded') {
      return { pocket: pocketFromRow(pocket), entry: null, idempotent: true };
    }
    if (pocket.status !== 'pending') {
      throw new MailboxRepositoryError('mailbox_pocket_resolved', '这条内容已经离开待确认区。', 409);
    }
    const timestamp = now();
    await db.prepare(`UPDATE mailbox_memory_pockets SET
      status = 'discarded', resolved_at = ?, updated_at = ?
      WHERE id = ? AND visitor_id = ? AND status = 'pending'`).bind(
      timestamp,
      timestamp,
      value.pocket_id,
      value.visitor_id,
    ).run();
    return {
      pocket: pocketFromRow(await first(db, `SELECT * FROM mailbox_memory_pockets
        WHERE id = ? AND visitor_id = ?`, [value.pocket_id, value.visitor_id])),
      entry: null,
      idempotent: false,
    };
  }
  if (pocket.status === 'confirmed' && pocket.resolved_entry_id) {
    const entry = await first(db, `SELECT * FROM visitor_notebook_entries
      WHERE id = ? AND visitor_id = ?`, [pocket.resolved_entry_id, value.visitor_id]);
    return { pocket: pocketFromRow(pocket), entry: entry ? notebookFromRow(entry) : null, idempotent: true };
  }
  if (pocket.status !== 'pending') {
    throw new MailboxRepositoryError('mailbox_pocket_resolved', '这条内容已经离开待确认区。', 409);
  }
  const entryId = `visitor-note-${crypto.randomUUID()}`;
  const timestamp = now();
  await db.batch([
    db.prepare(`INSERT INTO visitor_notebook_entries (
      id, visitor_id, entry_type, title, life_core, content, usage_hint,
      avoid_hint, source_message_id, source_pocket_id, created_at, updated_at,
      confidence, visibility, status, generated_by_model, model_nickname,
      generation_source, source_conversation_id, source_turn_id, tool_call_id, archived
    ) SELECT ?, visitor_id, 'memory', ?, ?, ?, ?, ?, source_message_id, id,
        ?, ?, ?, ?, 'active', generated_by_model, model_nickname,
        'official_mcp', ?, ?, ?, 0
      FROM mailbox_memory_pockets
      WHERE id = ? AND visitor_id = ? AND status = 'pending'`).bind(
      entryId,
      value.title || pocket.title,
      value.life_core || pocket.life_core,
      value.content || pocket.content,
      value.usage_hint ?? pocket.usage_hint,
      value.avoid_hint ?? pocket.avoid_hint,
      timestamp,
      timestamp,
      value.confidence,
      value.visibility,
      value.source_conversation_id || pocket.source_conversation_id || null,
      value.source_turn_id || pocket.source_turn_id || null,
      value.tool_call_id || null,
      value.pocket_id,
      value.visitor_id,
    ),
    db.prepare(`UPDATE mailbox_memory_pockets SET
      status = 'confirmed', resolved_entry_id = ?, resolved_at = ?, updated_at = ?
      WHERE id = ? AND visitor_id = ? AND status = 'pending'
        AND EXISTS (SELECT 1 FROM visitor_notebook_entries WHERE id = ?)`).bind(
      entryId,
      timestamp,
      timestamp,
      value.pocket_id,
      value.visitor_id,
      entryId,
    ),
  ]);
  const entry = await first(db, `SELECT * FROM visitor_notebook_entries
    WHERE id = ? AND visitor_id = ?`, [entryId, value.visitor_id]);
  if (!entry) {
    throw new MailboxRepositoryError('mailbox_pocket_resolved', '这条内容已经离开待确认区。', 409);
  }
  return {
    pocket: pocketFromRow(await first(db, `SELECT * FROM mailbox_memory_pockets
      WHERE id = ? AND visitor_id = ?`, [value.pocket_id, value.visitor_id])),
    entry: notebookFromRow(entry),
    idempotent: false,
  };
}
