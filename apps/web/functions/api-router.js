import { apiError, json, sameOrigin } from './http.js';
import { isCrossWindowApiPath, routeCrossWindowApi } from './cross-window-api.js';
import { isDailyApiPath, routeDailyApi } from './daily-api.js';
import { isDogtalkApiPath, routeDogtalkApi } from './dogtalk-api.js';
import { isMemoryApiPath, routeMemoryApi } from './memory-router.js';
import { handleModels } from './models.js';
import { isOwnerMailboxApiPath, routeOwnerMailboxApi } from './owner-mailbox-api.js';
import { isRikkaHubApiPath, routeRikkaHubApi } from './rikkahub-api.js';
import { isWorkbenchApiPath, routeWorkbenchApi } from './workbench-api.js';
import { isSnapshotApiPath, routeSnapshotApi } from './snapshot-api.js';

export async function routeApi(request, env, session) {
  const url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method) && !sameOrigin(request)) {
    return apiError('forbidden', 'Forbidden.', 403);
  }
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ ok: true, authenticated: true, ts: new Date().toISOString() });
  }
  if (url.pathname === '/api/session' && request.method === 'GET') {
    return json({
      ok: true,
      authenticated: true,
      session: {
        kind: 'owner',
        issued_at: session.iat ? new Date(Number(session.iat) * 1000).toISOString() : null,
        persistence: session.v === 2 ? 'until_logout' : 'legacy_expiring',
        expires_at: session.exp ? new Date(Number(session.exp) * 1000).toISOString() : null,
      },
      account: { type: 'owner', display_name: '前端屋主' },
    });
  }
  if (isCrossWindowApiPath(url.pathname)) return routeCrossWindowApi(request, env, session);
  if (isDailyApiPath(url.pathname)) return routeDailyApi(request, env, session);
  if (isDogtalkApiPath(url.pathname)) return routeDogtalkApi(request, env, session);
  if (isMemoryApiPath(url.pathname)) return routeMemoryApi(request, env, session);
  if (isOwnerMailboxApiPath(url.pathname)) return routeOwnerMailboxApi(request, env, session);
  if (isRikkaHubApiPath(url.pathname)) return routeRikkaHubApi(request, env, session);
  if (isWorkbenchApiPath(url.pathname)) return routeWorkbenchApi(request, env, session);
  if (isSnapshotApiPath(url.pathname)) return routeSnapshotApi(request, env, session);
  if (url.pathname === '/api/models') return handleModels(request, env);
  return apiError('not_found', 'Not found.', 404);
}
