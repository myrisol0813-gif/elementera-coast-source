import {
  apiError,
  json,
  methodNotAllowed,
  readJson,
  requestBodyError,
  unexpectedApiError,
} from './http.js';
import { ChatStoreError, sanitizeId } from './chat-store.js';
import {
  importRikkaHubConversation,
  listRikkaHubAttachments,
  readRikkaHubAttachment,
} from './rikkahub-import-store.js';

const ROOT = '/api/rikkahub';
const IMPORT_BODY_LIMIT = 14 * 1024 * 1024;

async function body(request) {
  try {
    return await readJson(request, IMPORT_BODY_LIMIT);
  } catch (error) {
    const mapped = requestBodyError(error, {
      invalidType: 'invalid_rikkahub_import',
      invalidMessage: 'RikkaHub 导入包不是有效 JSON。',
      tooLargeMessage: '单个 RikkaHub 窗口导入数据过大。',
    });
    throw new ChatStoreError(mapped.type, mapped.message, mapped.status);
  }
}

function attachmentResponse(value) {
  return new Response(value.bytes, {
    headers: {
      'Content-Type': value.mime_type || 'application/octet-stream',
      'Content-Length': String(value.byte_length || value.bytes.byteLength || 0),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(value.filename || 'attachment')}`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function isRikkaHubApiPath(pathname) {
  return pathname === ROOT || pathname.startsWith(`${ROOT}/`);
}

export async function routeRikkaHubApi(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  try {
    if (pathname === `${ROOT}/import`) {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      const result = await importRikkaHubConversation(env.COAST_CHAT_DB, await body(request));
      return json({ ok: true, import: result }, 201);
    }

    if (pathname === `${ROOT}/attachments`) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      const conversationId = sanitizeId(url.searchParams.get('conversation_id') || '', 'conversation');
      return json({
        ok: true,
        attachments: await listRikkaHubAttachments(env.COAST_CHAT_DB, conversationId),
      });
    }

    if (pathname.startsWith(`${ROOT}/attachments/`)) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      const attachmentId = decodeURIComponent(pathname.slice(`${ROOT}/attachments/`.length));
      return attachmentResponse(await readRikkaHubAttachment(env.COAST_CHAT_DB, attachmentId));
    }

    return apiError('not_found', 'Not found.', 404);
  } catch (error) {
    if (error instanceof ChatStoreError) return apiError(error.type, error.message, error.status);
    return unexpectedApiError('rikkahub-api', error, 'rikkahub_import_failed', 'RikkaHub 聊天导入操作失败');
  }
}
