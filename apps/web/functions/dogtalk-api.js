import {
  archiveMysticDogtalk,
  askModelPartnerToReadMysticDogtalk,
  clearMysticDogtalkDraft,
  DogtalkStoreError,
  getMysticDogtalk,
  publicMysticDogtalk,
  saveMysticDogtalk,
} from './dogtalk-store.js';
import {
  apiError,
  isRequestBodyError,
  json,
  methodNotAllowed,
  readJson,
  requestBodyError,
  unexpectedApiError,
} from './http.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';

const DOGTALK_PATH = '/api/dogtalk';

function scopeFromUrl(url) {
  return {
    room_scope: url.searchParams.get('room_scope') || '',
    conversation_id: url.searchParams.get('conversation_id') || '',
  };
}

function responseDogtalk(value) {
  return publicMysticDogtalk(value);
}

export function isDogtalkApiPath(pathname) {
  return pathname === DOGTALK_PATH || pathname.startsWith(`${DOGTALK_PATH}/`);
}

export async function routeDogtalkApi(request, env, session = null) {
  if (!env?.COAST_CHAT_DB?.prepare) {
    return apiError('coast_db_not_configured', '海岸 D1 存储未配置。', 503);
  }
  const url = new URL(request.url);
  try {
    requireOwnerSession(session);
    if (url.pathname === DOGTALK_PATH) {
      if (request.method === 'GET') {
        return json({
          ok: true,
          dogtalk: responseDogtalk(await getMysticDogtalk(env.COAST_CHAT_DB, scopeFromUrl(url))),
        });
      }
      if (request.method === 'PUT') {
        return json({
          ok: true,
          dogtalk: responseDogtalk(await saveMysticDogtalk(env.COAST_CHAT_DB, await readJson(request))),
        });
      }
      return methodNotAllowed('GET, PUT');
    }

    const match = url.pathname.match(/^\/api\/dogtalk\/([^/]+)(?:\/(archive|read))?$/);
    if (!match) return apiError('not_found', 'Not found.', 404);
    const id = decodeURIComponent(match[1]);
    if (match[2] === 'archive') {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      await archiveMysticDogtalk(env.COAST_CHAT_DB, id);
      return json({ ok: true, archived: true });
    }
    if (match[2] === 'read') {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      return json({
        ok: true,
        dogtalk: responseDogtalk(await askModelPartnerToReadMysticDogtalk(env.COAST_CHAT_DB, id)),
      });
    }
    if (request.method !== 'DELETE') return methodNotAllowed('DELETE');
    await clearMysticDogtalkDraft(env.COAST_CHAT_DB, id);
    return json({ ok: true, archived: true });
  } catch (error) {
    if (error instanceof DogtalkStoreError || error instanceof OwnerAccessError) {
      return apiError(error.type, error.message, error.status);
    }
    if (isRequestBodyError(error)) {
      const mapped = requestBodyError(error);
      return apiError(mapped.type, mapped.message, mapped.status);
    }
    return unexpectedApiError('dogtalk-api', error, 'dogtalk_failed', '人类思考链暂时没有收好');
  }
}
