import { apiError, isRequestBodyError, json, methodNotAllowed, readJson, requestBodyError, unexpectedApiError } from './http.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import {
  WidgetStoreError,
  createWidgetDiary,
  createWidgetMoment,
  deleteWidgetDiary,
  deleteWidgetMoment,
  listWidgetDiaries,
  listWidgetMoments,
} from './widget-store.js';

const MOMENTS = '/api/daily/moments';
const DIARIES = '/api/daily/diaries';

export function isWidgetApiPath(pathname) {
  return pathname === MOMENTS || pathname.startsWith(MOMENTS + '/')
    || pathname === DIARIES || pathname.startsWith(DIARIES + '/');
}

export async function routeWidgetApi(request, env, session = null) {
  const url = new URL(request.url);
  try {
    requireOwnerSession(session);
    if (!env?.COAST_CHAT_DB?.prepare) return apiError('chat_db_not_configured', 'Chat database is not configured.', 503);

    if (url.pathname === MOMENTS) {
      if (request.method === 'GET') return json({ ok: true, moments: await listWidgetMoments(env.COAST_CHAT_DB) });
      if (request.method === 'POST') return json({ ok: true, moment: await createWidgetMoment(env.COAST_CHAT_DB, await readJson(request)) }, 201);
      return methodNotAllowed('GET, POST');
    }
    if (url.pathname.startsWith(MOMENTS + '/')) {
      const id = decodeURIComponent(url.pathname.slice(MOMENTS.length + 1));
      if (request.method === 'DELETE') return json({ ok: true, deleted: await deleteWidgetMoment(env.COAST_CHAT_DB, id) });
      return methodNotAllowed('DELETE');
    }

    if (url.pathname === DIARIES) {
      if (request.method === 'GET') return json({ ok: true, diaries: await listWidgetDiaries(env.COAST_CHAT_DB) });
      if (request.method === 'POST') return json({ ok: true, diary: await createWidgetDiary(env.COAST_CHAT_DB, await readJson(request)) }, 201);
      return methodNotAllowed('GET, POST');
    }
    if (url.pathname.startsWith(DIARIES + '/')) {
      const id = decodeURIComponent(url.pathname.slice(DIARIES.length + 1));
      if (request.method === 'DELETE') return json({ ok: true, deleted: await deleteWidgetDiary(env.COAST_CHAT_DB, id) });
      return methodNotAllowed('DELETE');
    }

    return apiError('not_found', 'Not found.', 404);
  } catch (error) {
    if (error instanceof OwnerAccessError || error instanceof WidgetStoreError) {
      return apiError(error.type, error.message, error.status);
    }
    if (isRequestBodyError(error)) {
      const mapped = requestBodyError(error);
      return apiError(mapped.type, mapped.message, mapped.status);
    }
    return unexpectedApiError('widget-api', error, 'widget_failed', '小组件操作失败。');
  }
}
