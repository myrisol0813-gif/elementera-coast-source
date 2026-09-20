import { apiError, json, methodNotAllowed, unexpectedApiError } from './http.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import { integrationCatalog, integrationSelfCheck } from './source-integrations.js';
import { listToolRuns } from './tool-run-log.js';
import { workbenchToolCatalog } from './workbench-catalog.js';

const TOOLS = '/api/workbench/tools';
const RUNS = '/api/workbench/runs';
const SELF_CHECK = '/api/workbench/dev/self-check';
const LOGS = '/api/workbench/dev/logs';

export function isWorkbenchApiPath(pathname) {
  return [TOOLS, RUNS, SELF_CHECK, LOGS].includes(pathname);
}

function sourceSelfCheck(env) {
  return {
    ok: true,
    mode: 'source',
    database: Boolean(env?.COAST_CHAT_DB?.prepare),
    integrations: integrationCatalog().map((item) => integrationSelfCheck(item.id)),
    notes: [
      'Source mode does not include production service connections.',
      'GitHub and Notion actions remain unavailable until the self-hosted adapter is connected.',
    ],
  };
}

export async function routeWorkbenchApi(request, env, session = null) {
  const url = new URL(request.url);
  try {
    requireOwnerSession(session);
    if (request.method !== 'GET') return methodNotAllowed('GET');
    if (url.pathname === TOOLS) return json({ ok: true, tools: workbenchToolCatalog() });
    if (url.pathname === SELF_CHECK) return json(sourceSelfCheck(env));
    if (url.pathname === RUNS || url.pathname === LOGS) {
      const limit = Number(url.searchParams.get('limit') || 50);
      return json({ ok: true, runs: await listToolRuns(env?.COAST_CHAT_DB, { limit }) });
    }
    return apiError('not_found', 'Not found.', 404);
  } catch (error) {
    if (error instanceof OwnerAccessError) return apiError(error.type, error.message, error.status);
    return unexpectedApiError('workbench-api', error, 'workbench_failed', '模型工作台操作失败。');
  }
}
