import {
  ChatStoreError,
  createConversation,
  ensureChatSchema,
  sanitizeId,
  sanitizeTitle,
  writeConversationState,
} from './chat-store.js';

const USER_ID = 'owner';
const IMPORT_SOURCE = 'rikkahub';
const MAX_MESSAGES = 1200;
const MAX_MESSAGE_CONTENT = 12000;
const MAX_ATTACHMENTS = 40;
const MAX_ATTACHMENT_BASE64 = 16 * 1024 * 1024;
const CHUNK_CHARS = 512 * 1024;
const schemaPromises = new WeakMap();

async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}

function clip(value, max) {
  return String(value ?? '').slice(0, max);
}

function safeTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Date().toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function prefixedTitle(value, fallback = '未命名窗口') {
  const clean = String(value || '').replace(/^【Rikka】\s*/, '').trim() || fallback;
  return sanitizeTitle(`【Rikka】${clean}`, '【Rikka】未命名窗口');
}

function normalizeAttachmentRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.id) return null;
  return {
    id: sanitizeId(value.id, 'rikka_attachment'),
    name: clip(value.name || value.filename || '附件', 180),
    mime_type: clip(value.mime_type || value.mimeType || 'application/octet-stream', 120),
  };
}

function normalizeMessage(value, position) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const role = value.role === 'assistant' ? 'assistant' : value.role === 'user' ? 'user' : '';
  if (!role) return null;
  const attachments = (Array.isArray(value.attachments) ? value.attachments : [])
    .map(normalizeAttachmentRef)
    .filter(Boolean)
    .slice(0, 12);
  const content = clip(value.content, MAX_MESSAGE_CONTENT);
  if (!content.trim() && !attachments.length) return null;
  const modelId = clip(value.model_id || value.modelId || '', 180).trim();
  return {
    id: sanitizeId(value.id || `rikka_message_${position}`, 'rikka_message'),
    role,
    content,
    created_at: safeTimestamp(value.created_at || value.createdAt),
    ...(modelId ? { model_id: modelId } : {}),
    ...(attachments.length ? { attachments } : {}),
  };
}

function normalizeAttachment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.id) return null;
  const dataBase64 = String(value.data_base64 || value.dataBase64 || '').replace(/\s+/g, '');
  if (!dataBase64 || dataBase64.length > MAX_ATTACHMENT_BASE64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) {
    throw new ChatStoreError('invalid_rikkahub_attachment', 'RikkaHub 附件数据无效或过大。', 400);
  }
  return {
    id: sanitizeId(value.id, 'rikka_attachment'),
    name: clip(value.name || value.filename || '附件', 180),
    mime_type: clip(value.mime_type || value.mimeType || 'application/octet-stream', 120),
    byte_length: Math.max(0, Math.trunc(Number(value.byte_length || value.byteLength) || Math.floor(dataBase64.length * 3 / 4))),
    sha256: clip(value.sha256 || '', 80),
    data_base64: dataBase64,
  };
}

async function createSchema(db) {
  await ensureChatSchema(db);
  await run(db, `CREATE TABLE IF NOT EXISTS rikkahub_import_attachments (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_length INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT,
    created_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS rikkahub_import_attachment_chunks (
    attachment_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    data_base64 TEXT NOT NULL,
    PRIMARY KEY (attachment_id, chunk_index)
  )`);
  const columns = await all(db, 'PRAGMA table_info(rikkahub_import_attachments)');
  if (!columns.some((column) => column.name === 'message_id')) {
    await run(db, "ALTER TABLE rikkahub_import_attachments ADD COLUMN message_id TEXT NOT NULL DEFAULT ''");
  }
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_rikkahub_attachments_conversation ON rikkahub_import_attachments(conversation_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_rikkahub_attachments_message ON rikkahub_import_attachments(conversation_id, message_id)');
}

export async function ensureRikkaHubImportSchema(db) {
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = createSchema(db);
    schemaPromises.set(db, ready);
  }
  try {
    await ready;
  } catch (error) {
    schemaPromises.delete(db);
    throw error;
  }
}

function importedVariant(message) {
  return {
    id: message.id,
    content: message.content,
    created_at: message.created_at,
    message_source: IMPORT_SOURCE,
    display_author: message.role === 'user' ? '屋主' : 'RikkaHub',
    ...(message.model_id ? { model_id: message.model_id } : {}),
  };
}

function messagesToCanonicalState(messages) {
  const turns = [];
  let current = null;
  for (const message of messages) {
    if (message.role === 'user') {
      current = {
        id: sanitizeId(`rikka_turn_${message.id}`, 'rikka_turn'),
        user: { active: 0, variants: [importedVariant(message)] },
        assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: { 0: [] } },
      };
      turns.push(current);
      continue;
    }
    if (!current || current.assistant.variantsByUserVariant['0'].length) {
      current = {
        id: sanitizeId(`rikka_turn_${message.id}`, 'rikka_turn'),
        user: { active: 0, variants: [] },
        assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: { 0: [] } },
      };
      turns.push(current);
    }
    current.assistant.variantsByUserVariant['0'].push(importedVariant(message));
    current.assistant.activeByUserVariant['0'] = current.assistant.variantsByUserVariant['0'].length - 1;
  }
  const updatedAt = messages.length ? messages[messages.length - 1].created_at : new Date().toISOString();
  return { version: 4, updated_at: updatedAt, turns };
}

async function importedConversation(db, sourceWindowId) {
  return first(db, `SELECT id, deleted_at FROM conversations
    WHERE user_id = ? AND source = ? AND source_window_id = ?
    LIMIT 1`, [USER_ID, IMPORT_SOURCE, sourceWindowId]);
}

async function clearAttachments(db, conversationId) {
  await run(db, `DELETE FROM rikkahub_import_attachment_chunks
    WHERE attachment_id IN (
      SELECT id FROM rikkahub_import_attachments WHERE conversation_id = ?
    )`, [conversationId]);
  await run(db, 'DELETE FROM rikkahub_import_attachments WHERE conversation_id = ?', [conversationId]);
}

export async function listRikkaHubAttachments(db, conversationId) {
  await ensureRikkaHubImportSchema(db);
  const id = sanitizeId(conversationId, 'conversation');
  const rows = await all(db, `SELECT a.id, a.message_id, a.filename, a.mime_type, a.byte_length
    FROM rikkahub_import_attachments a
    JOIN conversations c ON c.id = a.conversation_id
    WHERE a.conversation_id = ? AND c.user_id = ? AND c.deleted_at IS NULL AND c.source = ?
    ORDER BY a.created_at ASC, a.id ASC`, [id, USER_ID, IMPORT_SOURCE]);
  return rows.map((row) => ({
    id: row.id,
    message_id: row.message_id,
    name: row.filename || '附件',
    mime_type: row.mime_type || 'application/octet-stream',
    byte_length: Math.max(0, Number(row.byte_length || 0)),
    url: `/api/rikkahub/attachments/${encodeURIComponent(row.id)}`,
  }));
}

export async function importRikkaHubConversation(db, value = {}) {
  await ensureRikkaHubImportSchema(db);
  const rawSourceWindowId = value.source_window_id || value.sourceWindowId || '';
  if (!String(rawSourceWindowId).trim()) {
    throw new ChatStoreError('invalid_rikkahub_import', 'RikkaHub 窗口缺少来源 ID。', 400);
  }
  const sourceWindowId = sanitizeId(rawSourceWindowId, 'rikka_window');
  const messages = (Array.isArray(value.messages) ? value.messages : [])
    .slice(0, MAX_MESSAGES)
    .map(normalizeMessage)
    .filter(Boolean);
  if (!messages.length) {
    throw new ChatStoreError('empty_rikkahub_import', '这个 RikkaHub 窗口没有可导入的用户/助手正文。', 400);
  }

  const referenced = new Map();
  for (const message of messages) {
    for (const attachment of message.attachments || []) {
      if (!referenced.has(attachment.id)) referenced.set(attachment.id, message.id);
    }
  }
  const attachments = (Array.isArray(value.attachments) ? value.attachments : [])
    .slice(0, MAX_ATTACHMENTS)
    .map(normalizeAttachment)
    .filter((attachment) => attachment && referenced.has(attachment.id));
  const availableIds = new Set(attachments.map((attachment) => attachment.id));
  const safeMessages = messages.map((message) => ({
    ...message,
    ...(message.attachments?.length
      ? { attachments: message.attachments.filter((attachment) => availableIds.has(attachment.id)) }
      : {}),
  })).filter((message) => message.content.trim() || message.attachments?.length);

  let existing = await importedConversation(db, sourceWindowId);
  let conversationId;
  if (existing?.id) {
    conversationId = existing.id;
  } else {
    conversationId = (await createConversation(db, prefixedTitle(value.title), 'main')).id;
  }

  const state = messagesToCanonicalState(safeMessages);
  const firstMessageAt = Date.parse(safeMessages[0]?.created_at || '');
  const lastMessageAt = Date.parse(safeMessages[safeMessages.length - 1]?.created_at || '');
  const createdAt = Number.isFinite(firstMessageAt) ? firstMessageAt : Date.now();
  const updatedAt = Number.isFinite(lastMessageAt) ? lastMessageAt : createdAt;

  await run(db, `UPDATE conversations
    SET title = ?, room_type = 'main', source = ?, source_window_id = ?, deleted_at = NULL,
        title_manual = 0, title_generated_at = NULL, title_model_id = NULL
    WHERE id = ? AND user_id = ?`, [
    prefixedTitle(value.title), IMPORT_SOURCE, sourceWindowId, conversationId, USER_ID,
  ]);
  const written = await writeConversationState(db, conversationId, state);
  await run(db, `UPDATE conversations SET created_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ?`, [createdAt, updatedAt, conversationId, USER_ID]);

  await clearAttachments(db, conversationId);
  const storedAt = Date.now();
  for (const attachment of attachments) {
    await run(db, `INSERT INTO rikkahub_import_attachments (
      id, conversation_id, message_id, filename, mime_type, byte_length, sha256, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
      attachment.id,
      conversationId,
      referenced.get(attachment.id),
      attachment.name,
      attachment.mime_type,
      attachment.byte_length,
      attachment.sha256 || null,
      storedAt,
    ]);
    for (let offset = 0, index = 0; offset < attachment.data_base64.length; offset += CHUNK_CHARS, index += 1) {
      await run(db, `INSERT INTO rikkahub_import_attachment_chunks (attachment_id, chunk_index, data_base64)
        VALUES (?, ?, ?)`, [attachment.id, index, attachment.data_base64.slice(offset, offset + CHUNK_CHARS)]);
    }
  }

  return {
    conversation_id: conversationId,
    source: IMPORT_SOURCE,
    source_window_id: sourceWindowId,
    message_count: safeMessages.length,
    turn_count: written.turns.length,
    attachment_count: attachments.length,
  };
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function readRikkaHubAttachment(db, attachmentId) {
  await ensureRikkaHubImportSchema(db);
  const id = sanitizeId(attachmentId, 'rikka_attachment');
  const attachment = await first(db, `SELECT a.id, a.filename, a.mime_type, a.byte_length
    FROM rikkahub_import_attachments a
    JOIN conversations c ON c.id = a.conversation_id
    WHERE a.id = ? AND c.user_id = ? AND c.deleted_at IS NULL AND c.source = ?`, [id, USER_ID, IMPORT_SOURCE]);
  if (!attachment) throw new ChatStoreError('rikkahub_attachment_not_found', 'RikkaHub 附件不存在。', 404);
  const chunks = await all(db, `SELECT data_base64 FROM rikkahub_import_attachment_chunks
    WHERE attachment_id = ? ORDER BY chunk_index ASC`, [id]);
  if (!chunks.length) throw new ChatStoreError('rikkahub_attachment_missing', 'RikkaHub 附件内容缺失。', 404);
  return {
    filename: attachment.filename,
    mime_type: attachment.mime_type || 'application/octet-stream',
    byte_length: Number(attachment.byte_length || 0),
    bytes: decodeBase64(chunks.map((row) => row.data_base64 || '').join('')),
  };
}
