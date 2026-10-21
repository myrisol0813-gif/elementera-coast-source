import { CalendarError, createCalendarEntry, deleteCalendarEntry, listCalendarEntries, updateCalendarEntry } from './calendar-store.js';
import { apiError, json, methodNotAllowed, readJson, requestBodyError, unexpectedApiError } from './http.js';
import { requireOwnerSession, OwnerAccessError } from './owner-access.js';

const PREFIX = '/api/calendar/entries';
const BODY_MAX_BYTES = 16 * 1024;

export function isCalendarApiPath(pathname) {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}

async function route(request, env, session) {
  requireOwnerSession(session);
  const url = new URL(request.url);
  const rest = url.pathname.slice(PREFIX.length);
  if (!rest) {
    if (request.method === 'GET') {
      return json({ ok: true, entries: await listCalendarEntries(env.COAST_CHAT_DB, { month: url.searchParams.get('month') || '' }) });
    }
    if (request.method === 'POST') {
      const entry = await createCalendarEntry(env.COAST_CHAT_DB, await readJson(request, BODY_MAX_BYTES), { author: 'owner' });
      return json({ ok: true, entry }, 201);
    }
    return methodNotAllowed('GET, POST');
  }
  if (!/^\/[a-z0-9-]+$/i.test(rest)) return apiError('not_found', 'Not found.', 404);
  const id = rest.slice(1);
  if (request.method === 'PATCH') {
    const entry = await updateCalendarEntry(env.COAST_CHAT_DB, id, await readJson(request, BODY_MAX_BYTES));
    return json({ ok: true, entry });
  }
  if (request.method === 'DELETE') {
    return json({ ok: true, ...await deleteCalendarEntry(env.COAST_CHAT_DB, id) });
  }
  return methodNotAllowed('PATCH, DELETE');
}

export async function routeCalendarApi(request, env, session) {
  try {
    return await route(request, env, session);
  } catch (error) {
    if (error instanceof CalendarError || error instanceof OwnerAccessError) {
      return apiError(error.type, error.message, error.status);
    }
    if (['invalid_json', 'body_too_large'].includes(error?.message)) {
      const mapped = requestBodyError(error, {
        invalidType: 'invalid_request', invalidMessage: '日历请求不是有效 JSON。',
        tooLargeMessage: '日历请求体超过 16 KB。',
      });
      return apiError(mapped.type, mapped.message, mapped.status);
    }
    return unexpectedApiError('calendar-api', error, 'calendar_failed', '日历暂时无法完成操作');
  }
}
