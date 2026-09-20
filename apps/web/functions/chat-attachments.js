import { fetchModelCatalog } from './models/model-catalog.js';
import { ModelRequestError } from './models/model-validation.js';
import { getConversation, sanitizeId } from './chat-store.js';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_BYTES = 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TURN = 12;
const CHUNK_BYTES = 1500000;
const IMAGE_MIMES = new Set(['image/png','image/jpeg','image/webp']);
const TEXT_EXTENSIONS = new Set(['txt','md','markdown','json','csv','tsv','js','mjs','cjs','ts','tsx','jsx','css','html','htm','xml','yaml','yml','toml','ini','py','rb','go','rs','java','kt','kts','swift','c','h','cpp','hpp','cs','php','sh','bash','zsh','fish','sql','graphql','gql','vue','svelte','log']);
const schemaPromises = new WeakMap();

export class ChatAttachmentError extends Error {
  constructor(type, message, status = 400, details = {}) { super(message); this.name = 'ChatAttachmentError'; this.type = type; this.status = status; this.details = details; }
}
function clean(value, max = 180) { return String(value ?? '').trim().slice(0, max); }
function cleanName(value) { return clean(String(value || '附件').replace(/[\\/\r\n\t]+/g, ' ').replace(/\s+/g, ' '), 180) || '附件'; }
function cleanMime(value, name = '') {
  const mime = String(value || '').toLowerCase().trim().slice(0, 120);
  if (mime && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)) return mime;
  const ext = String(name || '').split('.').pop()?.toLowerCase() || '';
  return ({ md:'text/markdown', markdown:'text/markdown', json:'application/json', csv:'text/csv', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp' })[ext] || 'application/octet-stream';
}
function kindForMime(mime) { return String(mime || '').startsWith('image/') ? 'image' : 'file'; }
function iso(value) { return new Date(Number(value) || Date.now()).toISOString(); }
function storageKey(id) { return `source-chat-attachment:${id}`; }
function metadata(row) { return { id:String(row.id), type:row.kind === 'image' ? 'image' : 'file', name:String(row.name || '附件'), mime:String(row.mime || 'application/octet-stream'), size:Math.max(0, Number(row.size) || 0), storage_key:storageKey(row.id), created_at:iso(row.created_at) }; }
function bytes(value) { if (value instanceof ArrayBuffer) return new Uint8Array(value); if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength); if (Array.isArray(value)) return Uint8Array.from(value); return new Uint8Array(); }
async function run(db, sql, params = []) { return db.prepare(sql).bind(...params).run(); }
async function first(db, sql, params = []) { return db.prepare(sql).bind(...params).first(); }
async function all(db, sql, params = []) { const result = await db.prepare(sql).bind(...params).all(); return result?.results || []; }
function normalizeIds(ids = []) {
  const output = [...new Set((Array.isArray(ids) ? ids : []).map((id) => sanitizeId(id, 'attachment')).filter(Boolean))];
  if (output.length > MAX_ATTACHMENTS_PER_TURN) throw new ChatAttachmentError('too_many_attachments', `每轮最多 ${MAX_ATTACHMENTS_PER_TURN} 个附件。`);
  return output;
}
export async function ensureChatAttachmentSchema(db) {
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = (async () => {
      await run(db, `CREATE TABLE IF NOT EXISTS source_chat_attachments (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, turn_id TEXT DEFAULT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
      await run(db, `CREATE TABLE IF NOT EXISTS source_chat_attachment_chunks (attachment_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (attachment_id, chunk_index))`);
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_source_chat_attachments_conversation ON source_chat_attachments(conversation_id, created_at DESC)');
    })();
    schemaPromises.set(db, ready);
  }
  try { await ready; } catch (error) { schemaPromises.delete(db); throw error; }
}
export async function uploadChatAttachment(db, conversationId, file) {
  const target = sanitizeId(conversationId, 'conversation');
  await getConversation(db, target);
  await ensureChatAttachmentSchema(db);
  if (!file || typeof file.arrayBuffer !== 'function') throw new ChatAttachmentError('attachment_missing', '没有收到可上传的附件。');
  const name = cleanName(file.name);
  const mime = cleanMime(file.type, name);
  const size = Math.max(0, Number(file.size) || 0);
  if (!size) throw new ChatAttachmentError('attachment_empty', '附件是空文件。');
  if (size > MAX_ATTACHMENT_BYTES) throw new ChatAttachmentError('file_too_large', `附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB 上传上限。`, 413, { max_bytes:MAX_ATTACHMENT_BYTES, attempted_bytes:size });
  const data = new Uint8Array(await file.arrayBuffer());
  if (data.byteLength !== size) throw new ChatAttachmentError('attachment_read_failed', '附件读取不完整。');
  const id = sanitizeId(`att_${crypto.randomUUID()}`, 'attachment');
  const now = Date.now();
  const kind = kindForMime(mime);
  await run(db, 'INSERT INTO source_chat_attachments (id,conversation_id,turn_id,kind,name,mime,size,created_at,updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)', [id,target,kind,name,mime,size,now,now]);
  try {
    for (let offset = 0, index = 0; offset < data.length; offset += CHUNK_BYTES, index += 1) {
      await run(db, 'INSERT INTO source_chat_attachment_chunks (attachment_id,chunk_index,data) VALUES (?, ?, ?)', [id,index,data.slice(offset, Math.min(data.length, offset + CHUNK_BYTES))]);
    }
  } catch (error) {
    await run(db, 'DELETE FROM source_chat_attachment_chunks WHERE attachment_id = ?', [id]).catch(() => undefined);
    await run(db, 'DELETE FROM source_chat_attachments WHERE id = ?', [id]).catch(() => undefined);
    throw new ChatAttachmentError('attachment_save_failed', '附件保存失败。', 500);
  }
  return metadata({ id,kind,name,mime,size,created_at:now });
}
export async function getChatAttachmentRecord(db, conversationId, attachmentId) {
  await ensureChatAttachmentSchema(db);
  const target = sanitizeId(conversationId, 'conversation');
  const id = sanitizeId(attachmentId, 'attachment');
  const row = await first(db, 'SELECT * FROM source_chat_attachments WHERE id = ? AND conversation_id = ?', [id,target]);
  if (!row) throw new ChatAttachmentError('attachment_not_found', '找不到这个附件。', 404);
  const chunks = await all(db, 'SELECT data FROM source_chat_attachment_chunks WHERE attachment_id = ? ORDER BY chunk_index ASC', [id]);
  const output = new Uint8Array(Math.max(0, Number(row.size) || 0));
  let offset = 0;
  for (const chunk of chunks) { const part = bytes(chunk.data); if (!part.length || offset + part.length > output.length) throw new ChatAttachmentError('attachment_read_failed', '附件内容损坏。', 500); output.set(part, offset); offset += part.length; }
  if (offset !== output.length) throw new ChatAttachmentError('attachment_read_failed', '附件内容不完整。', 500);
  return { ...row, data:output.buffer };
}
export async function deleteChatAttachment(db, conversationId, attachmentId) {
  const row = await getChatAttachmentRecord(db, conversationId, attachmentId);
  if (row.turn_id) throw new ChatAttachmentError('attachment_already_sent', '已经随消息发送的附件不能从待发送区删除。', 409);
  await run(db, 'DELETE FROM source_chat_attachment_chunks WHERE attachment_id = ?', [row.id]);
  await run(db, 'DELETE FROM source_chat_attachments WHERE id = ?', [row.id]);
  return { deleted:true };
}
export async function bindChatAttachmentsToTurn(db, conversationId, turnId, ids = []) {
  await ensureChatAttachmentSchema(db);
  const target = sanitizeId(conversationId, 'conversation');
  const turn = sanitizeId(turnId, 'turn');
  for (const id of normalizeIds(ids)) await run(db, 'UPDATE source_chat_attachments SET turn_id = ?, updated_at = ? WHERE id = ? AND conversation_id = ?', [turn,Date.now(),id,target]);
}
function extension(name) { const value = String(name || ''); const index = value.lastIndexOf('.'); return index >= 0 ? value.slice(index + 1).toLowerCase() : ''; }
function textLike(row) { return String(row.mime || '').startsWith('text/') || ['application/json','application/xml','application/yaml','application/x-yaml'].includes(String(row.mime || '')) || TEXT_EXTENSIONS.has(extension(row.name)); }
function base64(value) { const data = bytes(value); let binary = ''; for (let offset = 0; offset < data.length; offset += 0x8000) binary += String.fromCharCode(...data.subarray(offset, Math.min(data.length, offset + 0x8000))); return btoa(binary); }
function decodeUtf8(value) { try { return new TextDecoder('utf-8', { fatal:true }).decode(bytes(value)); } catch { throw new ChatAttachmentError('file_parse_failed', '文件不是可读取的 UTF-8 文本。', 415); } }
async function modelSupportsVision(env, modelId) {
  const catalog = await fetchModelCatalog(env);
  const models = [...(catalog?.groups?.openai_chat || []), ...(catalog?.groups?.free_test || [])];
  const model = models.find((item) => item.id === modelId);
  const raw = model?.architecture?.input_modalities;
  const list = Array.isArray(raw) ? raw.map((item) => String(item).toLowerCase()) : typeof raw === 'string' ? [raw.toLowerCase()] : [];
  return list.includes('image');
}
export async function resolveChatAttachmentsForModel(env, db, { conversationId, turnId = null, attachmentIds = [], modelId = '' } = {}) {
  const ids = normalizeIds(attachmentIds);
  const visionSupported = ids.length ? await modelSupportsVision(env, modelId) : false;
  const delivered = [], notDelivered = [], imageParts = [], textBlocks = [], attachmentMetadata = [];
  for (const id of ids) {
    let row;
    try { row = await getChatAttachmentRecord(db, conversationId, id); } catch (error) { if (error instanceof ChatAttachmentError && error.type === 'attachment_not_found') { notDelivered.push({ id,name:id,reason:'attachment_not_found' }); continue; } throw error; }
    attachmentMetadata.push(metadata(row));
    if (row.kind === 'image') {
      if (!IMAGE_MIMES.has(row.mime)) { notDelivered.push({ id:row.id,name:row.name,reason:'image_mime_unsupported' }); continue; }
      if (!visionSupported) { notDelivered.push({ id:row.id,name:row.name,reason:'model_no_vision' }); continue; }
      imageParts.push({ type:'image_url', image_url:{ url:`data:${row.mime};base64,${base64(row.data)}` } });
      delivered.push({ id:row.id,name:row.name,type:'image',mode:'vision' });
      continue;
    }
    if (!textLike(row)) { notDelivered.push({ id:row.id,name:row.name,reason:'file_type_unsupported' }); continue; }
    if (Number(row.size) > MAX_TEXT_ATTACHMENT_BYTES) { notDelivered.push({ id:row.id,name:row.name,reason:'file_too_large_for_model' }); continue; }
    try { textBlocks.push(`【文件：${row.name}】\n${decodeUtf8(row.data)}`); delivered.push({ id:row.id,name:row.name,type:'file',mode:'text' }); } catch (error) { notDelivered.push({ id:row.id,name:row.name,reason:error?.type || 'file_parse_failed' }); }
  }
  if (turnId && ids.length) await bindChatAttachmentsToTurn(db, conversationId, turnId, ids);
  return { attachments:attachmentMetadata, delivered, not_delivered:notDelivered, vision:{ supported:visionSupported, images_delivered:delivered.filter((item) => item.mode === 'vision').length }, text_blocks:textBlocks, image_parts:imageParts };
}
export function applyChatAttachmentsToMessages(messages, resolved) {
  const source = Array.isArray(messages) ? messages.map((message) => ({ ...message })) : [];
  if (!resolved || (!resolved.text_blocks?.length && !resolved.image_parts?.length && !resolved.not_delivered?.length)) return source;
  let index = source.length - 1;
  while (index >= 0 && source[index]?.role !== 'user') index -= 1;
  if (index < 0) throw new ModelRequestError('invalid_messages', '附件没有对应的用户消息。', 400);
  const original = typeof source[index].content === 'string' ? source[index].content : '';
  const notes = (resolved.not_delivered || []).map((item) => `【附件状态】${item.name} 未递给模型：${item.reason}`);
  const text = [original, ...(resolved.text_blocks || []), ...notes].filter((item) => String(item || '').trim()).join('\n\n');
  source[index].content = resolved.image_parts?.length ? [{ type:'text', text:text || '请查看本轮图片附件。' }, ...resolved.image_parts] : (text || original);
  return source;
}
export function attachmentDeskReceipt(resolved) { return resolved ? { uploaded:resolved.attachments?.length || 0, delivered_to_model:resolved.delivered?.length || 0, delivered:resolved.delivered || [], not_delivered:resolved.not_delivered || [], vision:resolved.vision || { supported:false, images_delivered:0 } } : null; }