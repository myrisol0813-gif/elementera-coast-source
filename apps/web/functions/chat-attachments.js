import { fetchModelCatalog } from './models/model-catalog.js';
import { ModelRequestError } from './models/model-validation.js';
import { ensureChatSchema, getConversation, sanitizeId } from './chat-store.js';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_BYTES = 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TURN = 12;
const ATTACHMENT_CHUNK_BYTES = 1500000;
const ATTACHMENT_MIGRATION_ID = 'chat-attachments-v1';
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'css', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'ini', 'py', 'rb', 'go', 'rs',
  'java', 'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash',
  'zsh', 'fish', 'sql', 'graphql', 'gql', 'vue', 'svelte', 'log',
]);

export class ChatAttachmentError extends Error {
  constructor(type, message, status = 400, details = {}) {
    super(message);
    this.name = 'ChatAttachmentError';
    this.type = type;
    this.status = status;
    this.details = details;
  }
}

function normalizeAttachmentIds(ids = []) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map((id) => sanitizeId(id, 'attachment')).filter(Boolean))];
  if (clean.length > MAX_ATTACHMENTS_PER_TURN) {
    throw new ChatAttachmentError('too_many_attachments', `每轮最多 ${MAX_ATTACHMENTS_PER_TURN} 个附件。`, 400, {
      max_attachments: MAX_ATTACHMENTS_PER_TURN,
      attempted_attachments: clean.length,
    });
  }
  return clean;
}

function nowMs() {
  return Date.now();
}

function iso(value) {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
}

function cleanName(value) {
  const cleaned = String(value || '附件')
    .replace(/[\\/\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned || '附件';
}

function cleanMime(value, name = '') {
  const mime = String(value || '').toLowerCase().trim().slice(0, 120);
  if (mime && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)) return mime;
  const extension = String(name || '').split('.').pop()?.toLowerCase() || '';
  if (extension === 'md' || extension === 'markdown') return 'text/markdown';
  if (extension === 'json') return 'application/json';
  if (extension === 'csv') return 'text/csv';
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

function kindForMime(mime) {
  return String(mime || '').startsWith('image/') ? 'image' : 'file';
}

function storageKey(id) {
  return `chat-attachment:${id}`;
}

function metadata(row) {
  return {
    id: String(row.id),
    type: row.kind === 'image' ? 'image' : 'file',
    name: String(row.name || '附件'),
    mime: String(row.mime || 'application/octet-stream'),
    size: Math.max(0, Number(row.size) || 0),
    storage_key: storageKey(row.id),
    created_at: iso(row.created_at),
  };
}

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

export async function ensureChatAttachmentSchema(db) {
  await ensureChatSchema(db);
  await run(db, `CREATE TABLE IF NOT EXISTS chat_attachments (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    turn_id TEXT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS chat_attachment_chunks (
    attachment_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (attachment_id, chunk_index),
    FOREIGN KEY (attachment_id) REFERENCES chat_attachments(id)
  )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_chat_attachments_conversation ON chat_attachments(conversation_id, created_at DESC)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_chat_attachments_turn ON chat_attachments(turn_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_chat_attachment_chunks_attachment ON chat_attachment_chunks(attachment_id, chunk_index)');
  await run(db, 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [ATTACHMENT_MIGRATION_ID, nowMs()]);
}

export async function uploadChatAttachment(db, conversationId, file) {
  const id = sanitizeId(`att_${crypto.randomUUID()}`, 'attachment');
  const targetConversationId = sanitizeId(conversationId || '', 'conversation');
  await getConversation(db, targetConversationId);
  await ensureChatAttachmentSchema(db);

  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new ChatAttachmentError('attachment_missing', '没有收到可上传的附件。', 400);
  }
  const name = cleanName(file.name);
  const mime = cleanMime(file.type, name);
  const size = Math.max(0, Number(file.size) || 0);
  if (!size) throw new ChatAttachmentError('attachment_empty', '附件是空文件。', 400);
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new ChatAttachmentError(
      'file_too_large',
      `附件超过海岸当前 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB 上传上限。`,
      413,
      { max_bytes: MAX_ATTACHMENT_BYTES, attempted_bytes: size },
    );
  }
  const data = await file.arrayBuffer();
  if (data.byteLength !== size) {
    throw new ChatAttachmentError('attachment_read_failed', '附件读取不完整，请重新选择。', 400);
  }
  const timestamp = nowMs();
  await run(db, `INSERT INTO chat_attachments
    (id, conversation_id, turn_id, kind, name, mime, size, data, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`, [
    id,
    targetConversationId,
    kindForMime(mime),
    name,
    mime,
    size,
    new Uint8Array(),
    timestamp,
    timestamp,
  ]);
  const bytesValue = new Uint8Array(data);
  try {
    for (let offset = 0, chunkIndex = 0; offset < bytesValue.length; offset += ATTACHMENT_CHUNK_BYTES, chunkIndex += 1) {
      const chunk = bytesValue.slice(offset, Math.min(bytesValue.length, offset + ATTACHMENT_CHUNK_BYTES));
      await run(db, 'INSERT INTO chat_attachment_chunks (attachment_id, chunk_index, data) VALUES (?, ?, ?)', [
        id,
        chunkIndex,
        chunk,
      ]);
    }
  } catch (error) {
    await run(db, 'DELETE FROM chat_attachment_chunks WHERE attachment_id = ?', [id]).catch(() => undefined);
    await run(db, 'DELETE FROM chat_attachments WHERE id = ?', [id]).catch(() => undefined);
    throw new ChatAttachmentError('attachment_save_failed', '附件保存失败，请重新选择。', 500, {
      cause: String(error?.message || 'd1_chunk_write_failed').slice(0, 160),
    });
  }
  return metadata({
    id,
    kind: kindForMime(mime),
    name,
    mime,
    size,
    created_at: timestamp,
  });
}

export async function listChatAttachmentMetadata(db, conversationId, ids = []) {
  await ensureChatAttachmentSchema(db);
  const targetConversationId = sanitizeId(conversationId || '', 'conversation');
  const cleanIds = normalizeAttachmentIds(ids);
  const rows = [];
  for (const id of cleanIds) {
    const row = await first(db, `SELECT id, conversation_id, turn_id, kind, name, mime, size, created_at
      FROM chat_attachments WHERE id = ? AND conversation_id = ?`, [id, targetConversationId]);
    if (row) rows.push(row);
  }
  return rows.map(metadata);
}

export async function getChatAttachmentRecord(db, conversationId, attachmentId) {
  await ensureChatAttachmentSchema(db);
  const targetConversationId = sanitizeId(conversationId || '', 'conversation');
  const id = sanitizeId(attachmentId || '', 'attachment');
  const row = await first(db, `SELECT id, conversation_id, turn_id, kind, name, mime, size, data, created_at
    FROM chat_attachments WHERE id = ? AND conversation_id = ?`, [id, targetConversationId]);
  if (!row) throw new ChatAttachmentError('attachment_not_found', '找不到这个附件。', 404);

  const chunks = await all(db, `SELECT chunk_index, data FROM chat_attachment_chunks
    WHERE attachment_id = ? ORDER BY chunk_index ASC`, [id]);
  if (!chunks.length) return row;

  const expected = Math.max(0, Number(row.size) || 0);
  const output = new Uint8Array(expected);
  let offset = 0;
  for (const chunk of chunks) {
    const part = bytes(chunk.data);
    if (!part.length || offset + part.length > output.length) {
      throw new ChatAttachmentError('attachment_read_failed', '附件分块内容损坏，无法读取。', 500);
    }
    output.set(part, offset);
    offset += part.length;
  }
  if (offset !== expected) {
    throw new ChatAttachmentError('attachment_read_failed', '附件分块内容不完整，无法读取。', 500, {
      expected_bytes: expected,
      actual_bytes: offset,
    });
  }
  return { ...row, data: output.buffer };
}

export async function bindChatAttachmentsToTurn(db, conversationId, turnId, ids = []) {
  await ensureChatAttachmentSchema(db);
  const targetConversationId = sanitizeId(conversationId || '', 'conversation');
  const targetTurnId = sanitizeId(turnId || '', 'turn');
  const cleanIds = normalizeAttachmentIds(ids);
  for (const id of cleanIds) {
    await run(db, `UPDATE chat_attachments SET turn_id = ?, updated_at = ?
      WHERE id = ? AND conversation_id = ?`, [targetTurnId, nowMs(), id, targetConversationId]);
  }
}

export async function deleteChatAttachment(db, conversationId, attachmentId) {
  await ensureChatAttachmentSchema(db);
  const targetConversationId = sanitizeId(conversationId || '', 'conversation');
  const id = sanitizeId(attachmentId || '', 'attachment');
  const existing = await first(db, 'SELECT id, turn_id FROM chat_attachments WHERE id = ? AND conversation_id = ?', [id, targetConversationId]);
  if (!existing) return { deleted: false };
  if (existing.turn_id) {
    throw new ChatAttachmentError('attachment_already_sent', '已经随消息发送的附件不能从待发送区删除。', 409);
  }
  await run(db, 'DELETE FROM chat_attachment_chunks WHERE attachment_id = ?', [id]);
  await run(db, 'DELETE FROM chat_attachments WHERE id = ? AND conversation_id = ?', [id, targetConversationId]);
  return { deleted: true };
}

function extension(name) {
  const value = String(name || '');
  const index = value.lastIndexOf('.');
  return index >= 0 ? value.slice(index + 1).toLowerCase() : '';
}

function textLike(row) {
  return String(row.mime || '').startsWith('text/')
    || ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(String(row.mime || ''))
    || TEXT_EXTENSIONS.has(extension(row.name));
}

function catalogModel(catalog, modelId) {
  return [
    ...(catalog?.groups?.openai_chat || []),
    ...(catalog?.groups?.free_test || []),
  ].find((model) => model.id === modelId) || null;
}

function inputModalities(model) {
  const raw = model?.architecture?.input_modalities;
  if (Array.isArray(raw)) return raw.map((item) => String(item).toLowerCase());
  if (typeof raw === 'string') return [raw.toLowerCase()];
  return [];
}

async function modelSupportsVision(env, modelId) {
  const catalog = await fetchModelCatalog(env);
  const model = catalogModel(catalog, modelId);
  return Boolean(model && inputModalities(model).includes('image'));
}

function bytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return new Uint8Array();
}

function base64(value) {
  const data = bytes(value);
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, Math.min(data.length, offset + chunk)));
  }
  return btoa(binary);
}

function decodeUtf8(value) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes(value));
  } catch {
    throw new ChatAttachmentError('file_parse_failed', '文件不是可读取的 UTF-8 文本。', 415);
  }
}

function attachmentStatusNote(item) {
  return `【附件状态】${item.name} 未递给模型：${item.reason}`;
}

export async function resolveChatAttachmentsForModel(env, db, {
  conversationId,
  turnId = null,
  attachmentIds = [],
  modelId = '',
} = {}) {
  await ensureChatAttachmentSchema(db);
  const ids = normalizeAttachmentIds(attachmentIds);
  const visionSupported = ids.length ? await modelSupportsVision(env, modelId) : false;
  const delivered = [];
  const notDelivered = [];
  const imageParts = [];
  const textBlocks = [];
  const attachmentMetadata = [];

  for (const id of ids) {
    let row;
    try {
      row = await getChatAttachmentRecord(db, conversationId, id);
    } catch (error) {
      if (error instanceof ChatAttachmentError && error.type === 'attachment_not_found') {
        notDelivered.push({ id, name: id, reason: 'attachment_not_found' });
        continue;
      }
      throw error;
    }
    const meta = metadata(row);
    attachmentMetadata.push(meta);

    if (row.kind === 'image') {
      if (!IMAGE_MIMES.has(row.mime)) {
        notDelivered.push({ id: row.id, name: row.name, reason: 'image_mime_unsupported' });
        continue;
      }
      if (!visionSupported) {
        notDelivered.push({ id: row.id, name: row.name, reason: 'model_no_vision' });
        continue;
      }
      imageParts.push({
        type: 'image_url',
        image_url: { url: `data:${row.mime};base64,${base64(row.data)}` },
      });
      delivered.push({ id: row.id, name: row.name, type: 'image', mode: 'vision' });
      continue;
    }

    if (!textLike(row)) {
      notDelivered.push({ id: row.id, name: row.name, reason: 'file_type_unsupported' });
      continue;
    }
    if (Number(row.size) > MAX_TEXT_ATTACHMENT_BYTES) {
      notDelivered.push({ id: row.id, name: row.name, reason: 'file_too_large_for_model' });
      continue;
    }
    try {
      const text = decodeUtf8(row.data);
      textBlocks.push(`【文件：${row.name}】\n${text}`);
      delivered.push({ id: row.id, name: row.name, type: 'file', mode: 'text' });
    } catch (error) {
      notDelivered.push({ id: row.id, name: row.name, reason: error?.type || 'file_parse_failed' });
    }
  }

  if (turnId && ids.length) await bindChatAttachmentsToTurn(db, conversationId, turnId, ids);

  return {
    attachments: attachmentMetadata,
    delivered,
    not_delivered: notDelivered,
    vision: {
      supported: visionSupported,
      images_delivered: delivered.filter((item) => item.mode === 'vision').length,
    },
    text_blocks: textBlocks,
    image_parts: imageParts,
  };
}

export function applyChatAttachmentsToMessages(messages, resolved) {
  const source = Array.isArray(messages) ? messages.map((message) => ({ ...message })) : [];
  if (!resolved || (!resolved.text_blocks?.length && !resolved.image_parts?.length && !resolved.not_delivered?.length)) return source;
  let index = source.length - 1;
  while (index >= 0 && source[index]?.role !== 'user') index -= 1;
  if (index < 0) throw new ModelRequestError('invalid_messages', '附件没有对应的用户消息。', 400);

  const original = typeof source[index].content === 'string' ? source[index].content : '';
  const notes = (resolved.not_delivered || []).map(attachmentStatusNote);
  const text = [original, ...(resolved.text_blocks || []), ...notes].filter((item) => String(item || '').trim()).join('\n\n');
  if (resolved.image_parts?.length) {
    source[index].content = [
      { type: 'text', text: text || '请查看本轮图片附件。' },
      ...resolved.image_parts,
    ];
  } else {
    source[index].content = text || original;
  }
  return source;
}

export function attachmentDeskReceipt(resolved) {
  if (!resolved) return null;
  return {
    uploaded: resolved.attachments?.length || 0,
    delivered_to_model: resolved.delivered?.length || 0,
    delivered: resolved.delivered || [],
    not_delivered: resolved.not_delivered || [],
    vision: resolved.vision || { supported: false, images_delivered: 0 },
  };
}
