import { apiError, isRequestBodyError, json, methodNotAllowed, readJson, requestBodyError, unexpectedApiError } from './http.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import { ModelRequestError, performFormalChat } from './models.js';
import {
  ChatStoreError, createConversation, deleteConversation, listConversations,
  readConversationState, readOwnerProfile, setGeneratedTitle, updateConversation,
  writeConversationState, writeOwnerProfile,
} from './chat-store.js';
import {
  ChatAttachmentError, applyChatAttachmentsToMessages, attachmentDeskReceipt,
  deleteChatAttachment, getChatAttachmentRecord, resolveChatAttachmentsForModel, uploadChatAttachment,
} from './chat-attachments.js';
import { modelMetadataApi } from './model-metadata-api.js';
import { writeMessageModelMetadata } from './model-metadata-store.js';
import { streamSourceChat } from './source-chat-stream.js';

const ROOT = '/api/chat';
const CONVERSATIONS = '/api/chat/conversations';
const HISTORY = '/api/chat/history';
const PROFILE = '/api/chat/profile';
const TITLE = '/api/chat/title';
const ATTACHMENTS = '/api/chat/attachments';
const METADATA = '/api/chat/message-metadata';

export function isChatApiPath(pathname) {
  return pathname === ROOT || pathname === CONVERSATIONS || pathname === HISTORY
    || pathname === PROFILE || pathname === TITLE || pathname === METADATA
    || pathname === ATTACHMENTS || pathname.startsWith(`${ATTACHMENTS}/`)
    || pathname.startsWith(`${CONVERSATIONS}/`);
}
function titleFrom(value = {}) {
  const raw = String(value.owner || '').replace(/\s+/g, ' ').trim();
  return raw.slice(0, 30) || '新聊天';
}
async function routeAttachmentRequest(request, env, url) {
  if (url.pathname === ATTACHMENTS) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const form = await request.formData();
    const conversationId = String(form.get('conversation_id') || '');
    const file = form.get('file');
    return json({ ok:true, attachment:await uploadChatAttachment(env.COAST_CHAT_DB, conversationId, file) }, 201);
  }
  const attachmentId = decodeURIComponent(url.pathname.slice(ATTACHMENTS.length + 1));
  const conversationId = url.searchParams.get('conversation_id') || '';
  if (request.method === 'GET') {
    const record = await getChatAttachmentRecord(env.COAST_CHAT_DB, conversationId, attachmentId);
    const safeName = String(record.name || 'attachment').replace(/["\\\r\n]/g, '_');
    return new Response(record.data, { headers:{ 'Content-Type':record.mime, 'Content-Disposition':`inline; filename="${safeName}"`, 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff' } });
  }
  if (request.method === 'DELETE') return json({ ok:true, ...(await deleteChatAttachment(env.COAST_CHAT_DB, conversationId, attachmentId)) });
  return methodNotAllowed('GET, DELETE');
}
async function formalChat(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const value = await readJson(request);
  const conversationId = String(value.conversation_id || '');
  const messageId = String(value.message_id || '');
  const sourceTurnId = String(value.source_turn_id || '');
  const attachmentIds = (Array.isArray(value.attachment_ids) ? value.attachment_ids : []).slice(0, 12);
  const resolved = attachmentIds.length ? await resolveChatAttachmentsForModel(env, env.COAST_CHAT_DB, {
    conversationId, turnId:sourceTurnId, attachmentIds, modelId:String(value.model || ''),
  }) : null;
  const attachmentReceipt = attachmentDeskReceipt(resolved);
  const input = { ...value, messages:resolved ? applyChatAttachmentsToMessages(value.messages, resolved) : value.messages };
  if (value.stream === true) return streamSourceChat(request, env, input, { conversationId, messageId, attachmentReceipt });
  const result = await performFormalChat(env, input, { allowSystem:false, captureMetadata:true });
  if (conversationId && messageId && result.model_metadata) {
    await writeMessageModelMetadata(env.COAST_CHAT_DB, conversationId, messageId, result.model_metadata).catch(() => undefined);
  }
  const { model_metadata: _modelMetadata, ...publicResult } = result;
  return json({
    ...publicResult,
    tool_runs:[],
    memory:{ selected_entry_ids:[] },
    ...(attachmentReceipt ? { desk_slip:{ summary:'本轮上下文', comfort:'source-safe', attachments:attachmentReceipt } } : {}),
  });
}
export async function routeChatApi(request, env, session = null) {
  const url = new URL(request.url);
  try {
    requireOwnerSession(session);
    if (!env?.COAST_CHAT_DB?.prepare) return apiError('chat_db_not_configured', 'Chat database is not configured.', 503);
    if (url.pathname === ROOT) return formalChat(request, env);
    if (url.pathname === METADATA) return modelMetadataApi(request, env);
    if (url.pathname === ATTACHMENTS || url.pathname.startsWith(`${ATTACHMENTS}/`)) return routeAttachmentRequest(request, env, url);
    if (url.pathname === PROFILE) {
      if (request.method === 'GET') return json({ ok:true, profile:await readOwnerProfile(env.COAST_CHAT_DB) });
      if (request.method === 'PUT') { const value = await readJson(request); return json({ ok:true, profile:await writeOwnerProfile(env.COAST_CHAT_DB, value.profile || {}) }); }
      return methodNotAllowed('GET, PUT');
    }
    if (url.pathname === CONVERSATIONS) {
      if (request.method === 'GET') return json({ ok:true, conversations:await listConversations(env.COAST_CHAT_DB) });
      if (request.method === 'POST') return json({ ok:true, conversation:await createConversation(env.COAST_CHAT_DB, await readJson(request)) }, 201);
      return methodNotAllowed('GET, POST');
    }
    if (url.pathname.startsWith(`${CONVERSATIONS}/`)) {
      const id = decodeURIComponent(url.pathname.slice(CONVERSATIONS.length + 1));
      if (request.method === 'PATCH') return json({ ok:true, conversation:await updateConversation(env.COAST_CHAT_DB, id, await readJson(request)) });
      if (request.method === 'DELETE') return json({ ok:true, conversation:await deleteConversation(env.COAST_CHAT_DB, id) });
      return methodNotAllowed('PATCH, DELETE');
    }
    if (url.pathname === HISTORY) {
      const id = url.searchParams.get('conversation_id') || '';
      if (request.method === 'GET') return json({ ok:true, history:await readConversationState(env.COAST_CHAT_DB, id) });
      if (request.method === 'PUT') return json({ ok:true, history:await writeConversationState(env.COAST_CHAT_DB, id, await readJson(request)) });
      return methodNotAllowed('GET, PUT');
    }
    if (url.pathname === TITLE) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      const value = await readJson(request);
      return json({ ok:true, conversation:await setGeneratedTitle(env.COAST_CHAT_DB, value.conversation_id, titleFrom(value)) });
    }
    return apiError('not_found', 'Not found.', 404);
  } catch (error) {
    if (error instanceof ChatStoreError || error instanceof OwnerAccessError || error instanceof ModelRequestError || error instanceof ChatAttachmentError) return apiError(error.type, error.message, error.status, error.details || {});
    if (isRequestBodyError(error)) { const mapped = requestBodyError(error); return apiError(mapped.type, mapped.message, mapped.status); }
    return unexpectedApiError('chat-api', error, 'chat_failed', '聊天操作失败。');
  }
}