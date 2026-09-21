import { apiError, json, methodNotAllowed, readJson, requestBodyError, unexpectedApiError } from './http.js';
import { hasChatDatabase } from './chat-store.js';
import { listCrossWindowMessageIndex, listCrossWindowSources, readCrossWindow } from './cross-window-service.js';

const SOURCES_PATH = '/api/chat/cross-window/sources';
const READ_PATH = '/api/chat/cross-window/read';
const MESSAGES_PATH = '/api/chat/cross-window/messages';
const BODY_LIMIT = 128 * 1024;

export function isCrossWindowApiPath(pathname) {
  return pathname === SOURCES_PATH || pathname === READ_PATH || pathname === MESSAGES_PATH;
}

async function body(request) {
  try {
    return await readJson(request, BODY_LIMIT);
  } catch (error) {
    const mapped = requestBodyError(error, {
      invalidType: 'invalid_request',
      invalidMessage: '跨窗口请求体不是有效 JSON。',
      tooLargeMessage: '跨窗口选择过大。',
    });
    throw Object.assign(new Error(mapped.message), { type: mapped.type, status: mapped.status });
  }
}

export async function routeCrossWindowApi(request, env) {
  if (!hasChatDatabase(env)) return apiError('chat_db_not_configured', '主聊天 D1 存储未配置。', 503);
  const url = new URL(request.url);
  try {
    if (url.pathname === SOURCES_PATH) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      const result = await listCrossWindowSources(env.COAST_CHAT_DB, {
        currentConversationId: url.searchParams.get('current_conversation_id') || '',
      });
      return json({ ok: true, ...result });
    }
    if (url.pathname === MESSAGES_PATH) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      const result = await listCrossWindowMessageIndex(env.COAST_CHAT_DB, {
        currentConversationId: url.searchParams.get('current_conversation_id') || '',
      });
      return json({ ok: true, ...result });
    }
    if (url.pathname === READ_PATH) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      const result = await readCrossWindow(env.COAST_CHAT_DB, await body(request));
      return json({ ok: true, ...result });
    }
    return apiError('not_found', 'Not found.', 404);
  } catch (error) {
    if (error?.type && error?.status) return apiError(error.type, error.message, error.status);
    return unexpectedApiError('cross-window-api', error, 'cross_window_failed', '跨窗口读取失败');
  }
}
