import { json, methodNotAllowed } from './http.js';
import {
  ChatStoreError,
  getConversation,
  readConversationState,
  sanitizeId,
} from './chat-store.js';
import {
  deleteConversationModelMetadata,
  readMessageModelMetadata,
  writeMessageModelMetadata,
} from './model-metadata-store.js';

function stateHasAssistantMessage(state, messageId) {
  for (const turn of Array.isArray(state?.turns) ? state.turns : []) {
    const branches = turn?.assistant?.variantsByUserVariant;
    if (!branches || typeof branches !== 'object') continue;
    for (const variants of Object.values(branches)) {
      if (!Array.isArray(variants)) continue;
      if (variants.some((variant) => String(variant?.id || '') === messageId)) return true;
    }
  }
  return false;
}

function failedSnapshot(error) {
  return {
    status: 'save_failed',
    sanitized: true,
    metadata: {
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
      finish_reason: null,
      native_finish_reason: null,
      is_stream: null,
      is_aborted: false,
      is_timeout: false,
      error_summary: `模型回复已完成，模型后端返回原文保存失败：${String(error?.name || 'metadata_save_failed').slice(0, 120)}`,
      tool_calls: null,
      tool_results: null,
      request: null,
    },
    raw_metadata_sanitized: null,
  };
}

export async function saveModelEcho(env, conversationId, messageId, snapshot) {
  if (!String(conversationId || '').trim() || !String(messageId || '').trim() || !snapshot) {
    return { ok: false, status: 'not_returned' };
  }
  try {
    await writeMessageModelMetadata(env.COAST_CHAT_DB, conversationId, messageId, snapshot);
    return { ok: true, status: snapshot.status || 'saved' };
  } catch (error) {
    console.warn('[model-metadata:save]', String(error?.name || 'metadata_save_failed'));
    try {
      await writeMessageModelMetadata(env.COAST_CHAT_DB, conversationId, messageId, failedSnapshot(error));
    } catch (fallbackError) {
      console.warn('[model-metadata:save-fallback]', String(fallbackError?.name || 'metadata_save_failed'));
    }
    return { ok: false, status: 'save_failed' };
  }
}

export async function deleteModelEchoesForConversation(env, conversationId) {
  if (!String(conversationId || '').trim()) return;
  try {
    await deleteConversationModelMetadata(env.COAST_CHAT_DB, conversationId);
  } catch (error) {
    console.warn('[model-metadata:delete-conversation]', String(error?.name || 'metadata_delete_failed'));
  }
}

export async function modelMetadataApi(request, env) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const url = new URL(request.url);
  const rawConversationId = String(url.searchParams.get('conversation_id') || '').trim();
  const rawMessageId = String(url.searchParams.get('message_id') || '').trim();
  if (!rawConversationId || !rawMessageId) {
    throw new ChatStoreError('invalid_request', '缺少 conversation_id 或 message_id。', 400);
  }
  const conversationId = sanitizeId(rawConversationId, 'conversation');
  const messageId = sanitizeId(rawMessageId, 'assistant_variant');
  await getConversation(env.COAST_CHAT_DB, conversationId);
  const state = await readConversationState(env.COAST_CHAT_DB, conversationId);
  if (!stateHasAssistantMessage(state, messageId)) {
    throw new ChatStoreError('message_not_found', '这条模型回复不存在于当前聊天窗口。', 404);
  }
  return json(await readMessageModelMetadata(env.COAST_CHAT_DB, conversationId, messageId, {
    includeRaw: url.searchParams.get('include_raw') === '1',
  }));
}
