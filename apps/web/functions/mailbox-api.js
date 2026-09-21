import {
  clearMailboxSessionCookie,
  createMailboxSession,
  mailboxSessionCookie,
  verifyMailboxSession,
} from './mailbox-auth.js';
import {
  apiError,
  isRequestBodyError,
  json,
  methodNotAllowed,
  readJson,
  requestBodyError,
  sameOrigin,
  unexpectedApiError,
} from './http.js';
import { ensureMailboxSchema } from './mailbox-schema.js';
import {
  currentMailboxVisitor,
  deleteVisibleVisitorNotebookEntry,
  editMailboxMessage,
  loginMailboxVisitor,
  mailboxMessages,
  mailboxVisitorStatus,
  MailboxServiceError,
  registerMailboxVisitor,
  removeMailboxAccount,
  removeMailboxMessage,
  resolveMailboxPocket,
  sendMailboxMessage,
  visibleVisitorMemory,
} from './mailbox-service.js';

const ROOT = '/api/mailbox';

function publicVisitor(visitor) {
  return {
    visitor_id: visitor.id,
    display_name: visitor.display_name,
    preferred_name: visitor.preferred_name,
    allow_memory: visitor.allow_memory,
    privacy_level: visitor.privacy_level,
  };
}

function authenticatedResponse(visitor, env, status = 200) {
  return createMailboxSession(visitor.id, env).then((token) => json({
    ok: true,
    ...publicVisitor(visitor),
    session: 'secure_cookie',
  }, status, {
    'Set-Cookie': mailboxSessionCookie(token),
  }));
}

export function isMailboxApiPath(pathname) {
  return pathname === ROOT || pathname.startsWith(`${ROOT}/`);
}

export async function routeMailboxApi(request, env) {
  if (!env?.COAST_CHAT_DB?.prepare) {
    return apiError('coast_db_not_configured', '海岸 D1 存储未配置。', 503);
  }
  const url = new URL(request.url);
  // Schema initialization also owns one-time mailbox-only migrations.
  // Run it before visitor authentication so deployment can safely finish
  // mailbox maintenance without exposing or requiring a visitor credential.
  await ensureMailboxSchema(env.COAST_CHAT_DB);
  if (!['GET', 'HEAD'].includes(request.method) && !sameOrigin(request)) {
    return apiError('forbidden', 'Forbidden.', 403);
  }

  try {
    if (url.pathname === `${ROOT}/register`) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      const visitor = await registerMailboxVisitor(env.COAST_CHAT_DB, env, await readJson(request));
      return authenticatedResponse(visitor, env, 201);
    }
    if (url.pathname === `${ROOT}/login`) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      const value = await readJson(request);
      const visitor = await loginMailboxVisitor(env.COAST_CHAT_DB, env, value.passphrase);
      return authenticatedResponse(visitor, env);
    }
    if (url.pathname === `${ROOT}/logout`) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      return json({ ok: true }, 200, { 'Set-Cookie': clearMailboxSessionCookie() });
    }

    const session = await verifyMailboxSession(request, env);
    if (!session) return apiError('mailbox_session_required', '请先输入访客暗号。', 401);
    const visitorId = session.visitor_id;

    if (url.pathname === `${ROOT}/me`) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({
        ok: true,
        ...publicVisitor(await currentMailboxVisitor(env.COAST_CHAT_DB, visitorId, { touch: true })),
      });
    }
    if (url.pathname === `${ROOT}/messages`) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({
        ok: true,
        messages: await mailboxMessages(env.COAST_CHAT_DB, visitorId),
      });
    }
    const messageMatch = url.pathname.match(/^\/api\/mailbox\/messages\/([^/]+)$/);
    if (messageMatch) {
      const messageId = decodeURIComponent(messageMatch[1]);
      if (request.method === 'PATCH') {
        const value = await readJson(request);
        return json({
          ok: true,
          message: await editMailboxMessage(
            env.COAST_CHAT_DB,
            visitorId,
            messageId,
            value.content,
          ),
        });
      }
      if (request.method === 'DELETE') {
        return json({
          ok: true,
          ...await removeMailboxMessage(env.COAST_CHAT_DB, visitorId, messageId),
        });
      }
      return methodNotAllowed('PATCH, DELETE');
    }
    if (url.pathname === `${ROOT}/send`) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      const value = await readJson(request);
      return json({
        ok: true,
        message: await sendMailboxMessage(env.COAST_CHAT_DB, visitorId, value.content),
        delivery: '信已经投入访客信箱。',
        waiting: '等待另一位屋主下一次查看。',
      }, 201);
    }
    if (url.pathname === `${ROOT}/status`) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({
        ok: true,
        ...await mailboxVisitorStatus(env.COAST_CHAT_DB, visitorId),
      });
    }
    if (url.pathname === `${ROOT}/memory`) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({
        ok: true,
        memory: await visibleVisitorMemory(env.COAST_CHAT_DB, visitorId),
      });
    }
    const memoryPocketMatch = url.pathname.match(/^\/api\/mailbox\/memory\/pockets\/([^/]+)\/resolve$/);
    if (memoryPocketMatch) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      const value = await readJson(request);
      return json({
        ok: true,
        ...await resolveMailboxPocket(env.COAST_CHAT_DB, {
          visitor_id: visitorId,
          pocket_id: decodeURIComponent(memoryPocketMatch[1]),
          action: value.action,
          visibility: 'visitor_visible',
        }),
      });
    }
    const memoryEntryMatch = url.pathname.match(/^\/api\/mailbox\/memory\/entries\/([^/]+)$/);
    if (memoryEntryMatch) {
      if (request.method !== 'DELETE') return methodNotAllowed('DELETE');
      await deleteVisibleVisitorNotebookEntry(
        env.COAST_CHAT_DB,
        visitorId,
        decodeURIComponent(memoryEntryMatch[1]),
      );
      return json({ ok: true });
    }
    if (url.pathname === `${ROOT}/account`) {
      if (request.method !== 'DELETE') return methodNotAllowed('DELETE');
      const result = await removeMailboxAccount(env.COAST_CHAT_DB, visitorId);
      return json({ ok: true, ...result }, 200, {
        'Set-Cookie': clearMailboxSessionCookie(),
      });
    }
    return apiError('not_found', 'Not found.', 404);
  } catch (error) {
    if (error instanceof MailboxServiceError) {
      return apiError(error.type, error.message, error.status);
    }
    if (isRequestBodyError(error)) {
      const mapped = requestBodyError(error);
      return apiError(mapped.type, mapped.message, mapped.status);
    }
    if (error?.message === 'mailbox_auth_not_configured') {
      return apiError('mailbox_auth_not_configured', '访客信箱登录态尚未配置。', 503);
    }
    return unexpectedApiError('mailbox-api', error, 'mailbox_failed', '访客信箱操作失败');
  }
}
