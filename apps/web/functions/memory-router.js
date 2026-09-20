import { ChatStoreError } from './chat-store.js';
import { apiError, unexpectedApiError } from './http.js';
import { MemoryStoreError, hasMemoryDatabase } from './memory-store.js';
import { ModelRequestError } from './models.js';
import { OwnerAccessError } from './owner-access.js';
import { routeCustomInstructions } from './memory/memory-custom-instructions-route.js';
import { GLOBAL_EXCERPT_PATH, routeGlobalExcerpt } from './memory/memory-global-excerpt-route.js';
import { routeMemoryEntries } from './memory/memory-entry-route.js';
import { routeMemoryPockets } from './memory/memory-pocket-route.js';
import {
  routeMemoryRecall,
  routeMemorySearch,
  routeVectorStatus,
} from './memory/memory-search-route.js';
import { routeSoil, routeSoilOrganize } from './memory/memory-soil-route.js';

const MEMORY_PATH = '/api/memory';

export function isMemoryApiPath(pathname) {
  return pathname === `${MEMORY_PATH}/soil`
    || pathname === `${MEMORY_PATH}/soil/organize`
    || pathname === `${MEMORY_PATH}/pockets`
    || pathname.startsWith(`${MEMORY_PATH}/pockets/`)
    || pathname === `${MEMORY_PATH}/entries`
    || pathname.startsWith(`${MEMORY_PATH}/entries/`)
    || pathname === `${MEMORY_PATH}/search`
    || pathname === `${MEMORY_PATH}/recall`
    || pathname === `${MEMORY_PATH}/custom-instructions`
    || pathname === `${MEMORY_PATH}/vector-status`
    || pathname === GLOBAL_EXCERPT_PATH
    || pathname.startsWith(`${GLOBAL_EXCERPT_PATH}/`);
}

export async function routeMemoryApi(request, env, session = null) {
  if (!hasMemoryDatabase(env)) return apiError('memory_db_not_configured', '记忆 D1 存储未配置。', 503);
  const url = new URL(request.url);
  try {
    if (url.pathname === `${MEMORY_PATH}/soil`) return await routeSoil(request, env, url);
    if (url.pathname === `${MEMORY_PATH}/soil/organize`) return await routeSoilOrganize(request, env);
    if (url.pathname === `${MEMORY_PATH}/search`) return await routeMemorySearch(request, env);
    if (url.pathname === `${MEMORY_PATH}/recall`) return await routeMemoryRecall(request, env);
    if (url.pathname === `${MEMORY_PATH}/custom-instructions`) return await routeCustomInstructions(request, env);
    if (url.pathname === GLOBAL_EXCERPT_PATH || url.pathname.startsWith(`${GLOBAL_EXCERPT_PATH}/`)) return await routeGlobalExcerpt(request, env, url);
    if (url.pathname === `${MEMORY_PATH}/vector-status`) return await routeVectorStatus(request, env);
    if (url.pathname === `${MEMORY_PATH}/pockets` || url.pathname.startsWith(`${MEMORY_PATH}/pockets/`)) {
      return await routeMemoryPockets(request, env, url);
    }
    return await routeMemoryEntries(request, env, url);
  } catch (error) {
    if (error instanceof MemoryStoreError
      || error instanceof ChatStoreError
      || error instanceof ModelRequestError
      || error instanceof OwnerAccessError) {
      return apiError(error.type, error.message, error.status, error.details || {});
    }
    return unexpectedApiError('memory-api', error, 'memory_store_failed', '记忆操作失败');
  }
}
