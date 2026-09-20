import { apiError, isRequestBodyError, json, methodNotAllowed, readJson, requestBodyError, unexpectedApiError } from './http.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import { createWorldbookEntry, deleteWorldbookEntry, listWorldbookEntries, matchWorldbook, updateWorldbookEntry, WorldbookError } from './worldbook.js';

const ROOT = '/api/worldbook';
const TEST = '/api/worldbook/test-match';

export function isWorldbookApiPath(pathname) {
  return pathname === ROOT || pathname === TEST || pathname.startsWith(`${ROOT}/`);
}

export async function routeWorldbookApi(request, env, session = null) {
  if (!env?.COAST_CHAT_DB?.prepare) return apiError('worldbook_db_not_configured', 'Worldbook database is not configured.', 503);
  const url = new URL(request.url);
  try {
    requireOwnerSession(session);
    if (url.pathname === TEST) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      const value = await readJson(request);
      return json({ ok: true, matches: await matchWorldbook(env.COAST_CHAT_DB, value) });
    }
    if (url.pathname === ROOT) {
      if (request.method === 'GET') return json({ ok: true, entries: await listWorldbookEntries(env.COAST_CHAT_DB) });
      if (request.method === 'POST') return json({ ok: true, entry: await createWorldbookEntry(env.COAST_CHAT_DB, await readJson(request)) }, 201);
      return methodNotAllowed('GET, POST');
    }
    const id = decodeURIComponent(url.pathname.slice(ROOT.length + 1));
    if (!id) return apiError('not_found', 'Not found.', 404);
    if (request.method === 'PATCH') return json({ ok: true, entry: await updateWorldbookEntry(env.COAST_CHAT_DB, id, await readJson(request)) });
    if (request.method === 'DELETE') return json({ ok: true, entry: await deleteWorldbookEntry(env.COAST_CHAT_DB, id) });
    return methodNotAllowed('PATCH, DELETE');
  } catch (error) {
    if (error instanceof WorldbookError || error instanceof OwnerAccessError) return apiError(error.type, error.message, error.status);
    if (isRequestBodyError(error)) {
      const mapped = requestBodyError(error);
      return apiError(mapped.type, mapped.message, mapped.status);
    }
    return unexpectedApiError('worldbook-api', error, 'worldbook_failed', '词典操作失败。');
  }
}
