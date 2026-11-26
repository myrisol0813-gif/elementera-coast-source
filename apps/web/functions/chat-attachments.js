import { fetchModelCatalog } from './models/model-catalog.js';
import { ModelRequestError } from './models/model-validation.js';
import { discoverImageModels, generateIndependentImage, prepareGeneratedImageReadback } from './independent-image.js';
import { ensureChatSchema, getConversation, normalizeState, readConversationState, readProfile, sanitizeId } from './chat-store.js';

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
      `附件超过当前 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB 上传上限。`,
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
  visionSupportedOverride = null,
} = {}) {
  await ensureChatAttachmentSchema(db);
  const ids = normalizeAttachmentIds(attachmentIds);
  const visionSupported = ids.length
    ? (typeof visionSupportedOverride === 'boolean' ? visionSupportedOverride : await modelSupportsVision(env, modelId))
    : false;
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

/** A preflight rejection is not a delivery. Keep the original uploads intact. */
export function attachmentReceiptOnFailure(receipt, error) {
  if (!receipt || error?.type !== 'context_window_estimate_exceeded' || error?.details?.continuation !== false) return receipt;
  return {
    ...receipt,
    delivered_to_model: 0,
    delivered: [],
    not_delivered: [...(receipt.not_delivered || []), ...(receipt.delivered || []).map(item => ({
      ...item, reason: '预计超出模型目录容量，未发送',
    }))],
    vision: { ...receipt.vision, images_delivered: 0 },
  };
}

/** Store a generated original in the existing chunk store, linked to the
 * trusted current turn, and return its exact future assistant-variant reference.
 * This is not a public upload endpoint. Caller must reserve/commit the
 * assistant variant and handle cancellation/failure before exposing the tool. */
export async function saveGeneratedImageOriginal(db,{conversationId,turnId,messageId,generated,visionSupported=null,reservedUserId=null}={}){
  const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
  if(![conversationId,turnId,messageId].every(valid))throw new ChatAttachmentError('generated_source_invalid','生成图像缺少确定的回复版本。');
  const conv=await getConversation(db,conversationId);
  if(!['main','radio'].includes(conv.room_type))throw new ChatAttachmentError('generated_surface_invalid','该窗口不允许保存生成图像。',403);
  const state=await readConversationState(db,conversationId);
  const turn=state.turns.find(t=>t.id===turnId);
  if(!turn||!turn.user.variants.length||state.turns.some(t=>t.user.variants.some(v=>v.id===messageId)|| (t.id!==turnId&&Object.values(t.assistant.variantsByUserVariant).flat().some(v=>v.id===messageId))))throw new ChatAttachmentError('generated_source_invalid','生成图像的轮次或回复版本不匹配。',409);
  const model=/^[a-z0-9][a-z0-9_.-]{0,79}\/[a-z0-9][a-z0-9_.-]{0,119}(?::free)?$/i;
  if(generated?.provider!=='openrouter'||typeof generated.requested_model!=='string'||!model.test(generated.requested_model)||typeof generated.prompt!=='string'||!generated.prompt.trim()||generated.prompt.length>4000)throw new ChatAttachmentError('generated_metadata_invalid','生成图像供应商来源不完整。');
  const id='att_'+crypto.randomUUID();
  prepareGeneratedImageReadback({attachmentId:id,bytes:generated.bytes,mime:generated.mime,visionSupported:false});
  const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[generated.mime];
  const name='generated-'+id+'.'+extension;
  await ensureChatAttachmentSchema(db);
  const stamp=nowMs();
  const statements=[db.prepare('INSERT INTO chat_attachments (id,conversation_id,turn_id,kind,name,mime,size,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,conversationId,turnId,'image',name,generated.mime,generated.bytes.length,new Uint8Array(),stamp,stamp)];
  for(let i=0;i<generated.bytes.length;i+=ATTACHMENT_CHUNK_BYTES)statements.push(db.prepare('INSERT INTO chat_attachment_chunks (attachment_id,chunk_index,data) VALUES (?,?,?)').bind(id,Math.floor(i/ATTACHMENT_CHUNK_BYTES),generated.bytes.slice(i,i+ATTACHMENT_CHUNK_BYTES)));
  const provenance={message_id:messageId,provider:'openrouter',requested_model:generated.requested_model,prompt:generated.prompt};
  if(typeof generated.reported_model==='string'&&model.test(generated.reported_model))provenance.reported_model=generated.reported_model;
  if(typeof generated.cost_usd==='number'&&Number.isFinite(generated.cost_usd)&&generated.cost_usd>=0)provenance.cost_usd=generated.cost_usd;
  const attachment={...metadata({id,kind:'image',name,mime:generated.mime,size:generated.bytes.length,created_at:stamp}),image_generation:provenance};

  if(reservedUserId!==null){
    const snap=await first(db,'SELECT state_json FROM conversation_states WHERE conversation_id=?',[conversationId]);
    const next=normalizeState(JSON.parse(snap?.state_json||'{}'));
    const t=next.turns.find(x=>x.id===turnId);
    const idx=t?.user.variants.findIndex(v=>v.id===reservedUserId)??-1;
    const v=idx<0?null:t.assistant.variantsByUserVariant[String(idx)]?.find(x=>x.id===messageId);
    if(!v||v.finish_reason!=='image_pending'||v.attachments?.length)throw new ChatAttachmentError('image_reservation_lost','原回复版本已不再等待生成图像。',409);
    v.attachments=[attachment];v.content='';v.finish_reason='stop';delete v.errorDetail;
    next.updated_at=iso(stamp);
    const expected=snap.state_json,encoded=JSON.stringify(normalizeState(next));
    // All writes share the same CAS guard, and the batch rolls back on any SQL error.
    const guard='EXISTS (SELECT 1 FROM conversation_states s JOIN conversations c ON c.id=s.conversation_id WHERE s.conversation_id=? AND s.state_json=? AND c.deleted_at IS NULL)';
    const guarded=[db.prepare('INSERT INTO chat_attachments (id,conversation_id,turn_id,kind,name,mime,size,data,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE '+guard).bind(id,conversationId,turnId,'image',name,generated.mime,generated.bytes.length,new Uint8Array(),stamp,stamp,conversationId,expected)];
    for(let i=0;i<generated.bytes.length;i+=ATTACHMENT_CHUNK_BYTES)guarded.push(db.prepare('INSERT INTO chat_attachment_chunks (attachment_id,chunk_index,data) SELECT ?,?,? WHERE '+guard).bind(id,Math.floor(i/ATTACHMENT_CHUNK_BYTES),generated.bytes.slice(i,i+ATTACHMENT_CHUNK_BYTES),conversationId,expected));
    guarded.push(db.prepare('UPDATE conversation_states SET state_json=?,updated_at=? WHERE conversation_id=? AND state_json=? AND EXISTS (SELECT 1 FROM conversations WHERE id=? AND deleted_at IS NULL)').bind(encoded,stamp,conversationId,expected,conversationId));
    guarded.push(db.prepare('UPDATE conversations SET updated_at=? WHERE id=? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM conversation_states WHERE conversation_id=? AND state_json=?)').bind(stamp,conversationId,conversationId,encoded));
    const results=await db.batch(guarded);
    if(results.at(-2)?.meta?.changes!==1)throw new ChatAttachmentError('image_state_changed','聊天在保存时发生变化，未覆盖新记录。',409);
  }else await db.batch(statements);
  const saved=await getChatAttachmentRecord(db,conversationId,id);
  const original=bytes(saved.data);
  if(saved.turn_id!==turnId||original.length!==generated.bytes.length||original.some((v,i)=>v!==generated.bytes[i]))throw new ChatAttachmentError('generated_original_mismatch','图像原件读回校验失败。',500);
  return {attachment,readback:prepareGeneratedImageReadback({attachmentId:id,bytes:original,mime:saved.mime,visionSupported})};
}

/** User-triggered independent image request, disabled unless explicitly
 * configured. Reserve an exact reply before any network call. A repeated
 * message ID never initiates a second provider request. */
export async function runManualImageGeneration(env,input,{generate=generateIndependentImage,discover=discoverImageModels}={}){
  const fail=(type,message,status=400)=>{throw new ChatAttachmentError(type,message,status);};
  const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
  const allowed=['conversation_id','turn_id','user_variant_id','message_id','prompt'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('image_request_invalid','生成图像请求无效。');
  const {conversation_id:cid,turn_id:tid,user_variant_id:uid,message_id:mid,prompt}=input;
  if(![cid,tid,uid,mid].every(id)||typeof prompt!=='string'||!prompt.trim()||prompt.trim().length>4000)fail('image_request_invalid','缺少明确的消息版本或绘图提示。');
  const db=env.COAST_CHAT_DB;
  const profile=await readProfile(db);
  const model=profile.current_image_model.trim(),key=String(env.OPENROUTER_API_KEY||'').trim();
  if(!key||! /^[a-z0-9][a-z0-9_.-]{0,79}\/[a-z0-9][a-z0-9_.-]{0,119}(?::free)?$/i.test(model))fail('image_not_configured','请在模型箱选择生图模型，并配置 OpenRouter API Key。',503);
  const conv=await getConversation(db,cid);
  if(!['main','radio'].includes(conv.room_type))fail('generated_surface_invalid','该窗口不允许生成图像。',403);
  const snapshot=await first(db,'SELECT state_json FROM conversation_states WHERE conversation_id=?',[cid]);
  if(!snapshot?.state_json)fail('generated_source_invalid','找不到原消息。',409);
  const state=normalizeState(JSON.parse(snapshot.state_json));
  const turn=state.turns.find(t=>t.id===tid);
  const index=turn?.user.variants.findIndex(v=>v.id===uid)??-1;
  if(index<0||turn.user.active!==index||turn.user.variants[index].hidden)fail('generated_source_invalid','原消息版本已变化。',409);
  const existing=state.turns.flatMap(t=>[...t.user.variants,...Object.values(t.assistant.variantsByUserVariant).flat()]);
  if(existing.some(v=>v.id===mid)||existing.some(v=>v.finish_reason==='image_pending'))fail('image_already_reserved','已有生成任务或此请求已使用；不会再次生成。',409);
  const branch=turn.assistant.variantsByUserVariant[String(index)]||[];
  if(branch.length>=20)fail('image_branch_full','当前回复版本已满。',409);
  let catalog;
  try{catalog=await discover(fetch,key);}catch{fail('image_catalog_unavailable','无法核验生图模型目录，未发起生成。',502);}
  if(!catalog.some(m=>m.id===model))fail('image_model_unavailable','所选模型不在独立生图 API 目录中，未发起生成。',409);
  if((await readProfile(db)).current_image_model!==model)fail('image_model_changed','生成模型选择已变化，请重新发起。',409);
  const stamp=nowMs();
  branch.push({id:mid,content:'',created_at:iso(stamp),model_id:model,finish_reason:'image_pending',generation_source:'chat'});
  turn.assistant.variantsByUserVariant[String(index)]=branch;
  turn.assistant.activeByUserVariant[String(index)]=branch.length-1;
  state.updated_at=iso(stamp);
  const reserved=await run(db,'UPDATE conversation_states SET state_json=?,updated_at=? WHERE conversation_id=? AND state_json=? AND EXISTS (SELECT 1 FROM conversations WHERE id=? AND deleted_at IS NULL)',[JSON.stringify(normalizeState(state)),stamp,cid,snapshot.state_json,cid]);
  if(reserved.meta?.changes!==1)fail('image_state_changed','聊天已变化，未发起生成。',409);
  try{
    const generated=await generate({key,model,allowPaid:true},{prompt:prompt.trim()});
    const result=await saveGeneratedImageOriginal(db,{conversationId:cid,turnId:tid,messageId:mid,generated,visionSupported:null,reservedUserId:uid});
    return {ok:true,attachment:result.attachment,readback:result.readback.receipt,history:{...await readConversationState(db,cid),conversation_id:cid}};
  }catch(error){
    // Never retry a provider request. Preserve a committed picture, and only
    // mark the still-pending exact branch failed if it remains present.
    for(let attempt=0;attempt<3;attempt++){
      const row=await first(db,'SELECT state_json FROM conversation_states WHERE conversation_id=?',[cid]);
      if(!row)break;
      const next=normalizeState(JSON.parse(row.state_json));
      const t=next.turns.find(x=>x.id===tid);
      const i=t?.user.variants.findIndex(v=>v.id===uid)??-1;
      const v=i<0?null:t.assistant.variantsByUserVariant[String(i)]?.find(x=>x.id===mid);
      if(!v||v.finish_reason!=='image_pending')break;
      v.finish_reason='image_failed';v.errorDetail='图像生成或保存未完成；不自动重试，供应商可能已计费。';
      const ts=nowMs();next.updated_at=iso(ts);
      const changed=await run(db,'UPDATE conversation_states SET state_json=?,updated_at=? WHERE conversation_id=? AND state_json=? AND EXISTS (SELECT 1 FROM conversations WHERE id=? AND deleted_at IS NULL)',[JSON.stringify(normalizeState(next)),ts,cid,row.state_json,cid]);
      if(changed.meta?.changes===1)break;
    }
    if(error instanceof ChatAttachmentError)throw error;
    fail('image_generation_failed','图像生成或保存未完成；不自动重试，供应商可能已计费。',502);
  }
}
