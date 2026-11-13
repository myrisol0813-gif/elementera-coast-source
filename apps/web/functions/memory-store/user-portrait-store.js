import { MemoryStoreError, all, bool, first, iso, run } from './memory-db.js';

export const USER_PORTRAIT_ID = 'global';
export const USER_PORTRAIT_WRITE_GUIDANCE = `用户画像是一篇长期生长的正文，用于保存模型对当前用户逐渐形成的稳定认识，例如交流方式、语言指纹、思考与创作方式、长期偏好、边界、关系习惯与持续性的变化。不要把一次性的情绪、玩笑、临时状态或未经验证的猜测固化成画像。只有在真正形成值得长期保留的新认识时才提出修改候选；候选必须经用户确认后才进入正式正文。`;
export const USER_PORTRAIT_INITIAL_TEXT = '';

const schemaPromises = new WeakMap();

async function ensureSchema(db) {
  if (!db || typeof db.prepare !== 'function') throw new MemoryStoreError('memory_db_not_configured', '记忆 D1 存储未配置。', 503);
  if (!schemaPromises.has(db)) schemaPromises.set(db, (async () => {
    await run(db, `CREATE TABLE IF NOT EXISTS user_portrait (
      id TEXT PRIMARY KEY, body TEXT NOT NULL, write_enabled INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS user_portrait_candidates (
      id TEXT PRIMARY KEY, proposed_body TEXT NOT NULL, change_kind TEXT NOT NULL DEFAULT 'rewrite',
      reason TEXT NOT NULL DEFAULT '', source_conversation_id TEXT DEFAULT NULL,
      source_message_id TEXT DEFAULT NULL, source_model TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS user_portrait_revisions (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL, before_body TEXT NOT NULL, after_body TEXT NOT NULL,
      source_conversation_id TEXT DEFAULT NULL, source_message_id TEXT DEFAULT NULL,
      model_reason TEXT NOT NULL DEFAULT '', confirmation_mode TEXT NOT NULL,
      operator TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL
    )`);
    const now = Date.now();
    await run(db, `INSERT OR IGNORE INTO user_portrait
      (id, body, write_enabled, revision, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)`,
      [USER_PORTRAIT_ID, USER_PORTRAIT_INITIAL_TEXT, now, now]);
  })());
  return schemaPromises.get(db);
}

const portraitFromRow = (row) => ({
  write_guidance: USER_PORTRAIT_WRITE_GUIDANCE,
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

export async function readUserPortrait(db) {
  await ensureSchema(db);
  return portraitFromRow(await first(db, 'SELECT * FROM user_portrait WHERE id = ?', [USER_PORTRAIT_ID]));
}

export async function clearUserPortrait(db, expectedRevision) {
  await ensureSchema(db);
  const current = await readUserPortrait(db);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
    throw new MemoryStoreError('user_portrait_revision_conflict', '用户画像已经更新，请刷新后重新确认清空。', 409);
  }
  if (!current.body) return current;
  const now = Date.now();
  const nextRevision = current.revision + 1;
  await db.batch([
    db.prepare('UPDATE user_portrait SET body = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?')
      .bind('', nextRevision, now, USER_PORTRAIT_ID, expectedRevision),
    db.prepare(`INSERT INTO user_portrait_revisions
      (id, revision, before_body, after_body, model_reason, confirmation_mode, operator, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), nextRevision, current.body, '', '用户主动清空正式正文', 'clear', 'user', now),
  ]);
  return readUserPortrait(db);
}

export async function setUserPortraitWriteEnabled(db, enabled) {
  await ensureSchema(db);
  await run(db, 'UPDATE user_portrait SET write_enabled = ?, updated_at = ? WHERE id = ?',
    [enabled ? 1 : 0, Date.now(), USER_PORTRAIT_ID]);
  return readUserPortrait(db);
}

export async function listUserPortraitCandidates(db) {
  await ensureSchema(db);
  return (await all(db, 'SELECT * FROM user_portrait_candidates ORDER BY created_at DESC')).map(candidateFromRow);
}

export async function createUserPortraitCandidate(db, value = {}) {
  await ensureSchema(db);
  const current = await readUserPortrait(db);
  if (!current.write_enabled) throw new MemoryStoreError('user_portrait_read_only', '用户画像自动整理已关闭。', 409);
  const proposed = String(value.proposed_body || '').trim();
  if (!proposed) throw new MemoryStoreError('user_portrait_candidate_empty', '用户画像候选正文不能为空。');
  if (proposed.length > 240000) throw new MemoryStoreError('user_portrait_candidate_too_large', '用户画像候选正文过长。', 413);
  const duplicate = await first(db, 'SELECT * FROM user_portrait_candidates WHERE proposed_body = ? ORDER BY created_at DESC LIMIT 1', [proposed]);
  if (duplicate) return candidateFromRow(duplicate);
  const id = crypto.randomUUID();
  await run(db, `INSERT INTO user_portrait_candidates
    (id, proposed_body, change_kind, reason, source_conversation_id, source_message_id, source_model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    id, proposed, String(value.change_kind || 'rewrite').slice(0, 40), String(value.reason || '').slice(0, 4000),
    value.source_conversation_id || null, value.source_message_id || null, String(value.source_model || '').slice(0, 200), Date.now(),
  ]);
  return candidateFromRow(await first(db, 'SELECT * FROM user_portrait_candidates WHERE id = ?', [id]));
}

export async function discardUserPortraitCandidate(db, id) {
  await ensureSchema(db);
  const existing = await first(db, 'SELECT id FROM user_portrait_candidates WHERE id = ?', [String(id || '')]);
  if (!existing) return { deleted: false };
  await run(db, 'DELETE FROM user_portrait_candidates WHERE id = ?', [existing.id]);
  return { deleted: true };
}

export async function confirmUserPortraitCandidate(db, id, value = {}) {
  await ensureSchema(db);
  const candidate = await first(db, 'SELECT * FROM user_portrait_candidates WHERE id = ?', [String(id || '')]);
  if (!candidate) throw new MemoryStoreError('user_portrait_candidate_not_found', '找不到这条用户画像候选。', 404);
  const current = await readUserPortrait(db);
  const after = String(value.edited_body ?? candidate.proposed_body).trim();
  if (!after) throw new MemoryStoreError('user_portrait_empty', '用户画像正文不能为空。');
  if (after.length > 240000) throw new MemoryStoreError('user_portrait_too_large', '用户画像正文过长。', 413);
  const nextRevision = current.revision + 1;
  const confirmationMode = value.edited_body == null ? 'confirm' : 'edited_confirm';
  const now = Date.now();
  await db.batch([
    db.prepare('UPDATE user_portrait SET body = ?, revision = ?, updated_at = ? WHERE id = ?')
      .bind(after, nextRevision, now, USER_PORTRAIT_ID),
    db.prepare(`INSERT INTO user_portrait_revisions
      (id, revision, before_body, after_body, source_conversation_id, source_message_id, model_reason, confirmation_mode, operator, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), nextRevision, current.body, after, candidate.source_conversation_id, candidate.source_message_id,
        candidate.reason, confirmationMode, String(value.operator || 'user').slice(0, 40), now),
    db.prepare('DELETE FROM user_portrait_candidates WHERE id = ?').bind(candidate.id),
  ]);
  return readUserPortrait(db);
}

export async function listUserPortraitRevisions(db, limit = 100) {
  await ensureSchema(db);
  const rows = await all(db, 'SELECT * FROM user_portrait_revisions ORDER BY revision DESC LIMIT ?', [Math.min(500, Math.max(1, Number(limit) || 100))]);
  return rows.map((row) => ({
    id: row.id, revision: Number(row.revision || 0), before_body: String(row.before_body || ''),
    after_body: String(row.after_body || ''), source_conversation_id: row.source_conversation_id || null,
    source_message_id: row.source_message_id || null, model_reason: String(row.model_reason || ''),
    confirmation_mode: String(row.confirmation_mode || ''), operator: String(row.operator || ''), created_at: iso(row.created_at),
  }));
}

export { ensureSchema as ensureUserPortraitSchema };
