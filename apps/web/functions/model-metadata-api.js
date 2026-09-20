import { apiError, json, methodNotAllowed } from './http.js';
import { readConversationState, sanitizeId } from './chat-store.js';
import { readMessageModelMetadata } from './model-metadata-store.js';

function stateHasModelPartnerMessage(state, messageId) {
  for (const turn of Array.isArray(state?.turns) ? state.turns : []) {
    const branches = turn?.model_partner?.variantsByOwnerVariant;
    if (!branches || typeof branches !== 'object') continue;
    for (const variants of Object.values(branches)) {
      if (Array.isArray(variants) && variants.some((variant) => String(variant?.id || '') === messageId)) return true;
    }
  }
  return false;
}
export async function modelMetadataApi(request, env) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const url = new URL(request.url);
  const conversationId = sanitizeId(url.searchParams.get('conversation_id') || '', 'conversation');
  const messageId = sanitizeId(url.searchParams.get('message_id') || '', 'model_partner');
  const history = await readConversationState(env.COAST_CHAT_DB, conversationId);
  if (!stateHasModelPartnerMessage(history, messageId)) return apiError('model_metadata_not_found', '找不到对应的模型消息。', 404);
  const snapshot = await readMessageModelMetadata(env.COAST_CHAT_DB, conversationId, messageId);
  return json({ ok:true, status:snapshot.status || 'not_returned', sanitized:snapshot.sanitized !== false, metadata:snapshot.metadata || null, ...(url.searchParams.get('include_raw') === '1' ? { raw_metadata_sanitized:snapshot.raw_metadata_sanitized ?? null } : {}) });
}