import { json, methodNotAllowed } from '../http.js';
import { readCustomInstructions, writeCustomInstructions } from '../memory-store.js';
import { body } from './memory-request.js';

export async function routeCustomInstructions(request, env) {
  if (request.method === 'GET') {
    return json({ ok: true, instructions: await readCustomInstructions(env.COAST_CHAT_DB) });
  }
  if (request.method === 'PUT') {
    return json({ ok: true, instructions: await writeCustomInstructions(env.COAST_CHAT_DB, await body(request)) });
  }
  return methodNotAllowed('GET, PUT');
}
