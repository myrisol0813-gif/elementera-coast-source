import { assembleCleanContext } from './context-assemble-clean.js';
import {
  createConversation,
  getConversation,
  latestConversationByType,
  normalizeState,
  readConversationState,
  readProfile,
  sanitizeId,
  writeConversationState,
} from './chat-store.js';
import { apiModelPartnerIdentity } from './coast-identity.js';
import { saveModelEcho } from './model-metadata-api.js';
import { performFormalChatWithTools } from './models.js';

const TITLES = Object.freeze({
  radio: '共通聊天室',
  lighthouse: 'MCP 对话区',
});

function clip(value, max = 12000) {
  return String(value ?? '').trim().slice(0, max);
}

function activeBranch(turn) {
  const users = Array.isArray(turn?.user?.variants) ? turn.user.variants : [];
  const userIndex = Math.min(Math.max(0, Number(turn?.user?.active || 0)), Math.max(0, users.length - 1));
  const user = users[userIndex] || null;
  const assistants = turn?.assistant?.variantsByUserVariant?.[String(userIndex)] || [];
  const assistantIndex = Math.min(
    Math.max(0, Number(turn?.assistant?.activeByUserVariant?.[String(userIndex)] || 0)),
    Math.max(0, assistants.length - 1),
  );
  return { user, assistant: assistants[assistantIndex] || null };
}

function userMessage(turn, user) {
  if (!user?.content || user.hidden === true) return null;
  return {
    role: 'user',
    content: user.message_source === 'official_mcp'
      ? `[来源：官端 ChatGPT / official_mcp]\n${user.content}`
      : user.content,
    turn_id: turn.id,
    variant_id: user.id || null,
    created_at: user.created_at || null,
    display_author: user.display_author || null,
    message_source: user.message_source || null,
    source_model_label: user.source_model_label || null,
    attachments: Array.isArray(user.attachments) ? user.attachments : [],
  };
}

function assistantMessage(turn, assistant) {
  if (!assistant?.content) return null;
  const furnitureRuns = Array.isArray(assistant.furniture_runs) ? assistant.furniture_runs : [];
  return {
    role: 'assistant',
    content: assistant.content,
    turn_id: turn.id,
    variant_id: assistant.id || null,
    created_at: assistant.created_at || null,
    display_author: assistant.display_author || null,
    model_id: assistant.model_id || null,
    usage: assistant.usage || null,
    finish_reason: assistant.finish_reason || null,
    generation_source: assistant.generation_source || null,
    tool_summary: furnitureRuns,
    has_desk_slip: Boolean(assistant.desk_slip),
  };
}

function activeMessages(state) {
  const messages = [];
  for (const turn of Array.isArray(state?.turns) ? state.turns : []) {
    const branch = activeBranch(turn);
    const user = userMessage(turn, branch.user);
    const assistant = assistantMessage(turn, branch.assistant);
    if (user) messages.push(user);
    if (assistant) messages.push(assistant);
  }
  return messages;
}

function modelContextMessages(state) {
  return activeMessages(state).map((message) => ({
    role: message.role,
    content: message.content,
    turn_id: message.turn_id,
  }));
}

function hostname(value) {
  try {
    return new URL(String(value || '')).hostname.replace(/^www\./, '').slice(0, 80);
  } catch {
    return '';
  }
}

function serverToolFurnitureRuns(serverTools) {
  const search = serverTools?.web_search;
  if (!search?.used) return [];
  const results = Array.isArray(search.results) ? search.results : [];
  const items = results.slice(0, 5).map((item) => ({
    title: clip(item?.title || item?.url || '搜索结果', 100),
    kind: hostname(item?.url) || '公开网络',
  })).filter((item) => item.title);
  return [{
    id: sanitizeId(crypto.randomUUID(), 'server_tool'),
    tool_key: 'server.web_search',
    label: '搜索了公开网络',
    status: 'success',
    count: Math.max(1, Number(search.requests) || 1),
    items,
    extra_count: Math.max(0, results.length - items.length),
  }];
}

function withServerDeskSlip(slip, serverTools) {
  const search = serverTools?.web_search;
  if (!search || typeof search !== 'object') return slip;
  return { ...(slip || {}), web_search: search };
}

async function resolveConversation(db, roomType, conversationId = '') {
  if (conversationId) {
    const conversation = await getConversation(db, sanitizeId(conversationId, 'conversation'));
    if (conversation.room_type !== roomType) {
      const error = new Error(`conversation is ${conversation.room_type}, expected ${roomType}`);
      error.type = 'room_type_mismatch';
      error.status = 409;
      throw error;
    }
    return conversation;
  }
  return await latestConversationByType(db, roomType)
    || await createConversation(db, TITLES[roomType] || '新聊天', roomType);
}

function existingTurnByVariantId(state, variantId) {
  return (Array.isArray(state?.turns) ? state.turns : []).find((turn) =>
    (Array.isArray(turn?.user?.variants) ? turn.user.variants : []).some((variant) => variant.id === variantId));
}

export async function appendRoomMessage(db, roomType, value = {}) {
  const conversation = await resolveConversation(db, roomType, value.conversation_id);
  const state = await readConversationState(db, conversation.id);
  const toolCallId = clip(value.tool_call_id, 160);
  const variantId = toolCallId ? sanitizeId(toolCallId, 'external_user') : sanitizeId(crypto.randomUUID(), 'external_user');
  const existing = existingTurnByVariantId(state, variantId);
  if (existing) {
    return { conversation, state, turn: existing, idempotent: true };
  }

  const body = roomType === 'lighthouse'
    ? [clip(value.subject, 180), clip(value.body ?? value.text, 40000)].filter(Boolean).join('\n\n')
    : clip(value.text, 12000);
  if (!body) {
    const error = new Error('消息正文不能为空。');
    error.type = 'empty_room_message';
    error.status = 400;
    throw error;
  }

  const createdAt = new Date().toISOString();
  const turnId = sanitizeId(crypto.randomUUID(), `${roomType}_turn`);
  const source = value.message_source === 'official_mcp' ? 'official_mcp' : 'owner_web';
  const turn = {
    id: turnId,
    user: {
      active: 0,
      variants: [{
        id: variantId,
        content: body,
        created_at: createdAt,
        message_source: source,
        ...(value.display_author ? { display_author: clip(value.display_author, 180) } : {}),
        ...(value.model_label ? { source_model_label: clip(value.model_label, 180) } : {}),
      }],
    },
    assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: { 0: [] } },
  };
  state.turns.push(turn);
  state.turns = state.turns.slice(-100);
  state.updated_at = createdAt;
  const saved = await writeConversationState(db, conversation.id, state);
  return { conversation: await getConversation(db, conversation.id), state: saved, turn, idempotent: false };
}

export async function listRoomConversation(db, roomType, value = {}) {
  const conversation = await resolveConversation(db, roomType, value.conversation_id);
  const state = await readConversationState(db, conversation.id);
  return {
    conversation,
    messages: activeMessages(state),
  };
}

async function sendOfficialRoomMessage(env, roomType, value = {}) {
  const db = env.COAST_CHAT_DB;
  const identity = value.identity || {};
  const appended = await appendRoomMessage(db, roomType, {
    conversation_id: value.conversation_id,
    ...(roomType === 'lighthouse'
      ? { subject: value.subject, body: value.body ?? value.text }
      : { text: value.text }),
    tool_call_id: value.tool_call_id,
    message_source: 'official_mcp',
    display_author: identity.display_author || value.display_author || 'ChatGPT≋',
    model_label: identity.model_label || value.model_label,
  });
  const turn = appended.turn;
  const userVariant = turn.user.variants[0];
  if (appended.idempotent && turn.assistant.variantsByUserVariant?.['0']?.length) {
    return {
      conversation: appended.conversation,
      turn,
      assistant: turn.assistant.variantsByUserVariant['0'][0],
      idempotent: true,
    };
  }

  const profile = await readProfile(db);
  const model = clip(value.model || profile.current_chat_model, 180);
  if (!model) {
    const error = new Error(`主页还没有选中可用于${TITLES[roomType] || roomType}的模型。`);
    error.type = `missing_${roomType}_model`;
    error.status = 400;
    throw error;
  }
  const messages = modelContextMessages(appended.state);
  const lastUser = messages.at(-1);
  const assembled = await assembleCleanContext(env, {
    surface: roomType,
    conversationId: appended.conversation.id,
    sourceTurnId: turn.id,
    messages,
    lastUser,
    settings: value.settings || {},
    localDate: value.local_date,
    localDateTime: value.local_datetime,
    model,
    permission: 'owner',
  });
  const generated = await performFormalChatWithTools(env, {
    model,
    messages: assembled.modelMessages,
    settings: value.settings || {},
    tools: assembled.tools,
    web_search_query: lastUser?.content || '',
  }, {
    allowSystem: assembled.modelMessages[0]?.role === 'system',
    executeTool: assembled.executeTool,
    captureMetadata: true,
  });
  const text = clip(generated?.message?.content, 12000);
  if (!text) {
    const error = new Error(`API 模型伙伴没有生成可写入${TITLES[roomType] || roomType}的回复。`);
    error.type = `empty_${roomType}_reply`;
    error.status = 502;
    throw error;
  }

  const identityReply = apiModelPartnerIdentity({ model_label: generated.model || model });
  const deskSlip = withServerDeskSlip(assembled.deskSlip(), generated.server_tools);
  const furnitureRuns = [
    ...assembled.furnitureRuns(),
    ...serverToolFurnitureRuns(generated.server_tools),
  ].slice(0, 16);
  const assistant = {
    id: sanitizeId(crypto.randomUUID(), `${roomType}_assistant`),
    content: text,
    created_at: new Date().toISOString(),
    model_id: generated.model || model,
    usage: generated.usage || undefined,
    finish_reason: generated.finish_reason || undefined,
    generation_source: roomType,
    furniture_runs: furnitureRuns,
    desk_slip: deskSlip,
    display_author: identityReply.display_author,
  };
  turn.assistant.variantsByUserVariant['0'] = [assistant];
  turn.assistant.activeByUserVariant['0'] = 0;
  const nextState = normalizeState(appended.state);
  const target = nextState.turns.find((item) => item.id === turn.id);
  if (target) {
    target.assistant.variantsByUserVariant['0'] = [assistant];
    target.assistant.activeByUserVariant['0'] = 0;
  }
  const saved = await writeConversationState(db, appended.conversation.id, nextState);
  const savedAssistant = saved.turns
    .find((item) => item.id === turn.id)
    ?.assistant?.variantsByUserVariant?.['0']?.[0] || assistant;
  const modelEcho = await saveModelEcho(env, appended.conversation.id, savedAssistant.id, generated.model_metadata);
  return {
    conversation: await getConversation(db, appended.conversation.id),
    history: saved,
    turn: saved.turns.find((item) => item.id === turn.id) || target || turn,
    assistant: savedAssistant,
    model: generated.model || model,
    usage: generated.usage || null,
    finish_reason: generated.finish_reason || null,
    memory_records: assembled.selected_memory_ids.length,
    furniture_runs: furnitureRuns,
    desk_slip: deskSlip,
    tool_results: Array.isArray(generated.tool_results) ? generated.tool_results : [],
    model_echo_status: modelEcho.status || (modelEcho.ok ? 'saved' : 'not_returned'),
    idempotent: false,
    source: userVariant.message_source,
  };
}

export async function sendOfficialRadioMessage(env, value = {}) {
  return sendOfficialRoomMessage(env, 'radio', value);
}

export async function sendOfficialLighthouseMessage(env, value = {}) {
  return sendOfficialRoomMessage(env, 'lighthouse', value);
}

export async function writeOfficialLighthouseMessage(db, value = {}) {
  const identity = value.identity || {};
  return appendRoomMessage(db, 'lighthouse', {
    conversation_id: value.conversation_id,
    subject: value.subject,
    body: value.body ?? value.text,
    tool_call_id: value.tool_call_id,
    message_source: 'official_mcp',
    display_author: identity.display_author || value.display_author || 'ChatGPT≋',
    model_label: identity.model_label || value.model_label,
  });
}
