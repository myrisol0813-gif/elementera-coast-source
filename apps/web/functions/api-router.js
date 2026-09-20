import { apiError } from './http.js';
import { isChatApiPath, routeChatApi } from './chat-api.js';
import { isHumanThoughtApiPath, routeHumanThoughtApi } from './human-thought-api.js';
import { isExternalEntryApiPath, routeExternalEntryApi } from './external-entry-api.js';
import { isMemoryApiPath, routeMemoryApi } from './memory-router.js';
import { isOwnerMailboxApiPath, routeOwnerMailboxApi } from './owner-mailbox-api.js';
import { isSnapshotApiPath, routeSnapshotApi } from './snapshot-api.js';
import { isWorkbenchApiPath, routeWorkbenchApi } from './workbench-api.js';
import { isWorldbookApiPath, routeWorldbookApi } from './worldbook-api.js';
import { handleModels } from './models.js';

export async function routeApi(request, env, session) {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/api/models') return handleModels(request, env);
  if (isChatApiPath(pathname)) return routeChatApi(request, env, session);
  if (isHumanThoughtApiPath(pathname)) return routeHumanThoughtApi(request, env, session);
  if (isExternalEntryApiPath(pathname)) return routeExternalEntryApi(request, env, session);
  if (isMemoryApiPath(pathname)) return routeMemoryApi(request, env, session);
  if (isOwnerMailboxApiPath(pathname)) return routeOwnerMailboxApi(request, env, session);
  if (isSnapshotApiPath(pathname)) return routeSnapshotApi(request, env, session);
  if (isWorkbenchApiPath(pathname)) return routeWorkbenchApi(request, env, session);
  if (isWorldbookApiPath(pathname)) return routeWorldbookApi(request, env, session);
  return apiError('not_found', 'Not found.', 404);
}
