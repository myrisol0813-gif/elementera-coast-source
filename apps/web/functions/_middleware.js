import { handleLogin, handleLogout, unauthorized, verifySession } from './auth.js';
import { routeApi } from './api-router.js';
import { isChatApiPath, routeChatApi } from './chat-router.js';
import { protectedResponse } from './http.js';
import { isMailboxApiPath, routeMailboxApi } from './mailbox-api.js';
import { handleMailboxPage } from './mailbox-page.js';
import { isMcpPublicPath, routeMcpRequest } from './mcp-router.js';
import {
  handleO3ReplyCardRequest,
  isO3ReplyCardPublicPath,
} from './o3-reply-card-mcp.js';

const PUBLIC_PWA_ASSETS = new Set([
  '/manifest.json',
  '/public/icons/icon-16.png',
  '/public/icons/icon-32.png',
  '/public/icons/apple-touch-icon.png',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
  '/public/icons/icon-maskable-512.png',
]);

const PUBLIC_MAILBOX_ASSETS = new Set([
  '/public/mailbox-entry.js',
  '/public/mailbox.js',
  '/public/core/api.js',
  '/public/core/danger.js',
  '/public/core/dom.js',
  '/public/core/icons.js',
  '/public/media/model-partner-default-avatar.jpg',
  '/public/styles/tokens.css',
  '/public/styles/shell.css',
  '/public/styles/chat.css',
  '/public/styles/features.css',
  '/public/styles/mailbox.css',
]);

const RETIRED_O3_SERVICE_PATH = /^\/o3-[a-z]+-[a-f0-9]{32}\/(?:mcp|health)\/?$/;

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname === '/login') return handleLogin(request, env);
  if (url.pathname === '/logout') return handleLogout();
  if (url.pathname === '/mailbox') return handleMailboxPage(request, env);
  if (isMailboxApiPath(url.pathname)) return routeMailboxApi(request, env);
  if (['GET', 'HEAD'].includes(request.method) && PUBLIC_PWA_ASSETS.has(url.pathname)) return next();
  if (['GET', 'HEAD'].includes(request.method) && PUBLIC_MAILBOX_ASSETS.has(url.pathname)) return next();
  if (
    isO3ReplyCardPublicPath(url.pathname)
    || RETIRED_O3_SERVICE_PATH.test(url.pathname)
  ) return handleO3ReplyCardRequest(request);
  if (isMcpPublicPath(url.pathname)) return routeMcpRequest(request, env);

  const session = await verifySession(request, env);
  if (!session) return unauthorized(request);

  if (isChatApiPath(url.pathname)) return routeChatApi(request, env);
  if (url.pathname.startsWith('/api/')) return routeApi(request, env, session);
  return protectedResponse(await next());
}
