import { apiError, json, methodNotAllowed, unexpectedApiError } from './http.js';
import { requireOwnerSession, OwnerAccessError } from './owner-access.js';
import { mailboxOwnerSummary, ownerMailboxVisitors } from './mailbox-service.js';

const ROOT = '/api/owner/mailbox';

export function isOwnerMailboxApiPath(pathname) {
  return pathname === `${ROOT}/visitors` || pathname === `${ROOT}/summary`;
}

export async function routeOwnerMailboxApi(request, env, session) {
  if (!env?.COAST_CHAT_DB?.prepare) {
    return apiError('coast_db_not_configured', '海岸 D1 存储未配置。', 503);
  }
  const url = new URL(request.url);
  try {
    requireOwnerSession(session);
    if (url.pathname === `${ROOT}/visitors`) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({
        ok: true,
        visitors: await ownerMailboxVisitors(env.COAST_CHAT_DB),
      });
    }
    if (url.pathname === `${ROOT}/summary`) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({
        ok: true,
        ...await mailboxOwnerSummary(env.COAST_CHAT_DB),
      });
    }
    return apiError('not_found', 'Not found.', 404);
  } catch (error) {
    if (error instanceof OwnerAccessError) {
      return apiError(error.type, error.message, error.status);
    }
    return unexpectedApiError('owner-mailbox-api', error, 'owner_mailbox_failed', '信箱状态读取失败');
  }
}
