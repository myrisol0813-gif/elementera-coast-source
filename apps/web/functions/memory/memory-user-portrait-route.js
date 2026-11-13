import { json, methodNotAllowed } from '../http.js';
import {
  confirmUserPortraitCandidate,
  createUserPortraitCandidate,
  discardUserPortraitCandidate,
  listUserPortraitCandidates,
  listUserPortraitRevisions,
  clearUserPortrait,
  readUserPortrait,
  setUserPortraitWriteEnabled,
} from '../memory-store.js';
import { body, memorySuffix } from './memory-request.js';

export const USER_PORTRAIT_PATH = '/api/memory/user-portrait';
const CANDIDATES_PATH = `${USER_PORTRAIT_PATH}/candidates`;

export async function routeUserPortrait(request, env, url) {
  const db = env.COAST_CHAT_DB;
  if (url.pathname === USER_PORTRAIT_PATH) {
    if (request.method === 'GET') {
      const [excerpt, candidates, revisions] = await Promise.all([
        readUserPortrait(db),
        listUserPortraitCandidates(db),
        listUserPortraitRevisions(db, 200),
      ]);
      return json({ ok: true, excerpt, candidates, revisions });
    }
    if (request.method === 'PATCH') {
      const value = await body(request);
      if (value.action === 'clear') {
        if (!Number.isSafeInteger(value.expected_revision)) return json({
          ok: false,
          error: { type: 'invalid_request', message: '清空用户画像需要当前版本号。' },
        }, 400);
        return json({ ok: true, excerpt: await clearUserPortrait(db, value.expected_revision) });
      }
      if (typeof value.write_enabled !== 'boolean') return json({ ok: false, error: { type: 'invalid_request', message: 'write_enabled 必须是布尔值。' } }, 400);
      return json({ ok: true, excerpt: await setUserPortraitWriteEnabled(db, value.write_enabled) });
    }
    return methodNotAllowed('GET, PATCH');
  }

  if (url.pathname === CANDIDATES_PATH) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    return json({ ok: true, candidate: await createUserPortraitCandidate(db, await body(request)) }, 201);
  }

  if (url.pathname.startsWith(`${CANDIDATES_PATH}/`)) {
    const id = memorySuffix(url.pathname, CANDIDATES_PATH);
    if (request.method === 'DELETE') return json({ ok: true, ...(await discardUserPortraitCandidate(db, id)) });
    if (request.method === 'PATCH') {
      const value = await body(request);
      const action = String(value.action || 'confirm');
      if (action === 'discard') return json({ ok: true, ...(await discardUserPortraitCandidate(db, id)) });
      if (action !== 'confirm') return json({ ok: false, error: { type: 'invalid_request', message: 'action 只接受 confirm / discard。' } }, 400);
      return json({ ok: true, excerpt: await confirmUserPortraitCandidate(db, id, value) });
    }
    return methodNotAllowed('PATCH, DELETE');
  }

  return null;
}
