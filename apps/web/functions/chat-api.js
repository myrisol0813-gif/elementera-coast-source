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
import { assembleSourceChatContext } from './source-context-assembler.js';

const ROOT = '/api/chat';
const CONVERSATIONS = '/api/chat/conversations';
const HISTORY = '/api/chat/history';
const PROFILE = '/api/chat/profile';
const TITLE = '/api/chat/title';
const ATTACHMENTS = '/api/chat/attachments';
const METADATA = '/api/chat/message-metadata';
const LANDING = '/api/chat/landing-letter';

export function isChatApiPath(pathname) {
  return pathname === ROOT || pathname === CONVERSATIONS || pathname === HISTORY
    || pathname === PROFILE || pathname === TITLE || pathname === METADATA || pathname === LANDING
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

  const context = conversationId
    ? await assembleSourceChatContext(env, {
      conversationId,
      messages: value.messages,
      settings: value.settings,
      recentEntryIds: value.recent_entry_ids,
      humanThoughtSubmission: value.humanThought,
    })
    : {
      modelMessages: Array.isArray(value.messages) ? value.messages : [],
      selectedMemoryIds: [],
      tools: [],
      deskSlip: { summary:'本轮上下文', comfort:'未使用长期上下文' },
    };

  const resolved = attachmentIds.length ? await resolveChatAttachmentsForModel(env, env.COAST_CHAT_DB, {
    conversationId, turnId:sourceTurnId, attachmentIds, modelId:String(value.model || ''),
  }) : null;
  const attachmentReceipt = attachmentDeskReceipt(resolved);
  const deskSlip = {
    ...(context.deskSlip || {}),
    ...(attachmentReceipt ? { attachments:attachmentReceipt } : {}),
  };
  const input = {
    ...value,
    messages: resolved ? applyChatAttachmentsToMessages(context.modelMessages, resolved) : context.modelMessages,
    tools: context.tools,
  };

  if (value.stream === true) {
    return streamSourceChat(request, env, input, {
      conversationId,
      messageId,
      deskSlip,
      selectedMemoryIds: context.selectedMemoryIds,
      allowSystem: Boolean(conversationId),
    });
  }

  const result = await performFormalChat(env, input, {
    allowSystem:Boolean(conversationId),
    captureMetadata:true,
  });
  if (conversationId && messageId && result.model_metadata) {
    await writeMessageModelMetadata(env.COAST_CHAT_DB, conversationId, messageId, result.model_metadata).catch(() => undefined);
  }
  const { model_metadata: _modelMetadata, ...publicResult } = result;
  return json({
    ...publicResult,
    tool_runs:[],
    memory:{ selected_entry_ids:context.selectedMemoryIds },
    desk_slip:{
      ...deskSlip,
      ...(publicResult.server_tools?.web_search ? { web_search:publicResult.server_tools.web_search } : {}),
    },
  });
}
function activeHistoryMessages(state) {
  const messages = [];
  for (const turn of Array.isArray(state?.turns) ? state.turns : []) {
    const owners = Array.isArray(turn?.owner?.variants) ? turn.owner.variants : [];
    const ownerIndex = Math.min(Math.max(0, Number(turn?.owner?.active || 0)), Math.max(0, owners.length - 1));
    const owner = owners[ownerIndex];
    const partners = turn?.model_partner?.variantsByOwnerVariant?.[String(ownerIndex)] || [];
    const partnerIndex = Math.min(Math.max(0, Number(turn?.model_partner?.activeByOwnerVariant?.[String(ownerIndex)] || 0)), Math.max(0, partners.length - 1));
    const modelPartner = partners[partnerIndex];
    if (owner?.content) messages.push({ role:'user', content:owner.content });
    if (modelPartner?.content) messages.push({ role:'assistant', content:modelPartner.content });
  }
  return messages.slice(-40);
}
async function landingExchange(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const value = await readJson(request);
  const conversationId = String(value.conversation_id || '');
  const letterText = String(value.letter_text || '').trim().slice(0, 12000);
  if (!conversationId || !letterText) return apiError('invalid_request', '请提供聊天窗口与启动说明。', 400);
  const state = await readConversationState(env.COAST_CHAT_DB, conversationId);
  const result = await performFormalChat(env, {
    model:value.model,
    messages:[...activeHistoryMessages(state), { role:'user', content:letterText }],
    settings:value.settings || {},
  }, { allowSystem:false, captureMetadata:true });
  const now = new Date().toISOString();
  const turnId = `turn_${crypto.randomUUID()}`;
  const ownerId = `owner_${crypto.randomUUID()}`;
  const modelPartnerId = `model_partner_${crypto.randomUUID()}`;
  const turns = Array.isArray(state?.turns) ? [...state.turns] : [];
  turns.push({
    id:turnId,
    turn_type:'landing',
    model_id:String(result.model || value.model || ''),
    owner:{ active:0, variants:[{ id:ownerId, content:letterText, created_at:now, input_type:'landing_letter', message_source:'owner_web', display_author:'Owner' }] },
    model_partner:{ activeByOwnerVariant:{0:0}, variantsByOwnerVariant:{0:[{ id:modelPartnerId, content:result.message?.content || '', created_at:now, model_id:String(result.model || ''), usage:result.usage || undefined, finish_reason:result.finish_reason || '', generation_source:'landing' }] } },
  });
  const history = { version:4, updated_at:now, turns:turns.slice(-400) };
  await writeConversationState(env.COAST_CHAT_DB, conversationId, history);
  if (result.model_metadata) await writeMessageModelMetadata(env.COAST_CHAT_DB, conversationId, modelPartnerId, result.model_metadata).catch(() => undefined);
  const conversation = (await listConversations(env.COAST_CHAT_DB)).find((item) => item.id === conversationId) || null;
  return json({
    ok:true,
    conversation,
    history,
    model:result.model || value.model || '',
    model_partner:{ id:modelPartnerId, content:result.message?.content || '', model_id:String(result.model || '') },
    usage:result.usage || null,
    finish_reason:result.finish_reason || null,
    memory:{ selected_entry_ids:[] },
    desk_slip:{ summary:'本轮上下文', comfort:'source-safe landing exchange' },
  });
}
export async function routeChatApi(request, env, session = null) {
  const url = new URL(request.url);
  try {
    requireOwnerSession(session);
    if (!env?.COAST_CHAT_DB?.prepare) return apiError('chat_db_not_configured', 'Chat database is not configured.', 503);
    if (url.pathname === ROOT) return await formalChat(request, env);
    if (url.pathname === METADATA) return await modelMetadataApi(request, env);
    if (url.pathname === LANDING) return await landingExchange(request, env);
    if (url.pathname === ATTACHMENTS || url.pathname.startsWith(`${ATTACHMENTS}/`)) return await routeAttachmentRequest(request, env, url);
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