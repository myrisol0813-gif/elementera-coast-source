import { json, methodNotAllowed } from '../http.js';
import { readSoil, writeSoil } from '../memory-store.js';
import { decorateSoilProvenance } from '../provenance-store.js';
import { body, conversationIdFrom } from './memory-request.js';
import { organizeConversationSoil } from './memory-soil-organizer.js';

export async function routeSoil(request, env, url) {
  const conversationId = conversationIdFrom(url);
  if (request.method === 'GET') {
    const value = await readSoil(env.COAST_CHAT_DB, conversationId);
    return json({ ok: true, soil: await decorateSoilProvenance(env.COAST_CHAT_DB, value) });
  }
  if (request.method === 'PUT') {
    const value = await body(request);
    const written = await writeSoil(env.COAST_CHAT_DB, conversationId, value);
    return json({ ok: true, soil: await decorateSoilProvenance(env.COAST_CHAT_DB, written) });
  }
  return methodNotAllowed('GET, PUT');
}

export async function routeSoilOrganize(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const value = await body(request);
  const conversationId = conversationIdFrom(new URL(request.url), value);
  return json(await organizeConversationSoil(env, conversationId, value));
}
