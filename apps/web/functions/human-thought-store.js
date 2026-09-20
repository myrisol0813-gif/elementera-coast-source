import { getConversation, sanitizeId } from './chat-store.js';

const READ_MODES = new Set(['keep_private', 'read_now']);
const schemaPromises = new WeakMap();

export class HumanThoughtStoreError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'HumanThoughtStoreError';
    this.type = type;
    this.status = status;
  }
}

function clip(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

function publicHumanThought(row, conversationId = '') {
  return {
    id: row?.id || null,
    conversation_id: row?.conversation_id || conversationId || '',
    body: row?.body || '',
    context_note: row?.context_note || '',
    read_mode: READ_MODES.has(row?.read_mode) ? row.read_mode : 'keep_private',
    status: 'saved',
    updated_at: row?.updated_at ? new Date(Number(row.updated_at)).toISOString() : null,
  };
}

export async function ensureHumanThoughtSchema(db) {
  if (!db?.prepare) throw new HumanThoughtStoreError('chat_db_not_configured', 'Chat database is not configured.', 503);
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = run(db, `CREATE TABLE IF NOT EXISTS human_thought (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL DEFAULT '',
      context_note TEXT NOT NULL DEFAULT '',
      read_mode TEXT NOT NULL DEFAULT 'keep_private'
        CHECK (read_mode IN ('keep_private', 'read_now')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
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

export async function getHumanThought(db, input = {}) {
  await ensureHumanThoughtSchema(db);
  const conversationId = sanitizeId(input.conversation_id, 'conversation');
  await getConversation(db, conversationId);
  const row = await first(db, 'SELECT * FROM human_thought WHERE conversation_id = ?', [conversationId]);
  return publicHumanThought(row, conversationId);
}

export async function saveHumanThought(db, input = {}) {
  await ensureHumanThoughtSchema(db);
  const conversationId = sanitizeId(input.conversation_id, 'conversation');
  await getConversation(db, conversationId);
  const body = clip(input.body, 6000);
  const contextNote = clip(input.context_note, 3000);
  const readMode = READ_MODES.has(String(input.read_mode || '')) ? String(input.read_mode) : 'keep_private';
  const now = Date.now();
  const current = await first(db, 'SELECT * FROM human_thought WHERE conversation_id = ?', [conversationId]);
  const id = current?.id || sanitizeId(`human-thought-${crypto.randomUUID()}`, 'human-thought');
  await run(db, `INSERT INTO human_thought (
    id, conversation_id, body, context_note, read_mode, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(conversation_id) DO UPDATE SET
    body = excluded.body,
    context_note = excluded.context_note,
    read_mode = excluded.read_mode,
    updated_at = excluded.updated_at`,
  [id, conversationId, body, contextNote, readMode, current?.created_at || now, now]);
  return getHumanThought(db, { conversation_id: conversationId });
}

export async function humanThoughtContext(db, input = {}) {
  const note = await getHumanThought(db, input);
  if (note.read_mode !== 'read_now') return { selected: false, context: '', human_thought: note };
  const parts = [note.body, note.context_note].filter(Boolean);
  return {
    selected: parts.length > 0,
    context: parts.length ? `【人类思考链】\n${parts.join('\n')}` : '',
    human_thought: note,
  };
}
