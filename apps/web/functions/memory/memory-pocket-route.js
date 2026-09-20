import { sanitizeId } from '../chat-store.js';
import { syncEntryVector } from '../embedding.js';
import { json, methodNotAllowed } from '../http.js';
import {
  createPocket,
  deletePocket,
  listPockets,
  patchPocket,
  resolvePocket,
} from '../memory-store.js';
import {
  decoratePocketProvenance,
  decoratePocketsProvenance,
} from '../provenance-store.js';
import { body, conversationIdFrom, memorySuffix } from './memory-request.js';

const POCKETS_PATH = '/api/memory/pockets';

export async function routeMemoryPockets(request, env, url) {
  const suffix = memorySuffix(url.pathname, POCKETS_PATH);
  if (!suffix) {
    if (request.method === 'GET') {
      const conversationId = conversationIdFrom(url);
      const values = await listPockets(env.COAST_CHAT_DB, {
        conversation_id: conversationId,
        status: url.searchParams.get('status') || 'pending',
      });
      return json({ ok: true, pockets: await decoratePocketsProvenance(env.COAST_CHAT_DB, values) });
    }
    if (request.method === 'POST') return json({ ok: true, pocket: await createPocket(env.COAST_CHAT_DB, await body(request)) }, 201);
    return methodNotAllowed('GET, POST');
  }

  const parts = suffix.split('/');
  const pocketId = sanitizeId(parts[0], 'pocket');
  if (parts[1] === 'resolve') {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const result = await resolvePocket(env.COAST_CHAT_DB, pocketId, await body(request));
    if (result.entry) result.entry = (await syncEntryVector(env, env.COAST_CHAT_DB, result.entry)).entry;
    result.pocket = await decoratePocketProvenance(env.COAST_CHAT_DB, result.pocket);
    return json({ ok: true, ...result });
  }
  if (request.method === 'PATCH') {
    const pocket = await patchPocket(env.COAST_CHAT_DB, pocketId, await body(request));
    return json({ ok: true, pocket: await decoratePocketProvenance(env.COAST_CHAT_DB, pocket) });
  }
  if (request.method === 'DELETE') {
    return json({ ok: true, pocket: await deletePocket(env.COAST_CHAT_DB, pocketId), deleted: true });
  }
  return methodNotAllowed('PATCH, DELETE');
}
