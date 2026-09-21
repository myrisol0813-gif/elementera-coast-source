import {
  apiError,
  json,
  methodNotAllowed,
  readJson,
  requestBodyError,
  sameOrigin,
  unexpectedApiError,
} from './http.js';
import {
  DogtalkStoreError,
} from './dogtalk-store.js';
import {
  ChatAttachmentError,
  applyChatAttachmentsToMessages,
  attachmentDeskReceipt,
  deleteChatAttachment,
  getChatAttachmentRecord,
  resolveChatAttachmentsForModel,
  uploadChatAttachment,
} from './chat-attachments.js';
import {
  assembleCleanContext,
} from './context-assemble-clean.js';
import { estimateContextTokens as estimateTokens } from './context-comfort-range.js';
import { executeRegisteredTool } from './tool-registry.js';
import { encodeSseEvent } from './stream-format.js';
import {
  ModelRequestError,
  modelErrorResponse,
  performFormalChat,
  performFormalChatStream,
  performFormalChatWithTools,
} from './models.js';
import {
  deleteModelEchoesForConversation,
  modelMetadataApi,
  saveModelEcho,
} from './model-metadata-api.js';
import {
  ChatStoreError,
  createConversation,
  deleteConversation,
  getConversation,
  hasChatDatabase,
  isDefaultTitle,
  listConversations,
  normalizeProfile,
  readLandingStatus,
  readConversationState,
  readProfile,
  renameConversation,
  sanitizeId,
  sanitizeTitle,
  setGeneratedTitle,
  writeConversationState,
  writeLandingExchange,
  writeProfile,
} from './chat-store.js';

const BODY_LIMIT = 2 * 1024 * 1024;
const CONVERSATIONS_PATH = '/api/chat/conversations';
const FORMAL_CHAT_PATH = '/api/chat';
const LANDING_LETTER_PATH = '/api/chat/landing-letter';
const MODEL_METADATA_PATH = '/api/chat/message-metadata';
const ATTACHMENTS_PATH = '/api/chat/attachments';

function conversationSurface(roomType) {
  if (roomType === 'radio') return 'radio';
  if (roomType === 'lighthouse') return 'lighthouse';
  return 'main_chat';
}

async function body(request) {
  try {
    return await readJson(request, BODY_LIMIT);
  } catch (error) {
    const mapped = requestBodyError(error, {
      invalidType: 'invalid_request',
      invalidMessage: '请求体不是有效的 JSON。',
      tooLargeMessage: '请求体过大。',
    });
    throw new ChatStoreError(mapped.type, mapped.message, mapped.status);
  }
}

function requireSameOrigin(request) {
  if (!sameOrigin(request)) throw new ChatStoreError('forbidden', 'Forbidden.', 403);
}

function localDate(value) {
  const clean = String(value || '').trim();
  const parsed = new Date(`${clean}T00:00:00.000Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)
    && !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === clean) {
    return clean;
  }
  return new Date().toISOString().slice(0, 10);
}

async function conversations(request, env, pathname) {
  const suffix = decodeURIComponent(pathname.slice(CONVERSATIONS_PATH.length).replace(/^\//, ''));
  if (!suffix) {
    if (request.method === 'GET') return json({ ok: true, conversations: await listConversations(env.COAST_CHAT_DB) });
    if (request.method === 'POST') {
      requireSameOrigin(request);
      const value = await body(request);
      return json({ ok: true, conversation: await createConversation(env.COAST_CHAT_DB, value.title || '新聊天', value.room_type || 'main') }, 201);
    }
    return methodNotAllowed('GET, POST');
  }

  const conversationId = sanitizeId(suffix.split('/')[0], 'conversation');
  if (request.method === 'PATCH') {
    requireSameOrigin(request);
    const value = await body(request);
    return json({ ok: true, conversation: await renameConversation(env.COAST_CHAT_DB, conversationId, value.title || '新聊天') });
  }
  if (request.method === 'DELETE') {
    requireSameOrigin(request);
    const deleted = await deleteConversation(env.COAST_CHAT_DB, conversationId);
    await deleteModelEchoesForConversation(env, conversationId);
    return json({ ok: true, conversation: deleted, deleted: true });
  }
  return methodNotAllowed('PATCH, DELETE');
}

async function attachments(request, env, pathname) {
  const suffix = decodeURIComponent(pathname.slice(ATTACHMENTS_PATH.length).replace(/^\//, ''));
  const url = new URL(request.url);
  const conversationId = sanitizeId(
    request.method === 'POST'
      ? 'pending'
      : (url.searchParams.get('conversation_id') || ''),
    'conversation',
  );

  if (!suffix) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    requireSameOrigin(request);
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > 10 * 1024 * 1024) {
      throw new ChatAttachmentError('file_too_large', '附件请求体超过当前上传上限。', 413);
    }
    let form;
    try {
      form = await request.formData();
    } catch {
      throw new ChatAttachmentError('attachment_form_invalid', '附件上传请求无法读取。', 400);
    }
    const targetConversationId = sanitizeId(form.get('conversation_id') || '', 'conversation');
    const file = form.get('file');
    const attachment = await uploadChatAttachment(env.COAST_CHAT_DB, targetConversationId, file);
    return json({ ok: true, attachment }, 201);
  }

  const attachmentId = sanitizeId(suffix.split('/')[0], 'attachment');
  const targetConversationId = sanitizeId(url.searchParams.get('conversation_id') || '', 'conversation');
  if (request.method === 'GET') {
    const row = await getChatAttachmentRecord(env.COAST_CHAT_DB, targetConversationId, attachmentId);
    const inline = row.kind === 'image';
    const safeName = String(row.name || 'attachment').replace(/[\r\n"]/g, '_');
    return new Response(row.data, {
      headers: {
        'Content-Type': row.mime || 'application/octet-stream',
        'Content-Length': String(row.size || 0),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  if (request.method === 'DELETE') {
    requireSameOrigin(request);
    const result = await deleteChatAttachment(env.COAST_CHAT_DB, targetConversationId, attachmentId);
    return json({ ok: true, ...result });
  }
  return methodNotAllowed('GET, DELETE');
}

async function history(request, env) {
  const conversationId = sanitizeId(new URL(request.url).searchParams.get('conversation_id') || '', 'conversation');
  if (request.method === 'GET') {
    const value = await readConversationState(env.COAST_CHAT_DB, conversationId);
    return json({ ok: true, source: 'd1-json-v4', history: { ...value, conversation_id: conversationId } });
  }
  if (request.method === 'PUT') {
    requireSameOrigin(request);
    const value = await writeConversationState(env.COAST_CHAT_DB, conversationId, await body(request));
    return json({ ok: true, source: 'd1-json-v4', history: { ...value, conversation_id: conversationId } });
  }
  return methodNotAllowed('GET, PUT');
}

async function profile(request, env) {
  const db = env.COAST_CHAT_DB;
  if (request.method === 'GET') return json({ ok: true, profile: await readProfile(db) });
  if (request.method === 'PUT') {
    requireSameOrigin(request);
    const value = await body(request);
    const payload = value.profile || value;
    await writeProfile(db, normalizeProfile(payload));
    return json({ ok: true, profile: await readProfile(db) });
  }
  return methodNotAllowed('GET, PUT');
}

export function clipGeneratedTitle(value) {
  return Array.from(sanitizeTitle(value, '新聊天')).slice(0, 12).join('');
}

async function generatedTitle(env, user, assistant) {
  const prompt = `为下面这轮对话生成一个简短中文标题，12字以内，不要引号，不要句号，不要解释。\n用户：${String(user || '').slice(0, 1000)}\n助手：${String(assistant || '').slice(0, 1000)}`;
  const result = await performFormalChat(env, {
    model: 'openai/gpt-4.1-nano',
    messages: [{ role: 'user', content: prompt }],
    settings: { max_tokens: 40, temperature: 0.2 },
  });
  return {
    title: clipGeneratedTitle(result?.message?.content || ''),
    model_id: String(result?.model || 'openai/gpt-4.1-nano').slice(0, 180),
  };
}

async function title(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  requireSameOrigin(request);
  const value = await body(request);
  const conversationId = sanitizeId(value.conversation_id || '', 'conversation');
  const conversation = await getConversation(env.COAST_CHAT_DB, conversationId);
  if (conversation.title_manual || conversation.title_generated_at || !isDefaultTitle(conversation.title)) {
    return json({ ok: true, skipped: true });
  }
  let generated;
  try {
    generated = await generatedTitle(env, value.user, value.assistant);
  } catch {
    return json({ ok: true, skipped: true, reason: 'title_generation_failed' });
  }
  return json({
    ok: true,
    conversation: await setGeneratedTitle(env.COAST_CHAT_DB, conversationId, generated.title, generated.model_id),
  });
}

function safeStreamError(error, crossWindow = null) {
  const value = error instanceof ModelRequestError
    ? { type: error.type, message: error.message }
    : { type: String(error?.type || 'stream_error'), message: String(error?.message || '流式生成中断，请稍后重试。') };
  if (!crossWindow) return value;
  return { ...value, details: { cross_window: crossWindow } };
}

function crossWindowFailureReason(type) {
  if (type === 'context_length_exceeded') return 'provider_context_limit';
  if (type === 'request_body_too_large' || type === 'body_too_large') return 'provider_body_limit';
  if (type === 'provider_timeout') return 'provider_timeout';
  if (type === 'stream_incomplete') return 'stream_incomplete';
  if (type === 'empty_model_reply') return 'empty_model_reply';
  return 'provider_error';
}

function estimatedModelTokens(assembled) {
  return (Array.isArray(assembled?.modelMessages) ? assembled.modelMessages : [])
    .reduce((sum, message) => sum + estimateTokens(message?.content || '') + 4, 0);
}

function pendingCrossWindowDeskSlip(assembled) {
  const slip = assembled.deskSlip();
  const section = slip?.cross_window;
  if (!section || section.mode === 'off') return slip;
  const loadedTurns = Math.max(0, Number(section.loaded_turns ?? section.total_loaded_turns ?? section.total_delivered_turns) || 0);
  const loadedChars = Math.max(0, Number(section.loaded_chars ?? section.delivered_to_model_chars) || 0);
  return {
    ...slip,
    comfort: loadedTurns > 0 ? '跨窗口已按请求装载，正在递给模型' : slip.comfort,
    cross_window: {
      ...section,
      status: loadedTurns > 0 ? '正在递送' : section.status,
      delivered: false,
      attempted_delivered_turns: loadedTurns,
      attempted_chars: loadedChars,
      delivered_to_model_turns: 0,
      delivered_to_model_chars: 0,
      total_delivered_turns: 0,
      failure_reason: null,
    },
  };
}

function failedCrossWindowDeskSlip(assembled, error) {
  const slip = assembled.deskSlip();
  const section = slip?.cross_window;
  if (!section || section.mode === 'off') return slip;
  const requestedTurns = Math.max(0, Number(section.requested_turns ?? section.total_requested_turns) || 0);
  const loadedTurns = Math.max(0, Number(section.loaded_turns ?? section.total_loaded_turns ?? section.total_delivered_turns) || 0);
  const loadedChars = Math.max(0, Number(section.loaded_chars ?? section.delivered_to_model_chars) || 0);
  const type = String(error?.type || 'stream_error').slice(0, 120);
  const message = String(error?.message || '模型请求失败。').slice(0, 500);
  const failureReason = crossWindowFailureReason(type);
  const summary = `requested_turns=${requestedTurns}; loaded_turns=${loadedTurns}; attempted_delivered_turns=${loadedTurns}; attempted_chars=${loadedChars}; ${type}: ${message}`;
  return {
    ...slip,
    comfort: '跨窗口没有静默裁剪；完整递送尝试失败',
    cross_window: {
      ...section,
      status: '递送失败',
      delivered: false,
      requested_turns: requestedTurns,
      loaded_turns: loadedTurns,
      attempted_delivered_turns: loadedTurns,
      attempted_chars: loadedChars,
      attempted_estimated_tokens: estimatedModelTokens(assembled),
      delivered_to_model_turns: 0,
      delivered_to_model_chars: 0,
      total_delivered_turns: 0,
      trimmed: false,
      trim_reason: '',
      failure_reason: failureReason,
      provider_error_type: type,
      provider_error_message: message,
      error: summary,
      sources: Array.isArray(section.sources) ? section.sources.map((source) => ({
        ...source,
        delivered_to_model_turns: 0,
        delivered_turns: 0,
      })) : [],
    },
  };
}

function withRuntimeDeskSlip(slip, { attachments = null, serverTools = null } = {}) {
  const webSearch = serverTools?.web_search && typeof serverTools.web_search === 'object'
    ? serverTools.web_search
    : null;
  if (!attachments && !webSearch) return slip;
  return {
    ...(slip || {}),
    ...(attachments ? { attachments } : {}),
    ...(webSearch ? { web_search: webSearch } : {}),
  };
}

function safeFailureMetadata(model, settings, { stream = false, error = null, aborted = false } = {}) {
  const safeSettings = settings && typeof settings === 'object' ? settings : {};
  const number = (value) => {
    if (value == null || value === '') return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };
  return {
    status: 'saved',
    sanitized: true,
    metadata: {
      requested_model: String(model || '').slice(0, 180) || null,
      resolved_model: null,
      provider: 'openrouter',
      provider_route: null,
      reasoning_text: null,
      reasoning_summary: null,
      reasoning_details: null,
      reasoning_encrypted_content_present: false,
      reasoning_encrypted_content_length: null,
      reasoning_encrypted_content_digest: null,
      reasoning_status: 'not_returned',
      usage: null,
      finish_reason: aborted ? 'cancelled' : 'error',
      native_finish_reason: null,
      is_stream: Boolean(stream),
      is_aborted: Boolean(aborted),
      is_timeout: String(error?.type || '') === 'provider_timeout',
      error_summary: aborted ? null : String(error?.message || '模型请求失败。').slice(0, 1200),
      tool_calls: null,
      tool_results: null,
      request: {
        temperature: number(safeSettings.temperature),
        top_p: number(safeSettings.top_p),
        max_tokens: number(safeSettings.max_tokens ?? safeSettings.maxOutputTokens),
        reasoning_effort: typeof safeSettings.reasoning_effort === 'string' ? safeSettings.reasoning_effort.slice(0, 120) : null,
        reasoning_max_tokens: number(safeSettings.reasoning_max_tokens),
        stream: Boolean(stream),
        response_format: null,
      },
    },
    raw_metadata_sanitized: null,
  };
}

function streamFormalChat(request, env, input, assembled, metadataContext, dogtalkSubmission = null, attachmentReceipt = null, modelMessages = null) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let metadataCaptured = false;
      let serverTools = null;
      const pendingSlip = withRuntimeDeskSlip(pendingCrossWindowDeskSlip(assembled), { attachments: attachmentReceipt });
      if (pendingSlip?.cross_window?.mode !== 'off' || attachmentReceipt) {
        controller.enqueue(encoder.encode(encodeSseEvent('desk_slip', pendingSlip)));
      }
      try {
        for await (const item of performFormalChatStream(env, {
          model: input.model,
          messages: modelMessages || assembled.modelMessages,
          settings: input.settings,
          tools: assembled.tools,
          web_search_query: input.web_search_query,
        }, {
          allowSystem: assembled.modelMessages[0]?.role === 'system',
          signal: request.signal,
          executeTool: assembled.executeTool,
          onMetadata: async (snapshot) => {
            metadataCaptured = true;
            await saveModelEcho(env, metadataContext.conversationId, metadataContext.messageId, snapshot);
          },
        })) {
          if (item.event === 'server_tools') serverTools = item.data && typeof item.data === 'object' ? item.data : null;
          const data = item.event === 'meta' && metadataContext.messageId
            ? { ...item.data, message_id: metadataContext.messageId }
            : item.data;
          controller.enqueue(encoder.encode(encodeSseEvent(item.event, data)));
        }
        controller.enqueue(encoder.encode(encodeSseEvent('furniture_runs', assembled.furnitureRuns())));
        controller.enqueue(encoder.encode(encodeSseEvent('desk_slip', withRuntimeDeskSlip(assembled.deskSlip(), {
          attachments: attachmentReceipt,
          serverTools,
        }))));
      } catch (error) {
        if (!metadataCaptured) {
          await saveModelEcho(env, metadataContext.conversationId, metadataContext.messageId, safeFailureMetadata(
            input.model,
            input.settings,
            { stream: true, error, aborted: error?.name === 'AbortError' },
          ));
        }
        if (error?.name !== 'AbortError') {
          const failedSlip = withRuntimeDeskSlip(failedCrossWindowDeskSlip(assembled, error), {
            attachments: attachmentReceipt,
            serverTools,
          });
          if (failedSlip?.cross_window?.mode !== 'off' || attachmentReceipt) {
            controller.enqueue(encoder.encode(encodeSseEvent('desk_slip', failedSlip)));
          }
          controller.enqueue(encoder.encode(encodeSseEvent('error', safeStreamError(error, failedSlip?.cross_window))));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'X-Coast-Memory-Selected': JSON.stringify(assembled.selected_memory_ids || []),
      'X-Coast-Dogtalk-Snapshot': dogtalkSubmission?.snapshot?.id || '',
      'X-Coast-Message-Id': metadataContext.messageId || '',
    },
  });
}

async function formalChat(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  requireSameOrigin(request);
  const value = await body(request);
  const conversationId = sanitizeId(value.conversation_id || '', 'conversation');
  const rawMessageId = String(value.message_id || '').trim();
  const messageId = rawMessageId ? sanitizeId(rawMessageId, 'assistant_variant') : null;
  const sourceTurnId = value.source_turn_id
    ? sanitizeId(value.source_turn_id, 'turn')
    : null;
  const conversation = await getConversation(env.COAST_CHAT_DB, conversationId);
  if (conversation.room_type === 'lighthouse') {
    throw new ChatStoreError('lighthouse_generation_disabled', 'MCP 对话区只保存文字，不触发 API 模型伙伴回复。', 409);
  }
  const requestSettings = formalChatRequestSettings(value.settings || {});
  const messages = Array.isArray(value.messages) ? value.messages : [];
  const lastUser = [...messages].reverse().find((message) => message?.role === 'user' && typeof message.content === 'string');
  if (!lastUser || messages.at(-1)?.role !== 'user') {
    throw new ChatStoreError('invalid_request', '当前用户消息必须位于请求末尾。', 400);
  }
  let dogtalkSubmission = null;
  if (value.dogtalk && typeof value.dogtalk === 'object' && !Array.isArray(value.dogtalk)) {
    if (!sourceTurnId) {
      throw new ChatStoreError('dogtalk_turn_required', '私人草稿需要跟随当前消息轮次。', 400);
    }
    dogtalkSubmission = await executeRegisteredTool(env.COAST_CHAT_DB, 'dogtalk.save', value.dogtalk, {
      actor: 'owner',
      permission: 'owner',
      surface: conversationSurface(conversation.room_type),
      room_scope: 'conversation',
      conversation_id: conversationId,
      source_turn_id: sourceTurnId,
    });
  }

  const assembled = await assembleCleanContext(env, {
    conversationId,
    sourceTurnId,
    messages,
    lastUser,
    settings: requestSettings,
    localDate: localDate(value.local_date),
    localDateTime: value.local_datetime,
    surface: conversationSurface(conversation.room_type),
    recentEntryIds: value.recent_entry_ids,
    model: value.model,
    permission: 'owner',
    initialFurniture: dogtalkSubmission ? ['收好一张私人草稿纸条'] : [],
    crossWindow: value.cross_window,
  });
  const attachmentIds = (Array.isArray(value.attachment_ids) ? value.attachment_ids : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 12);
  const resolvedAttachments = attachmentIds.length
    ? await resolveChatAttachmentsForModel(env, env.COAST_CHAT_DB, {
      conversationId,
      turnId: sourceTurnId,
      attachmentIds,
      modelId: value.model,
    })
    : null;
  const attachmentReceipt = attachmentDeskReceipt(resolvedAttachments);
  const modelMessages = resolvedAttachments
    ? applyChatAttachmentsToMessages(assembled.modelMessages, resolvedAttachments)
    : assembled.modelMessages;
  if (value.stream === true) {
    return streamFormalChat(request, env, {
      model: value.model,
      settings: requestSettings,
      web_search_query: lastUser.content,
    }, assembled, { conversationId, messageId }, dogtalkSubmission, attachmentReceipt, modelMessages);
  }
  let result;
  try {
    result = await performFormalChatWithTools(env, {
      model: value.model,
      messages: modelMessages,
      settings: requestSettings,
      tools: assembled.tools,
      web_search_query: lastUser.content,
    }, {
      allowSystem: assembled.modelMessages[0]?.role === 'system',
      executeTool: assembled.executeTool,
      captureMetadata: true,
    });
  } catch (error) {
    await saveModelEcho(env, conversationId, messageId, safeFailureMetadata(value.model, requestSettings, { error }));
    if (error instanceof ModelRequestError) {
      const failedSlip = withRuntimeDeskSlip(failedCrossWindowDeskSlip(assembled, error), {
        attachments: attachmentReceipt,
      });
      error.details = {
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
        ...(failedSlip?.cross_window?.mode !== 'off' ? { cross_window: failedSlip.cross_window } : {}),
        ...((failedSlip?.cross_window?.mode !== 'off' || attachmentReceipt) ? { desk_slip: failedSlip } : {}),
      };
    }
    throw error;
  }
  const metadataSave = await saveModelEcho(env, conversationId, messageId, result.model_metadata);
  const { model_metadata: _modelMetadata, ...publicResult } = result;
  return json({
    ...publicResult,
    ...(messageId ? { message_id: messageId } : {}),
    model_metadata_status: metadataSave.status,
    max_tokens: requestSettings.max_tokens ?? null,
    memory: {
      selected_entry_ids: assembled.selected_memory_ids,
      dogtalk_snapshot_id: dogtalkSubmission?.snapshot?.id || null,
      vector_enabled: assembled.vector_enabled,
    },
    furniture_runs: assembled.furnitureRuns(),
    desk_slip: withRuntimeDeskSlip(assembled.deskSlip(), {
      attachments: attachmentReceipt,
      serverTools: result.server_tools,
    }),
  });
}

function normalizeRecentTurns(value) {
  if (value == null || value === '') return 8;
  const number = Number(value);
  if (!Number.isFinite(number)) return 8;
  return Math.max(1, Math.trunc(number));
}

function requestSettingsWithOutputFloor(rawSettings, fallbackLength = '') {
  const settings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const normalized = { ...settings, recentTurns: normalizeRecentTurns(settings.recentTurns) };
  const outputLength = ['short', 'auto', 'long'].includes(settings.outputLength)
    ? settings.outputLength
    : fallbackLength;
  if (!outputLength) return normalized;
  if (outputLength !== 'short') return { ...normalized, max_tokens: null };
  return { ...normalized, max_tokens: 700 };
}

export function formalChatRequestSettings(rawSettings = {}) {
  return requestSettingsWithOutputFloor(rawSettings);
}

export function landingRequestSettings(rawSettings = {}) {
  return requestSettingsWithOutputFloor(rawSettings, 'auto');
}

export function estimateContextTokens(value) {
  return estimateTokens(value);
}

function activeStateMessages(state) {
  const messages = [];
  for (const turn of Array.isArray(state?.turns) ? state.turns : []) {
    const users = Array.isArray(turn?.user?.variants) ? turn.user.variants : [];
    const userIndex = Math.min(Math.max(0, Number(turn?.user?.active || 0)), Math.max(0, users.length - 1));
    const user = users[userIndex];
    const assistants = turn?.assistant?.variantsByUserVariant?.[String(userIndex)] || [];
    const assistantIndex = Math.min(
      Math.max(0, Number(turn?.assistant?.activeByUserVariant?.[String(userIndex)] || 0)),
      Math.max(0, assistants.length - 1),
    );
    const assistant = assistants[assistantIndex];
    if (user?.content) messages.push({ role: 'user', content: user.content, turn_id: turn.id });
    if (assistant?.content) messages.push({ role: 'assistant', content: assistant.content, turn_id: turn.id });
  }
  return messages;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function landingLetter(request, env) {
  const url = new URL(request.url);
  const conversationId = sanitizeId(url.searchParams.get('conversation_id') || '', 'conversation');
  if (request.method === 'GET') {
    return json({
      ok: true,
      landing: await readLandingStatus(env.COAST_CHAT_DB, conversationId, url.searchParams.get('model') || ''),
    });
  }
  if (request.method !== 'POST') return methodNotAllowed('GET, POST');
  requireSameOrigin(request);
  const value = await body(request);
  const targetConversationId = sanitizeId(value.conversation_id || '', 'conversation');
  const modelId = String(value.model || '').trim().slice(0, 180);
  const letterText = String(value.letter_text || '').slice(0, 12000);
  if (!modelId || !letterText.trim()) {
    throw new ChatStoreError('invalid_request', '请先写好登岛信并选择当前聊天模型。', 400);
  }

  const requestSettings = landingRequestSettings(value.settings || {});
  const state = await readConversationState(env.COAST_CHAT_DB, targetConversationId);
  const messages = [...activeStateMessages(state), { role: 'user', content: letterText }];
  const lastUser = messages.at(-1);
  const assembled = await assembleCleanContext(env, {
    conversationId: targetConversationId,
    messages,
    lastUser,
    settings: requestSettings,
    localDate: localDate(value.local_date),
    localDateTime: value.local_datetime,
    surface: 'landing',
    recentEntryIds: value.recent_entry_ids,
    model: modelId,
    permission: 'owner',
  });
  const generated = await performFormalChatWithTools(env, {
    model: modelId,
    messages: assembled.modelMessages,
    settings: requestSettings,
    tools: assembled.tools,
  }, {
    allowSystem: assembled.modelMessages[0]?.role === 'system',
    executeTool: assembled.executeTool,
    captureMetadata: true,
  });
  const assistantText = generated?.message?.content || '';
  if (!assistantText.trim()) throw new ChatStoreError('empty_model_reply', '模型读完了信，但没有返回文字。', 502);

  const saved = await writeLandingExchange(env.COAST_CHAT_DB, targetConversationId, {
    state,
    model_id: modelId,
    assistant_model_id: generated.model || modelId,
    letter_text: letterText,
    letter_hash: await sha256(letterText),
    assistant_text: assistantText,
    usage: generated.usage,
    finish_reason: generated.finish_reason,
    generation_source: 'landing',
    furniture_runs: assembled.furnitureRuns(),
  });
  const landingMessageId = saved?.assistant?.id || '';
  const metadataSave = landingMessageId
    ? await saveModelEcho(env, targetConversationId, landingMessageId, generated.model_metadata)
    : { status: 'not_returned' };
  return json({
    ok: true,
    assistant: saved.assistant,
    conversation: await getConversation(env.COAST_CHAT_DB, targetConversationId),
    history: { ...saved.state, conversation_id: targetConversationId },
    landing: saved.landing,
    model: generated.model || modelId,
    usage: generated.usage || null,
    finish_reason: generated.finish_reason || null,
    model_metadata_status: metadataSave.status,
    furniture_runs: assembled.furnitureRuns(),
    max_tokens: requestSettings.max_tokens,
    memory: {
      selected_entry_ids: assembled.selected_memory_ids,
      vector_enabled: assembled.vector_enabled,
    },
    desk_slip: assembled.deskSlip(),
  });
}

export function isChatApiPath(pathname) {
  return pathname === FORMAL_CHAT_PATH
    || pathname === ATTACHMENTS_PATH
    || pathname.startsWith(`${ATTACHMENTS_PATH}/`)
    || pathname === LANDING_LETTER_PATH
    || pathname === MODEL_METADATA_PATH
    || pathname === '/api/chat/history'
    || pathname === '/api/chat/profile'
    || pathname === '/api/chat/title'
    || pathname === CONVERSATIONS_PATH
    || pathname.startsWith(`${CONVERSATIONS_PATH}/`);
}

export async function routeChatApi(request, env) {
  if (!hasChatDatabase(env)) return apiError('chat_db_not_configured', '主聊天 D1 存储未配置。', 503);
  const pathname = new URL(request.url).pathname;
  try {
    if (pathname === FORMAL_CHAT_PATH) return await formalChat(request, env);
    if (pathname === ATTACHMENTS_PATH || pathname.startsWith(`${ATTACHMENTS_PATH}/`)) return await attachments(request, env, pathname);
    if (pathname === LANDING_LETTER_PATH) return await landingLetter(request, env);
    if (pathname === MODEL_METADATA_PATH) return await modelMetadataApi(request, env);
    if (pathname === '/api/chat/history') return await history(request, env);
    if (pathname === '/api/chat/profile') return await profile(request, env);
    if (pathname === '/api/chat/title') return await title(request, env);
    return await conversations(request, env, pathname);
  } catch (error) {
    if (error instanceof ModelRequestError) return modelErrorResponse(error);
    if (error instanceof ChatAttachmentError) return apiError(error.type, error.message, error.status, error.details);
    if (error instanceof DogtalkStoreError) return apiError(error.type, error.message, error.status);
    if (error instanceof ChatStoreError) return apiError(error.type, error.message, error.status);
    return unexpectedApiError('chat-api', error, 'chat_store_failed', '主聊天存储操作失败');
  }
}