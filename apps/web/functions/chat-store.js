const USER_ID = 'owner';
const CONVERSATION_KINDS = new Set(['main', 'relay', 'bridge']);
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

async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

export async function ensureChatSchema(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new ChatStoreError('chat_db_not_configured', 'Chat database is not configured.', 503);
  }
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = run(db, `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'owner',
      title TEXT NOT NULL DEFAULT 'Main Chat',
      conversation_kind TEXT NOT NULL DEFAULT 'main',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER DEFAULT NULL
    )`);
    schemaPromises.set(db, ready);
  }
  try {
    await ready;
  } catch (error) {
    schemaPromises.delete(db);
    throw error;
  }
}

export async function getConversation(db, id) {
  await ensureChatSchema(db);
  const conversationId = sanitizeId(id, 'conversation');
  const row = await first(db, `SELECT * FROM conversations
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [conversationId, USER_ID]);
  if (!row) throw new ChatStoreError('conversation_not_found', 'Conversation not found.', 404);
  if (!CONVERSATION_KINDS.has(String(row.conversation_kind || 'main'))) {
    throw new ChatStoreError('invalid_conversation_kind', 'Conversation kind is invalid.', 400);
  }
  return row;
}
