import { apiError, isRequestBodyError, json, methodNotAllowed, readJson, requestBodyError, unexpectedApiError } from './http.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import {
  ChatStoreError, createConversation, deleteConversation, listConversations,
  readConversationState, readOwnerProfile, setGeneratedTitle, updateConversation,
  writeConversationState, writeOwnerProfile,
} from './chat-store.js';

const ROOT = '/api/chat';
const CONVERSATIONS = '/api/chat/conversations';
const HISTORY = '/api/chat/history';
const PROFILE = '/api/chat/profile';
const TITLE = '/api/chat/title';

export function isChatApiPath(pathname) {
  return pathname === ROOT || pathname === CONVERSATIONS || pathname === HISTORY
    || pathname === PROFILE || pathname === TITLE || pathname.startsWith(`${CONVERSATIONS}/`);
}
function titleFrom(value = {}) {
  const raw = String(value.owner || value.user || '').replace(/\s+/g, ' ').trim();
  return raw.slice(0, 30) || '新聊天';
}
export async function routeChatApi(request, env, session = null) {
  const url = new URL(request.url);
  try {
    requireOwnerSession(session);
    if (!env?.COAST_CHAT_DB?.prepare) return apiError('chat_db_not_configured', 'Chat database is not configured.', 503);

    if (url.pathname === ROOT) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      return apiError('model_provider_not_configured', 'Source preview has no model provider configured yet.', 503);
    }
    if (url.pathname === PROFILE) {
      if (request.method === 'GET') return json({ ok: true, profile: await readOwnerProfile(env.COAST_CHAT_DB) });
      if (request.method === 'PUT') {
        const value = await readJson(request);
        return json({ ok: true, profile: await writeOwnerProfile(env.COAST_CHAT_DB, value.profile || {}) });
      }
      return methodNotAllowed('GET, PUT');
    }
    if (url.pathname === CONVERSATIONS) {
      if (request.method === 'GET') return json({ ok: true, conversations: await listConversations(env.COAST_CHAT_DB) });
      if (request.method === 'POST') return json({ ok: true, conversation: await createConversation(env.COAST_CHAT_DB, await readJson(request)) }, 201);
      return methodNotAllowed('GET, POST');
    }
    if (url.pathname.startsWith(`${CONVERSATIONS}/`)) {
      const id = decodeURIComponent(url.pathname.slice(CONVERSATIONS.length + 1));
      if (request.method === 'PATCH') return json({ ok: true, conversation: await updateConversation(env.COAST_CHAT_DB, id, await readJson(request)) });
      if (request.method === 'DELETE') return json({ ok: true, conversation: await deleteConversation(env.COAST_CHAT_DB, id) });
      return methodNotAllowed('PATCH, DELETE');
    }
    if (url.pathname === HISTORY) {
      const id = url.searchParams.get('conversation_id') || '';
      if (request.method === 'GET') return json({ ok: true, history: await readConversationState(env.COAST_CHAT_DB, id) });
      if (request.method === 'PUT') return json({ ok: true, history: await writeConversationState(env.COAST_CHAT_DB, id, await readJson(request)) });
      return methodNotAllowed('GET, PUT');
    }
    if (url.pathname === TITLE) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      const value = await readJson(request);
      const conversation = await setGeneratedTitle(env.COAST_CHAT_DB, value.conversation_id, titleFrom(value));
      return json({ ok: true, conversation });
    }
    return apiError('not_found', 'Not found.', 404);
  } catch (error) {
    if (error instanceof ChatStoreError || error instanceof OwnerAccessError) return apiError(error.type, error.message, error.status);
    if (isRequestBodyError(error)) {
      const mapped = requestBodyError(error);
      return apiError(mapped.type, mapped.message, mapped.status);
    }
    return unexpectedApiError('chat-api', error, 'chat_failed', '聊天操作失败。');
  }
}
