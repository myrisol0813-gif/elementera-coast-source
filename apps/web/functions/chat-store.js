const OWNER_ID = 'owner';
const ROOM_TYPES = new Set(['main', 'radio', 'lighthouse', 'relay', 'bridge']);
const schemaPromises = new WeakMap();

export class ChatStoreError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'ChatStoreError';
    this.type = type;
    this.status = status;
  }
}

export function sanitizeId(value, fallback = 'id') {
  const clean = String(value || '').replace(/[^\w:.-]/g, '_').slice(0, 160);
  return clean || `${fallback}_${crypto.randomUUID()}`;
}
function clip(value, max) { return String(value ?? '').trim().slice(0, max); }
async function run(db, sql, params = []) { return db.prepare(sql).bind(...params).run(); }
async function first(db, sql, params = []) { return db.prepare(sql).bind(...params).first(); }
async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}
function safeJson(value, fallback = {}) { try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; } }

export async function ensureChatSchema(db) {
  if (!db?.prepare) throw new ChatStoreError('chat_db_not_configured', 'Chat database is not configured.', 503);
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = (async () => {
      await run(db, `CREATE TABLE IF NOT EXISTS source_conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        title TEXT NOT NULL DEFAULT '新聊天',
        room_type TEXT NOT NULL DEFAULT 'main',
        title_manual INTEGER NOT NULL DEFAULT 0,
        title_generated_at INTEGER DEFAULT NULL,
        history_json TEXT NOT NULL DEFAULT '{"version":1,"turns":[]}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER DEFAULT NULL
      )`);
      await run(db, `CREATE INDEX IF NOT EXISTS idx_source_conversations_owner
        ON source_conversations(user_id, deleted_at, updated_at DESC)`);
      await run(db, `CREATE TABLE IF NOT EXISTS source_owner_profile (
        user_id TEXT PRIMARY KEY,
        profile_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      )`);
    })();
    schemaPromises.set(db, ready);
  }
  try { await ready; } catch (error) { schemaPromises.delete(db); throw error; }
}
function rowConversation(row) {
  return {
    id: row.id,
    title: row.title,
    room_type: row.room_type,
    title_manual: Number(row.title_manual || 0) === 1,
    title_generated_at: row.title_generated_at ? new Date(Number(row.title_generated_at)).toISOString() : null,
    source: 'source',
    source_window_id: '',
    created_at: new Date(Number(row.created_at)).toISOString(),
    updated_at: new Date(Number(row.updated_at)).toISOString(),
  };
}
export async function listConversations(db) {
  await ensureChatSchema(db);
  const rows = await all(db, `SELECT * FROM source_conversations
    WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`, [OWNER_ID]);
  return rows.map(rowConversation);
}
export async function createConversation(db, value = {}) {
  await ensureChatSchema(db);
  const id = sanitizeId(value.id, 'conversation');
  const roomType = ROOM_TYPES.has(value.room_type) ? value.room_type : 'main';
  const title = clip(value.title, 160) || '新聊天';
  const now = Date.now();
  await run(db, `INSERT INTO source_conversations
    (id, user_id, title, room_type, title_manual, history_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)`, [id, OWNER_ID, title, roomType, JSON.stringify({ version: 1, turns: [] }), now, now]);
  return getConversation(db, id);
}
export async function getConversation(db, value) {
  await ensureChatSchema(db);
  const id = sanitizeId(value, 'conversation');
  const row = await first(db, `SELECT * FROM source_conversations
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [id, OWNER_ID]);
  if (!row) throw new ChatStoreError('conversation_not_found', 'Conversation not found.', 404);
  return rowConversation(row);
}
export async function updateConversation(db, idValue, value = {}) {
  const current = await getConversation(db, idValue);
  const id = current.id;
  const title = clip(value.title ?? current.title, 160) || current.title;
  const roomType = ROOM_TYPES.has(value.room_type) ? value.room_type : current.room_type;
  const manual = value.title != null ? 1 : current.title_manual ? 1 : 0;
  await run(db, `UPDATE source_conversations SET title = ?, room_type = ?, title_manual = ?, updated_at = ?
    WHERE id = ? AND user_id = ?`, [title, roomType, manual, Date.now(), id, OWNER_ID]);
  return getConversation(db, id);
}
export async function deleteConversation(db, idValue) {
  const current = await getConversation(db, idValue);
  await run(db, 'UPDATE source_conversations SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [Date.now(), Date.now(), current.id, OWNER_ID]);
  return current;
}
export async function readConversationState(db, idValue) {
  await ensureChatSchema(db);
  const id = sanitizeId(idValue, 'conversation');
  const row = await first(db, `SELECT history_json FROM source_conversations
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [id, OWNER_ID]);
  if (!row) throw new ChatStoreError('conversation_not_found', 'Conversation not found.', 404);
  const history = safeJson(row.history_json, { version: 1, turns: [] });
  return history && typeof history === 'object' ? history : { version: 1, turns: [] };
}
export async function writeConversationState(db, idValue, history = {}) {
  const current = await getConversation(db, idValue);
  const json = JSON.stringify(history && typeof history === 'object' ? history : { version: 1, turns: [] });
  if (json.length > 4_000_000) throw new ChatStoreError('history_too_large', '聊天记录过长。', 413);
  await run(db, 'UPDATE source_conversations SET history_json = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [json, Date.now(), current.id, OWNER_ID]);
  return readConversationState(db, current.id);
}
export async function readOwnerProfile(db) {
  await ensureChatSchema(db);
  const row = await first(db, 'SELECT profile_json FROM source_owner_profile WHERE user_id = ?', [OWNER_ID]);
  return safeJson(row?.profile_json, {});
}
export async function writeOwnerProfile(db, profile = {}) {
  await ensureChatSchema(db);
  const json = JSON.stringify(profile && typeof profile === 'object' ? profile : {});
  if (json.length > 200_000) throw new ChatStoreError('profile_too_large', '个人设置过长。', 413);
  const now = Date.now();
  await run(db, `INSERT INTO source_owner_profile (user_id, profile_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at`,
    [OWNER_ID, json, now]);
  return readOwnerProfile(db);
}
export async function setGeneratedTitle(db, idValue, titleValue) {
  const current = await getConversation(db, idValue);
  if (current.title_manual || current.title_generated_at) return current;
  const title = clip(titleValue, 80) || '新聊天';
  await run(db, `UPDATE source_conversations SET title = ?, title_generated_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ?`, [title, Date.now(), Date.now(), current.id, OWNER_ID]);
  return getConversation(db, current.id);
}
