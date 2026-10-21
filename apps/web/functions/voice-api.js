import { VoiceClipError, VOICE_LIMITS, generateVoiceClip, listVoiceClips, voiceClipAudio } from './voice-clips.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import { apiError, json, methodNotAllowed, readJson, requestBodyError, securityHeaders, unexpectedApiError } from './http.js';

const BASE = '/api/voice/clips';
export function isVoiceApiPath(path) { return path === BASE || path.startsWith(`${BASE}/`); }
async function route(request, env, session) {
  requireOwnerSession(session);
  const url = new URL(request.url);
  const rest = url.pathname.slice(BASE.length);
  if (!rest) {
    if (request.method === 'GET') {
      const conversationId = url.searchParams.get('conversation_id') || '';
      if (!conversationId) return apiError('conversation_required', '请选择聊天窗口。');
      return json({ ok: true, clips: await listVoiceClips(env.COAST_CHAT_DB, conversationId), limits: VOICE_LIMITS });
    }
    if (request.method === 'POST') {
      const body = await readJson(request, 16 * 1024);
      if (!body.message_id) return apiError('message_required', '请从原助手消息选择段落生成语音。');
      const clip = await generateVoiceClip(env.COAST_CHAT_DB, env, {
        conversation_id: body.conversation_id,
        message_id: body.message_id,
        paragraph_indices: body.paragraph_indices,
      }, { surface: 'manual' });
      return json({ ok: true, clip, limits: VOICE_LIMITS }, 201);
    }
    return methodNotAllowed('GET, POST');
  }
  const match = /^\/([\w-]+)\/audio$/.exec(rest);
  if (match && request.method === 'GET') {
    const bytes = await voiceClipAudio(env.COAST_CHAT_DB, match[1]);
    return new Response(bytes, { status: 200, headers: securityHeaders({
      'Content-Type': 'audio/mpeg', 'Content-Length': String(bytes.length),
      'Content-Disposition': 'inline; filename="coast-voice.mp3"',
    }) });
  }
  return apiError('not_found', 'Not found.', 404);
}
export async function routeVoiceApi(request, env, session) {
  try { return await route(request, env, session); }
  catch (error) {
    if (error instanceof VoiceClipError || error instanceof OwnerAccessError) {
      return apiError(error.type, error.message, error.status);
    }
    if (['invalid_json', 'body_too_large'].includes(error?.message)) {
      const mapped = requestBodyError(error, { invalidMessage: '语音请求内容无效。', tooLargeMessage: '语音请求超过 16 KB。' });
      return apiError(mapped.type, mapped.message, mapped.status);
    }
    return unexpectedApiError('voice-api', error, 'voice_failed', '语音暂时无法完成');
  }
}
