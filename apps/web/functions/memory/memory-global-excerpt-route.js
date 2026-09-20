import { json, methodNotAllowed } from '../http.js';
import {
  confirmGlobalExcerptCandidate,
  createGlobalExcerptCandidate,
  discardGlobalExcerptCandidate,
  listGlobalExcerptCandidates,
  listGlobalExcerptRevisions,
  readGlobalExcerpt,
  setGlobalExcerptWriteEnabled,
} from '../memory-store.js';
import { body, memorySuffix } from './memory-request.js';

export const GLOBAL_EXCERPT_PATH = '/api/memory/global-excerpt';
const CANDIDATES_PATH = `${GLOBAL_EXCERPT_PATH}/candidates`;

export async function routeGlobalExcerpt(request, env, url) {
  const db = env.COAST_CHAT_DB;
  if (url.pathname === GLOBAL_EXCERPT_PATH) {
    if (request.method === 'GET') {
      const [excerpt, candidates, revisions] = await Promise.all([
        readGlobalExcerpt(db),
        listGlobalExcerptCandidates(db),
        listGlobalExcerptRevisions(db, 200),
      ]);
      return json({ ok: true, excerpt, candidates, revisions });
    }
    if (request.method === 'PATCH') {
      const value = await body(request);
      if (typeof value.write_enabled !== 'boolean') return json({ ok: false, error: { type: 'invalid_request', message: 'write_enabled 必须是布尔值。' } }, 400);
      return json({ ok: true, excerpt: await setGlobalExcerptWriteEnabled(db, value.write_enabled) });
    }
    return methodNotAllowed('GET, PATCH');
  }

  if (url.pathname === CANDIDATES_PATH) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    return json({ ok: true, candidate: await createGlobalExcerptCandidate(db, await body(request)) }, 201);
  }

  if (url.pathname.startsWith(`${CANDIDATES_PATH}/`)) {
    const id = memorySuffix(url.pathname, CANDIDATES_PATH);
    if (request.method === 'DELETE') return json({ ok: true, ...(await discardGlobalExcerptCandidate(db, id)) });
    if (request.method === 'PATCH') {
      const value = await body(request);
      const action = String(value.action || 'confirm');
      if (action === 'discard') return json({ ok: true, ...(await discardGlobalExcerptCandidate(db, id)) });
      if (action !== 'confirm') return json({ ok: false, error: { type: 'invalid_request', message: 'action 只接受 confirm / discard。' } }, 400);
      return json({ ok: true, excerpt: await confirmGlobalExcerptCandidate(db, id, value) });
    }
    return methodNotAllowed('PATCH, DELETE');
  }

  return null;
}
