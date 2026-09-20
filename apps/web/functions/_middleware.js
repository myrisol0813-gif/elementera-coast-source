import { handleLogin, handleLogout, unauthorized, verifySession } from './auth.js';
import { routeApi } from './api-router.js';
import { isMailboxApiPath, routeMailboxApi } from './mailbox-api.js';
import { handleMailboxPage } from './mailbox-page.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/login') return handleLogin(request, env);
  if (path === '/logout') return handleLogout();
  if (path === '/mailbox') return handleMailboxPage(request, env);
  if (isMailboxApiPath(path)) return routeMailboxApi(request, env);

  if (path.startsWith('/public/') || path === '/manifest.json' || path === '/service-worker.js'
    || path === '/_headers' || path === '/_routes.json') return next();

  const session = await verifySession(request, env);
  if (path.startsWith('/api/')) return session ? routeApi(request, env, session) : unauthorized();
  if (!session) return unauthorized();
  return next();
}
