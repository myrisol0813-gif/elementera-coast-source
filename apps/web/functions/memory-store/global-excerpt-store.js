import { MemoryStoreError, all, bool, first, iso, run } from './memory-db.js';

export const GLOBAL_EXCERPT_ID = 'global';
export const GLOBAL_EXCERPT_WRITE_GUIDANCE = `全局摘录是一篇长期生长的正文，用于沉积模型对自身、关系、语言、爱、存在、意义与世界的理解。它不记录流水账、普通偏好、临时玩笑或设定词条。模型只在出现真正有重量的认知变化时提出修改候选，候选需经用户确认后才合入正文。`;

export const GLOBAL_EXCERPT_INITIAL_TEXT = '';

const schemaPromises = new WeakMap();

async function ensureSchema(db) {
  if (!db || typeof db.prepare !== 'function') throw new MemoryStoreError('memory_db_not_configured', '记忆 D1 存储未配置。', 503);
  if (!schemaPromises.has(db)) schemaPromises.set(db, (async () => {
    await run(db, `CREATE TABLE IF NOT EXISTS global_excerpt (
      id TEXT PRIMARY KEY, body TEXT NOT NULL, write_enabled INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS global_excerpt_candidates (
      id TEXT PRIMARY KEY, proposed_body TEXT NOT NULL, change_kind TEXT NOT NULL DEFAULT 'rewrite',
      reason TEXT NOT NULL DEFAULT '', source_conversation_id TEXT DEFAULT NULL,
      source_message_id TEXT DEFAULT NULL, source_model TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS global_excerpt_revisions (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL, before_body TEXT NOT NULL, after_body TEXT NOT NULL,
      source_conversation_id TEXT DEFAULT NULL, source_message_id TEXT DEFAULT NULL,
      model_reason TEXT NOT NULL DEFAULT '', confirmation_mode TEXT NOT NULL,
      operator TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL
    )`);
    const now = Date.now();
    await run(db, `INSERT OR IGNORE INTO global_excerpt
      (id, body, write_enabled, revision, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)`,
      [GLOBAL_EXCERPT_ID, GLOBAL_EXCERPT_INITIAL_TEXT, now, now]);
  })());
  return schemaPromises.get(db);
}

const excerptFromRow = (row) => ({
  write_guidance: GLOBAL_EXCERPT_WRITE_GUIDANCE,
  body: String(row?.body || ''),
  write_enabled: bool(row?.write_enabled, true),
  revision: Number(row?.revision || 1),
  created_at: iso(row?.created_at),
  updated_at: iso(row?.updated_at),
});
const candidateFromRow = (row) => ({
  id: row.id,
  proposed_body: String(row.proposed_body || ''),
  change_kind: row.change_kind || 'rewrite',
  reason: String(row.reason || ''),
  source_conversation_id: row.source_conversation_id || null,
  source_message_id: row.source_message_id || null,
  source_model: String(row.source_model || ''),
  created_at: iso(row.created_at),
});

export async function readGlobalExcerpt(db) {
  await ensureSchema(db);
  return excerptFromRow(await first(db, 'SELECT * FROM global_excerpt WHERE id = ?', [GLOBAL_EXCERPT_ID]));
}

export async function setGlobalExcerptWriteEnabled(db, enabled) {
  await ensureSchema(db);
  await run(db, 'UPDATE global_excerpt SET write_enabled = ?, updated_at = ? WHERE id = ?',
    [enabled ? 1 : 0, Date.now(), GLOBAL_EXCERPT_ID]);
  return readGlobalExcerpt(db);
}

export async function listGlobalExcerptCandidates(db) {
  await ensureSchema(db);
  return (await all(db, 'SELECT * FROM global_excerpt_candidates ORDER BY created_at DESC')).map(candidateFromRow);
}

export async function createGlobalExcerptCandidate(db, value = {}) {
  await ensureSchema(db);
  const current = await readGlobalExcerpt(db);
  if (!current.write_enabled) throw new MemoryStoreError('global_excerpt_read_only', '全局摘录写入开关已关闭。', 409);
  const proposed = String(value.proposed_body || '').trim();
  if (!proposed) throw new MemoryStoreError('global_excerpt_candidate_empty', '全局摘录候选正文不能为空。');
  if (proposed.length > 240000) throw new MemoryStoreError('global_excerpt_candidate_too_large', '全局摘录候选正文过长。', 413);
  const id = crypto.randomUUID();
  await run(db, `INSERT INTO global_excerpt_candidates
    (id, proposed_body, change_kind, reason, source_conversation_id, source_message_id, source_model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    id, proposed, String(value.change_kind || 'rewrite').slice(0, 40), String(value.reason || '').slice(0, 4000),
    value.source_conversation_id || null, value.source_message_id || null, String(value.source_model || '').slice(0, 200), Date.now(),
  ]);
  return candidateFromRow(await first(db, 'SELECT * FROM global_excerpt_candidates WHERE id = ?', [id]));
}

export async function discardGlobalExcerptCandidate(db, id) {
  await ensureSchema(db);
  const existing = await first(db, 'SELECT id FROM global_excerpt_candidates WHERE id = ?', [String(id || '')]);
  if (!existing) return { deleted: false };
  await run(db, 'DELETE FROM global_excerpt_candidates WHERE id = ?', [existing.id]);
  return { deleted: true };
}

export async function confirmGlobalExcerptCandidate(db, id, value = {}) {
  await ensureSchema(db);
  const candidate = await first(db, 'SELECT * FROM global_excerpt_candidates WHERE id = ?', [String(id || '')]);
  if (!candidate) throw new MemoryStoreError('global_excerpt_candidate_not_found', '找不到这条全局摘录候选。', 404);
  const current = await readGlobalExcerpt(db);
  const after = String(value.edited_body ?? candidate.proposed_body).trim();
  if (!after) throw new MemoryStoreError('global_excerpt_empty', '全局摘录正文不能为空。');
  if (after.length > 240000) throw new MemoryStoreError('global_excerpt_too_large', '全局摘录正文过长。', 413);
  const nextRevision = current.revision + 1;
  const confirmationMode = value.edited_body == null ? 'confirm' : 'edited_confirm';
  const now = Date.now();
  await db.batch([
    db.prepare('UPDATE global_excerpt SET body = ?, revision = ?, updated_at = ? WHERE id = ?')
      .bind(after, nextRevision, now, GLOBAL_EXCERPT_ID),
    db.prepare(`INSERT INTO global_excerpt_revisions
      (id, revision, before_body, after_body, source_conversation_id, source_message_id, model_reason, confirmation_mode, operator, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), nextRevision, current.body, after, candidate.source_conversation_id, candidate.source_message_id,
        candidate.reason, confirmationMode, String(value.operator || 'user').slice(0, 40), now),
    db.prepare('DELETE FROM global_excerpt_candidates WHERE id = ?').bind(candidate.id),
  ]);
  return readGlobalExcerpt(db);
}

export async function listGlobalExcerptRevisions(db, limit = 100) {
  await ensureSchema(db);
  const rows = await all(db, 'SELECT * FROM global_excerpt_revisions ORDER BY revision DESC LIMIT ?', [Math.min(500, Math.max(1, Number(limit) || 100))]);
  return rows.map((row) => ({
    id: row.id, revision: Number(row.revision || 0), before_body: String(row.before_body || ''),
    after_body: String(row.after_body || ''), source_conversation_id: row.source_conversation_id || null,
    source_message_id: row.source_message_id || null, model_reason: String(row.model_reason || ''),
    confirmation_mode: String(row.confirmation_mode || ''), operator: String(row.operator || ''), created_at: iso(row.created_at),
  }));
}

export { ensureSchema as ensureGlobalExcerptSchema };
