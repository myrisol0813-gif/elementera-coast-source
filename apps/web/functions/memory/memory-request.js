import { sanitizeId } from '../chat-store.js';
import { readJson, requestBodyError } from '../http.js';
import { MemoryStoreError } from '../memory-store.js';

export const BODY_LIMIT = 48 * 1024;

export async function body(request) {
  try {
    return await readJson(request, BODY_LIMIT);
  } catch (error) {
    const mapped = requestBodyError(error, {
      invalidType: 'invalid_request',
      invalidMessage: '请求体不是有效的 JSON。',
      tooLargeMessage: '请求体过大。',
    });
    throw new MemoryStoreError(mapped.type, mapped.message, mapped.status);
  }
}

export function conversationIdFrom(url, value = {}) {
  return sanitizeId(value.conversation_id || url.searchParams.get('conversation_id') || '', 'conversation');
}

export function memorySuffix(pathname, base) {
  return decodeURIComponent(pathname.slice(base.length).replace(/^\//, ''));
}
