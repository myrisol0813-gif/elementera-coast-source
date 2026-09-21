import { sanitizeId } from './chat-store.js';

const schemaPromises = new WeakMap();
const MAX_METADATA_JSON = 512000;
const MAX_RAW_JSON = 1024 * 1024;

function safeJson(value, maxLength) {
  if (value == null) return null;
  try {
    const encoded = JSON.stringify(value);
    if (!encoded || encoded.length > maxLength) return null;
    return encoded;
  } catch {
    return null;
  }
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function ensureSchema(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('model metadata database unavailable');
  if (!schemaPromises.has(db)) {
    schemaPromises.set(db, (async () => {
      await db.prepare(`CREATE TABLE IF NOT EXISTS message_model_metadata (
        message_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'saved',
        sanitized INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT,
        raw_metadata_sanitized_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_message_model_metadata_conversation
        ON message_model_metadata(conversation_id, updated_at DESC)`).run();
    })());
  }
  return schemaPromises.get(db);
}

function requireStoredIds(conversationId, messageId) {
  if (!String(conversationId || '').trim() || !String(messageId || '').trim()) {
    throw new Error('model metadata requires real conversation and message ids');
  }
  return {
    conversationId: sanitizeId(conversationId, 'conversation'),
    messageId: sanitizeId(messageId, 'assistant_variant'),
  };
}

function rowToRecord(row, { includeRaw = false } = {}) {
  return {
    ok: true,
    conversation_id: row.conversation_id,
    message_id: row.message_id,
    status: row.status || 'saved',
    sanitized: Number(row.sanitized || 0) === 1,
    metadata: parseJson(row.metadata_json),
    raw_metadata_sanitized: includeRaw ? parseJson(row.raw_metadata_sanitized_json) : null,
    created_at: new Date(Number(row.created_at || Date.now())).toISOString(),
    updated_at: new Date(Number(row.updated_at || Date.now())).toISOString(),
  };
}

export async function writeMessageModelMetadata(db, conversationId, messageId, value = {}) {
  await ensureSchema(db);
  const ids = requireStoredIds(conversationId, messageId);
  const safeConversationId = ids.conversationId;
  const safeMessageId = ids.messageId;
  const timestamp = Date.now();
  const metadataJson = safeJson(value.metadata, MAX_METADATA_JSON);
  const rawJson = safeJson(value.raw_metadata_sanitized, MAX_RAW_JSON);
  const status = String(value.status || 'saved').slice(0, 40);
  const sanitized = value.sanitized === false ? 0 : 1;
  await db.prepare(`INSERT INTO message_model_metadata (
      message_id, conversation_id, status, sanitized, metadata_json,
      raw_metadata_sanitized_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET
      conversation_id = excluded.conversation_id,
      status = excluded.status,
      sanitized = excluded.sanitized,
      metadata_json = excluded.metadata_json,
      raw_metadata_sanitized_json = excluded.raw_metadata_sanitized_json,
      updated_at = excluded.updated_at`)
    .bind(
      safeMessageId,
      safeConversationId,
      status,
      sanitized,
      metadataJson,
      rawJson,
      timestamp,
      timestamp,
    )
    .run();
  return { message_id: safeMessageId, conversation_id: safeConversationId, status, sanitized: Boolean(sanitized) };
}

export async function readMessageModelMetadata(db, conversationId, messageId, { includeRaw = false } = {}) {
  await ensureSchema(db);
  const ids = requireStoredIds(conversationId, messageId);
  const safeConversationId = ids.conversationId;
  const safeMessageId = ids.messageId;
  const row = await db.prepare(`SELECT message_id, conversation_id, status, sanitized, metadata_json,
      raw_metadata_sanitized_json, created_at, updated_at
    FROM message_model_metadata
    WHERE conversation_id = ? AND message_id = ?`)
    .bind(safeConversationId, safeMessageId)
    .first();
  if (!row) {
    return {
      ok: true,
      conversation_id: safeConversationId,
      message_id: safeMessageId,
      status: 'not_returned',
      sanitized: true,
      metadata: null,
      raw_metadata_sanitized: null,
    };
  }
  return rowToRecord(row, { includeRaw });
}

export async function listAllMessageModelMetadata(db, { includeRaw = true, limit = 10000 } = {}) {
  await ensureSchema(db);
  const safeLimit = Math.min(10000, Math.max(1, Number(limit) || 10000));
  const result = await db.prepare(`SELECT message_id, conversation_id, status, sanitized, metadata_json,
      raw_metadata_sanitized_json, created_at, updated_at
    FROM message_model_metadata
    ORDER BY created_at ASC LIMIT ?`)
    .bind(safeLimit)
    .all();
  return (result?.results || []).map((row) => rowToRecord(row, { includeRaw }));
}

export async function deleteConversationModelMetadata(db, conversationId) {
  await ensureSchema(db);
  const rawConversationId = String(conversationId || '').trim();
  if (!rawConversationId) return;
  const safeConversationId = sanitizeId(rawConversationId, 'conversation');
  await db.prepare('DELETE FROM message_model_metadata WHERE conversation_id = ?')
    .bind(safeConversationId)
    .run();
}

export async function markMessageModelMetadataFailure(db, conversationId, messageId, errorSummary = '') {
  const metadata = {
    requested_model: null,
    resolved_model: null,
    provider: null,
    provider_route: null,
    reasoning_text: null,
    reasoning_summary: null,
    reasoning_details: null,
    reasoning_encrypted_content_present: false,
    reasoning_encrypted_content_length: null,
    reasoning_encrypted_content_digest: null,
    reasoning_status: 'not_returned',
    usage: null,
    finish_reason: 'error',
    native_finish_reason: null,
    is_stream: null,
    is_aborted: false,
    is_timeout: false,
    error_summary: String(errorSummary || '').slice(0, 1200) || '模型后端返回原文保存失败。',
    tool_calls: null,
    tool_results: null,
    request: null,
  };
  return writeMessageModelMetadata(db, conversationId, messageId, {
    status: 'save_failed',
    sanitized: true,
    metadata,
    raw_metadata_sanitized: null,
  });
}
