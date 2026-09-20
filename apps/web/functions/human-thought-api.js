import { apiError, isRequestBodyError, json, methodNotAllowed, readJson, requestBodyError, unexpectedApiError } from './http.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import { getHumanThought, HumanThoughtStoreError, saveHumanThought } from './human-thought-store.js';

const PATH = '/api/human-thought';

export function isHumanThoughtApiPath(pathname) {
  return pathname === PATH;
}

export async function routeHumanThoughtApi(request, env, session = null) {
  if (!env?.COAST_CHAT_DB?.prepare) return apiError('chat_db_not_configured', 'Chat database is not configured.', 503);
  const url = new URL(request.url);
  try {
    requireOwnerSession(session);
    if (request.method === 'GET') {
      return json({
        ok: true,
        human_thought: await getHumanThought(env.COAST_CHAT_DB, {
          conversation_id: url.searchParams.get('conversation_id') || '',
        }),
      });
    }
    if (request.method === 'PUT') {
      return json({ ok: true, human_thought: await saveHumanThought(env.COAST_CHAT_DB, await readJson(request)) });
    }
    return methodNotAllowed('GET, PUT');
  } catch (error) {
    if (error instanceof HumanThoughtStoreError || error instanceof OwnerAccessError) {
      return apiError(error.type, error.message, error.status);
    }
    if (isRequestBodyError(error)) {
      const mapped = requestBodyError(error);
      return apiError(mapped.type, mapped.message, mapped.status);
    }
    return unexpectedApiError('human-thought-api', error, 'human_thought_failed', '人类思考链操作失败。');
  }
}
