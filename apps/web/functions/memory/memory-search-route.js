import { sanitizeId } from '../chat-store.js';
import { vectorStatus } from '../embedding.js';
import { json, methodNotAllowed } from '../http.js';
import { buildMemoryContext, searchMemory } from '../memory-recall.js';
import { MEMORY_OWNER_ID } from '../memory-store.js';
import { body } from './memory-request.js';

export async function routeMemorySearch(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  return json({ ok: true, ...await searchMemory(env, MEMORY_OWNER_ID, await body(request)) });
}

export async function routeMemoryRecall(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const value = await body(request);
  const conversationId = sanitizeId(value.conversation_id || '', 'conversation');
  const result = await buildMemoryContext(env, MEMORY_OWNER_ID, conversationId, value.query || '', {
    recent_entry_ids: value.recent_entry_ids,
    explicit: value.explicit === true,
    settings: value.settings,
    conversation_turns: value.conversation_turns,
  });
  return json({ ok: true, ...result });
}

export async function routeVectorStatus(request, env) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  return json({ ok: true, ...await vectorStatus(env) });
}
