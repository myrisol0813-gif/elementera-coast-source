import { ChatStoreError } from './chat-store.js';
import {
  DailyStoreError,
  addMomentComment,
  createDiary,
  createMoment,
  deleteDiary,
  deleteMoment,
  deleteMomentComment,
  hasDailyDatabase,
  listDiaries,
  listMoments,
  patchDiary,
  patchMoment,
  setMomentLike,
} from './daily-store.js';
import { readDailyProfile, writeDailyProfile } from './daily-profile-store.js';
import { createModelPartnerMomentComment } from './daily-moment-comment.js';
import { ownerIdentity } from './coast-identity.js';
import {
  apiError,
  json,
  methodNotAllowed,
  readJson,
  requestBodyError,
  safeLogError,
  securityHeaders,
  unexpectedApiError,
} from './http.js';
import { MemoryStoreError } from './memory-store.js';
import { ModelRequestError } from './models.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import { encodeSseEvent } from './stream-format.js';

const DAILY_PATH = '/api/daily';
const DAILY_COMMENT_BUILD = 'daily-comment-33';
const BODY_LIMIT = 256 * 1024;
const PROFILE_BODY_LIMIT = 2 * 1024 * 1024;

async function body(request, limit = BODY_LIMIT) {
  try {
    return await readJson(request, limit);
  } catch (error) {
    const mapped = requestBodyError(error, {
      invalidType: 'invalid_request',
      invalidMessage: '日报请求体不是有效的 JSON。',
      tooLargeMessage: '日报请求体过大。',
    });
    throw new DailyStoreError(mapped.type, mapped.message, mapped.status);
  }
}

function suffix(pathname, base) {
  return decodeURIComponent(pathname.slice(base.length).replace(/^\//, ''));
}

function isModelPartnerCommentPath(pathname) {
  return /^\/api\/daily\/moments\/[^/]+\/model-partner-comment$/.test(String(pathname || ''));
}

function tagDailyCommentResponse(response, pathname) {
  if (isModelPartnerCommentPath(pathname)) response.headers.set('X-Coast-Daily-Comment-Build', DAILY_COMMENT_BUILD);
  return response;
}

function safeRouteToken(value, max = 160) {
  return String(value || '').replace(/[^a-z0-9_.:-]/gi, '_').slice(0, max);
}

function logModelPartnerCommentRoute(id, mode, step, startedAt, extra = {}) {
  console.info('[daily-model-partner-comment-route]', JSON.stringify({
    operation: mode === 'instant' ? 'instant' : 'contextual',
    step,
    moment_id: safeRouteToken(id),
    elapsed_ms: Math.max(0, Date.now() - startedAt),
    ...extra,
  }));
}

function streamErrorPayload(error, id, mode) {
  if (error instanceof ModelRequestError) {
    safeLogError('daily-model-partner-comment', error, {
      reference: id,
      operation: mode === 'instant' ? 'instant' : 'contextual',
    });
  }
  if (error instanceof DailyStoreError
    || error instanceof ChatStoreError
    || error instanceof MemoryStoreError
    || error instanceof ModelRequestError
    || error instanceof OwnerAccessError) {
    return {
      type: error.type,
      message: error.message,
      status: error.status,
      details: error.details || {},
    };
  }
  const reference = crypto.randomUUID().slice(0, 8);
  safeLogError('daily-model-partner-comment-stream', error, { reference });
  return {
    type: 'daily_store_failed',
    message: `小组件操作失败（${reference}）。`,
    status: 500,
    details: {},
  };
}

function streamModelPartnerComment(env, id, value) {
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(encodeSseEvent('ready', { build: DAILY_COMMENT_BUILD })));
      logModelPartnerCommentRoute(id, value.mode, 'stream_ready', startedAt);
      try {
        const generated = await createModelPartnerMomentComment(env, id, value);
        logModelPartnerCommentRoute(id, value.mode, 'route_done', startedAt, { model: safeRouteToken(generated.model, 180) });
        controller.enqueue(encoder.encode(encodeSseEvent('result', { ok: true, ...generated })));
      } catch (error) {
        const payload = streamErrorPayload(error, id, value.mode);
        logModelPartnerCommentRoute(id, value.mode, 'route_failed', startedAt, {
          type: safeRouteToken(payload.type, 120),
          status: Number.isFinite(Number(payload.status)) ? Number(payload.status) : null,
          stage: safeRouteToken(payload.details?.stage, 120),
        });
        controller.enqueue(encoder.encode(encodeSseEvent('error', payload)));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: securityHeaders({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Coast-Daily-Comment-Build': DAILY_COMMENT_BUILD,
    }),
  });
}

async function moments(request, env, url, session) {
  const base = `${DAILY_PATH}/moments`;
  const rest = suffix(url.pathname, base);
  if (!rest) {
    if (request.method === 'GET') {
      return json({
        ok: true,
        moments: await listMoments(env.COAST_CHAT_DB, {
          status: url.searchParams.get('status') || '',
          date: url.searchParams.get('date') || '',
        }),
      });
    }
    if (request.method === 'POST') {
      return json({
        ok: true,
        moment: await createMoment(env.COAST_CHAT_DB, await body(request), {
          author: 'owner',
          source: 'manual',
          conversation_id: null,
          source_turn_id: null,
          tool_call_id: null,
          identity: ownerIdentity(),
        }),
      }, 201);
    }
    return methodNotAllowed('GET, POST');
  }

  const parts = rest.split('/');
  const id = parts[0];
  if (parts.length === 3 && parts[1] === 'comments') {
    if (request.method !== 'DELETE') return methodNotAllowed('DELETE');
    requireOwnerSession(session);
    return json({ ok: true, moment: await deleteMomentComment(env.COAST_CHAT_DB, id, parts[2]), deleted: true });
  }
  if (parts.length === 2 && parts[1] === 'comments') {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const value = await body(request);
    return json({
      ok: true,
      moment: await addMomentComment(env.COAST_CHAT_DB, id, { id: value.id, author: 'owner', text: value.text }),
    }, 201);
  }
  if (parts.length === 2 && parts[1] === 'model-partner-comment') {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const value = await body(request);
    logModelPartnerCommentRoute(id, value.mode, 'route_entered', Date.now());
    return streamModelPartnerComment(env, id, value);
  }
  if (parts.length === 2 && parts[1] === 'like') {
    if (!['PUT', 'DELETE'].includes(request.method)) return methodNotAllowed('PUT, DELETE');
    return json({ ok: true, moment: await setMomentLike(env.COAST_CHAT_DB, id, request.method === 'PUT', 'owner') });
  }
  if (parts.length !== 1) return apiError('not_found', 'Not found.', 404);
  if (request.method === 'DELETE') {
    requireOwnerSession(session);
    return json({ ok: true, moment: await deleteMoment(env.COAST_CHAT_DB, id), deleted: true });
  }
  if (request.method !== 'PATCH') return methodNotAllowed('PATCH, DELETE');
  return json({ ok: true, moment: await patchMoment(env.COAST_CHAT_DB, id, await body(request)) });
}

async function diaries(request, env, url, session) {
  const base = `${DAILY_PATH}/diaries`;
  const rest = suffix(url.pathname, base);
  if (!rest) {
    if (request.method === 'GET') {
      return json({
        ok: true,
        diaries: await listDiaries(env.COAST_CHAT_DB, {
          date: url.searchParams.get('date') || '',
          author: url.searchParams.get('author') || '',
        }),
      });
    }
    if (request.method === 'POST') {
      return json({
        ok: true,
        diary: await createDiary(env.COAST_CHAT_DB, await body(request), {
          author: 'owner',
          source: 'manual',
          conversation_id: null,
          source_turn_id: null,
          tool_call_id: null,
          identity: ownerIdentity(),
        }),
      }, 201);
    }
    return methodNotAllowed('GET, POST');
  }
  if (rest.includes('/')) return apiError('not_found', 'Not found.', 404);
  if (request.method === 'DELETE') {
    requireOwnerSession(session);
    return json({ ok: true, diary: await deleteDiary(env.COAST_CHAT_DB, rest), deleted: true });
  }
  if (request.method !== 'PATCH') return methodNotAllowed('PATCH, DELETE');
  return json({ ok: true, diary: await patchDiary(env.COAST_CHAT_DB, rest, await body(request)) });
}

async function profile(request, env, session) {
  requireOwnerSession(session);
  if (request.method === 'GET') {
    return json({ ok: true, profile: await readDailyProfile(env.COAST_CHAT_DB) });
  }
  if (request.method === 'PUT') {
    const value = await body(request, PROFILE_BODY_LIMIT);
    return json({ ok: true, profile: await writeDailyProfile(env.COAST_CHAT_DB, value.profile || value) });
  }
  return methodNotAllowed('GET, PUT');
}

export function isDailyApiPath(pathname) {
  return pathname === `${DAILY_PATH}/moments`
    || pathname.startsWith(`${DAILY_PATH}/moments/`)
    || pathname === `${DAILY_PATH}/diaries`
    || pathname.startsWith(`${DAILY_PATH}/diaries/`)
    || pathname === `${DAILY_PATH}/profile`;
}

export async function routeDailyApi(request, env, session = null) {
  const url = new URL(request.url);
  let response;
  if (!hasDailyDatabase(env)) {
    response = apiError('daily_db_not_configured', '小组件 D1 存储未配置。', 503);
    return tagDailyCommentResponse(response, url.pathname);
  }
  try {
    if (url.pathname === `${DAILY_PATH}/moments` || url.pathname.startsWith(`${DAILY_PATH}/moments/`)) {
      response = await moments(request, env, url, session);
    } else if (url.pathname === `${DAILY_PATH}/diaries` || url.pathname.startsWith(`${DAILY_PATH}/diaries/`)) {
      response = await diaries(request, env, url, session);
    } else if (url.pathname === `${DAILY_PATH}/profile`) {
      response = await profile(request, env, session);
    } else {
      response = apiError('not_found', 'Not found.', 404);
    }
  } catch (error) {
    if (error instanceof DailyStoreError
      || error instanceof ChatStoreError
      || error instanceof MemoryStoreError
      || error instanceof ModelRequestError
      || error instanceof OwnerAccessError) {
      response = apiError(error.type, error.message, error.status, error.details || {});
    } else {
      response = unexpectedApiError('daily-api', error, 'daily_store_failed', '小组件操作失败');
    }
  }
  return tagDailyCommentResponse(response, url.pathname);
}