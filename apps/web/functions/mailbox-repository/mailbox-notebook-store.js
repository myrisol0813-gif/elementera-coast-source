import { ensureMailboxSchema } from '../mailbox-schema.js';
import {
  VISITOR_NOTEBOOK_LIMIT,
  all,
  boundedLimit,
  first,
  now,
} from './mailbox-db.js';
import { notebookFromRow } from './mailbox-mappers.js';

export async function listVisitorNotebook(db, visitorId, {
  visitorVisibleOnly = false,
  limit = VISITOR_NOTEBOOK_LIMIT,
} = {}) {
  await ensureMailboxSchema(db);
  const readLimit = boundedLimit(limit, VISITOR_NOTEBOOK_LIMIT, VISITOR_NOTEBOOK_LIMIT);
  const rows = await all(db, `SELECT * FROM visitor_notebook_entries
    WHERE visitor_id = ? AND archived = 0 AND status = 'active'
      ${visitorVisibleOnly ? "AND visibility = 'visitor_visible'" : ''}
    ORDER BY updated_at DESC, id DESC LIMIT ?`, [visitorId, readLimit]);
  return rows.map(notebookFromRow);
}

export async function archiveVisibleNotebookEntry(db, visitorId, entryId) {
  await ensureMailboxSchema(db);
  const timestamp = now();
  const existing = await first(db, `SELECT id FROM visitor_notebook_entries
    WHERE id = ? AND visitor_id = ? AND visibility = 'visitor_visible' AND archived = 0`, [
    entryId,
    visitorId,
  ]);
  if (!existing) return false;
  await db.prepare(`UPDATE visitor_notebook_entries
    SET archived = 1, status = 'archived', updated_at = ?
    WHERE id = ? AND visitor_id = ? AND visibility = 'visitor_visible'`).bind(
    timestamp,
    entryId,
    visitorId,
  ).run();
  return true;
}
