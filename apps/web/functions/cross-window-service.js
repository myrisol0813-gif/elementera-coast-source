import {
  listConversations,
  readConversationState,
  sanitizeId,
} from './chat-store.js';

export const CROSS_WINDOW_DESCRIPTION = '这是本轮从其他对话窗口取来的近期聊天记录，用来帮你回想自己在别处说过的话；要不要提起，由你按当前对话决定。';

export const CROSS_WINDOW_LIMITS = Object.freeze({
  default_turns: 4,
  technical_max_turns_per_source: 9999,
});

const OWNER_ID = 'owner';
const MODES = new Set(['off', 'manual', 'model_decides', 'keyword']);

function cleanMode(value) {
  const mode = String(value || 'off').trim();
  return MODES.has(mode) ? mode : 'off';
}

function sourceKind(conversation) {
  if (conversation?.source === 'rikkahub') return 'rikkahub';
  if (conversation?.room_type === 'radio') return 'radio';
  if (conversation?.room_type === 'lighthouse') return 'lighthouse';
  return 'coast';
}

function activeVariant(list, active) {
  const values = Array.isArray(list) ? list : [];
  if (!values.length) return null;
  const index = Math.min(Math.max(0, Number(active) || 0), values.length - 1);
  const value = values[index] || null;
  if (!value || value.hidden === true || typeof value.content !== 'string' || !value.content.trim()) return null;
  return value;
}

function activeTurns(state) {
  const out = [];
  for (const turn of Array.isArray(state?.turns) ? state.turns : []) {
    const users = turn?.user?.variants || [];
    const userIndex = Math.min(Math.max(0, Number(turn?.user?.active) || 0), Math.max(0, users.length - 1));
    const user = activeVariant(users, userIndex);
    if (!user) continue;
    const assistants = turn?.assistant?.variantsByUserVariant?.[String(userIndex)] || [];
    const assistant = activeVariant(assistants, turn?.assistant?.activeByUserVariant?.[String(userIndex)]);
    const messages = [{
      role: 'user',
      message_id: user.id || `${turn.id || 'turn'}:user`,
      content: user.content,
      created_at: user.created_at || null,
      ...(user.model_id ? { model_id: String(user.model_id).slice(0, 180) } : {}),
      ...(user.display_author ? { display_author: String(user.display_author).slice(0, 180) } : {}),
    }];
    if (assistant) messages.push({
      role: 'assistant',
      message_id: assistant.id || `${turn.id || 'turn'}:assistant`,
      content: assistant.content,
      created_at: assistant.created_at || null,
      ...(assistant.model_id ? { model_id: String(assistant.model_id).slice(0, 180) } : {}),
      ...(assistant.display_author ? { display_author: String(assistant.display_author).slice(0, 180) } : {}),
    });
    out.push({ turn_id: turn.id || null, messages });
  }
  return out;
}

function crossWindowRequestError(type, message, status = 400) {
  const error = new Error(message);
  error.type = type;
  error.status = status;
  return error;
}

function normalizedTurns(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return CROSS_WINDOW_LIMITS.default_turns;
  const turns = Math.floor(number);
  if (turns > CROSS_WINDOW_LIMITS.technical_max_turns_per_source) {
    throw crossWindowRequestError(
      'cross_window_technical_limit',
      `单窗口请求超过技术保护上限 ${CROSS_WINDOW_LIMITS.technical_max_turns_per_source} 轮。`,
    );
  }
  return turns;
}

function messageChars(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((sum, message) => sum + String(message?.content || '').length, 0);
}

async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}

async function archivedConversationIds(db) {
  const rows = await all(db, `SELECT id FROM conversations
    WHERE user_id = ? AND archived_at IS NOT NULL`, [OWNER_ID]);
  return new Set(rows.map((row) => String(row.id || '')).filter(Boolean));
}

async function eligibleConversations(db) {
  const [conversations, archived] = await Promise.all([
    listConversations(db),
    archivedConversationIds(db),
  ]);
  return conversations.filter((conversation) => !archived.has(conversation.id));
}

async function sourceRecord(db, conversation, currentConversationId = '') {
  let turns = [];
  try {
    turns = activeTurns(await readConversationState(db, conversation.id));
  } catch {
    turns = [];
  }
  const current = conversation.id === currentConversationId;
  const readable = !current && turns.length > 0;
  return {
    conversation_id: conversation.id,
    title: conversation.title,
    room_type: conversation.room_type,
    source: sourceKind(conversation),
    source_window_id: conversation.source_window_id || null,
    updated_at: conversation.updated_at,
    message_count: turns.reduce((sum, turn) => sum + turn.messages.length, 0),
    turn_count: turns.length,
    readable,
    disabled_reason: current
      ? '当前窗口已由最近上下文提供'
      : turns.length
        ? ''
        : '暂无可读取对话',
    _turns: turns,
  };
}

export function crossWindowLimits() {
  return { ...CROSS_WINDOW_LIMITS };
}

export function normalizeCrossWindowRequest(value = {}) {
  const mode = cleanMode(value?.mode);
  const sources = mode === 'manual' && Array.isArray(value?.sources)
    ? value.sources.map((source) => ({
      conversation_id: sanitizeId(source?.conversation_id || '', 'conversation'),
      turns: normalizedTurns(source?.turns),
    }))
    : [];
  const messages = mode === 'manual' && Array.isArray(value?.messages)
    ? value.messages.map((item) => ({
      conversation_id: sanitizeId(item?.conversation_id || '', 'conversation'),
      message_id: String(item?.message_id || '').slice(0, 240),
    })).filter((item) => item.message_id)
    : [];
  return { mode, sources, messages };
}

export async function listCrossWindowSources(db, { currentConversationId = '' } = {}) {
  const current = currentConversationId ? sanitizeId(currentConversationId, 'conversation') : '';
  const conversations = await eligibleConversations(db);
  const records = [];
  for (const conversation of conversations) records.push(await sourceRecord(db, conversation, current));
  return {
    description: CROSS_WINDOW_DESCRIPTION,
    limits: crossWindowLimits(),
    sources: records.map(({ _turns, ...record }) => record),
  };
}

function emptyRead(mode, requestedWindows = 0, requestedTurns = 0) {
  return {
    mode,
    description: CROSS_WINDOW_DESCRIPTION,
    limits: crossWindowLimits(),
    items: [],
    requested_windows: requestedWindows,
    loaded_windows: 0,
    total_requested_turns: requestedTurns,
    total_loaded_turns: 0,
    total_loaded_chars: 0,
    total_delivered_turns: 0,
    total_delivered_chars: 0,
    trimmed: false,
    trim_reason: '',
  };
}

export async function readCrossWindow(db, value = {}) {
  const request = normalizeCrossWindowRequest(value);
  if (request.mode !== 'manual') return emptyRead(request.mode);

  const currentConversationId = value?.current_conversation_id
    ? sanitizeId(value.current_conversation_id, 'conversation')
    : '';
  const available = await eligibleConversations(db);
  if (request.messages.length) {
    const byId = new Map(available.map((conversation) => [conversation.id, conversation]));
    const grouped = new Map();
    for (const item of request.messages) {
      if (item.conversation_id === currentConversationId || !byId.has(item.conversation_id)) continue;
      if (!grouped.has(item.conversation_id)) grouped.set(item.conversation_id, new Set());
      grouped.get(item.conversation_id).add(item.message_id);
    }
    const items = [];
    for (const [conversationId, ids] of grouped) {
      const record = await sourceRecord(db, byId.get(conversationId), currentConversationId);
      if (!record.readable) continue;
      const chosen = [];
      const turnIds = new Set();
      for (const turn of record._turns) {
        for (const message of turn.messages) {
          if (!ids.has(message.message_id)) continue;
          chosen.push({ ...message, turn_id: turn.turn_id });
          turnIds.add(turn.turn_id);
        }
      }
      if (!chosen.length) continue;
      const { _turns, readable, disabled_reason, turn_count, message_count, ...source } = record;
      items.push({
        ...source,
        requested_turns: turnIds.size,
        loaded_turns: turnIds.size,
        delivered_turns: turnIds.size,
        requested_messages: ids.size,
        loaded_messages: chosen.length,
        loaded_chars: messageChars(chosen),
        trimmed: false,
        messages: chosen,
      });
    }
    const loadedTurns = items.reduce((sum, item) => sum + item.loaded_turns, 0);
    const loadedChars = items.reduce((sum, item) => sum + item.loaded_chars, 0);
    const loadedMessages = items.reduce((sum, item) => sum + item.loaded_messages, 0);
    return {
      mode: 'manual', description: CROSS_WINDOW_DESCRIPTION, limits: crossWindowLimits(), items,
      requested_windows: grouped.size, loaded_windows: items.length,
      total_requested_turns: loadedTurns, total_loaded_turns: loadedTurns,
      total_requested_messages: request.messages.length, total_loaded_messages: loadedMessages,
      total_loaded_chars: loadedChars, total_delivered_turns: loadedTurns, total_delivered_chars: loadedChars,
      trimmed: false, trim_reason: '',
    };
  }
  const byId = new Map(available.map((conversation) => [conversation.id, conversation]));
  const seen = new Set();
  const selections = [];
  let totalRequestedTurns = 0;

  for (const requested of request.sources) {
    if (seen.has(requested.conversation_id)) continue;
    seen.add(requested.conversation_id);
    totalRequestedTurns += requested.turns;
    if (requested.conversation_id === currentConversationId) continue;
    const conversation = byId.get(requested.conversation_id);
    if (!conversation) continue;
    selections.push({ conversation, requested_turns: requested.turns });
  }

  const items = [];
  for (const selection of selections) {
    const record = await sourceRecord(db, selection.conversation, currentConversationId);
    if (!record.readable) continue;
    const chosen = record._turns.slice(-selection.requested_turns);
    const messages = chosen.flatMap((turn) => turn.messages.map((message) => ({ ...message })));
    const { _turns, readable, disabled_reason, turn_count, message_count, ...source } = record;
    items.push({
      ...source,
      requested_turns: selection.requested_turns,
      loaded_turns: chosen.length,
      delivered_turns: chosen.length,
      loaded_chars: messageChars(messages),
      trimmed: false,
      messages,
    });
  }

  const loadedTurns = items.reduce((sum, item) => sum + item.loaded_turns, 0);
  const loadedChars = items.reduce((sum, item) => sum + item.loaded_chars, 0);
  return {
    mode: 'manual',
    description: CROSS_WINDOW_DESCRIPTION,
    limits: crossWindowLimits(),
    items,
    requested_windows: seen.size,
    loaded_windows: items.length,
    total_requested_turns: totalRequestedTurns,
    total_loaded_turns: loadedTurns,
    total_loaded_chars: loadedChars,
    total_delivered_turns: loadedTurns,
    total_delivered_chars: loadedChars,
    trimmed: false,
    trim_reason: '',
  };
}

export function formatCrossWindowContext(result) {
  if (!result?.items?.length) return '';
  const blocks = result.items.map((item) => {
    const sourceLabel = item.source === 'rikkahub'
      ? `【Rikka】${item.title}`
      : (item.room_type === 'radio' || item.room_type === 'lighthouse' ? item.title : `主聊天｜${item.title}`);
    const lines = item.messages.map((message) => `${message.role === 'assistant' ? '另一位屋主' : '用户'}：${message.content}`);
    return `来源窗口：${sourceLabel}｜${item.loaded_turns ?? item.delivered_turns}轮｜更新于 ${item.updated_at}\n${lines.join('\n')}`;
  });
  return `【跨窗口读取】\n${CROSS_WINDOW_DESCRIPTION}\n\n${blocks.join('\n\n')}`;
}

function emptyDesk(mode, status = '未递给') {
  return {
    label: mode === 'keyword' ? '跨窗关键词漫游' : '跨窗口读取',
    description: mode === 'keyword' ? '本轮只检索本地跨窗口历史，不搜索互联网。' : CROSS_WINDOW_DESCRIPTION,
    status,
    mode,
    delivered: false,
    requested_windows: 0,
    loaded_windows: 0,
    window_count: 0,
    requested_turns: 0,
    loaded_turns: 0,
    delivered_to_model_turns: 0,
    requested_messages: 0,
    loaded_messages: 0,
    delivered_to_model_messages: 0,
    total_requested_turns: 0,
    total_loaded_turns: 0,
    total_delivered_turns: 0,
    loaded_chars: 0,
    delivered_to_model_chars: 0,
    trimmed: false,
    failure_reason: null,
    sources: [],
    messages: [],
  };
}

export function crossWindowDeskSection(result, {
  mode = 'off', ownerVisible = true, modelRead = false, error = '', deliveryFailure = null,
} = {}) {
  const normalizedMode = cleanMode(mode);
  const failure = deliveryFailure && typeof deliveryFailure === 'object' ? deliveryFailure : null;
  if ((failure || error) && !result) {
    return {
      ...emptyDesk(normalizedMode, '递送失败'),
      failure_reason: String(failure?.reason || failure?.type || 'cross_window_read_failed').slice(0, 120),
      provider_error_type: String(failure?.type || '').slice(0, 120),
      provider_error_message: String(failure?.message || error || '').slice(0, 500),
    };
  }
  if (['model_decides', 'keyword'].includes(normalizedMode) && !modelRead && !error && !failure) return emptyDesk(normalizedMode, '模型可决定');
  if (normalizedMode === 'off' || !result) return emptyDesk(normalizedMode === 'off' ? 'off' : normalizedMode);

  const rawItems = Array.isArray(result.items) ? result.items : [];
  const sources = rawItems.map((item) => ({
    conversation_id: item.conversation_id,
    title: item.title,
    room_type: item.room_type,
    source: item.source,
    source_window_id: item.source_window_id || null,
    updated_at: item.updated_at,
    requested_turns: item.requested_turns,
    loaded_turns: item.loaded_turns ?? item.delivered_turns ?? 0,
    delivered_to_model_turns: failure ? 0 : (item.loaded_turns ?? item.delivered_turns ?? 0),
    requested_messages: Math.max(0, Number(item.requested_messages) || 0),
    loaded_messages: Math.max(0, Number(item.loaded_messages) || (Array.isArray(item.messages) ? item.messages.length : 0)),
    delivered_to_model_messages: failure ? 0 : Math.max(0, Number(item.loaded_messages) || (Array.isArray(item.messages) ? item.messages.length : 0)),
  }));
  const itemRequestedTurns = rawItems.reduce((sum, item) => sum + Math.max(0, Number(item.requested_turns) || 0), 0);
  const itemLoadedTurns = rawItems.reduce((sum, item) => sum + Math.max(0, Number(item.loaded_turns ?? item.delivered_turns) || 0), 0);
  const itemLoadedChars = rawItems.reduce((sum, item) => sum + Math.max(0, Number(item.loaded_chars) || messageChars(item.messages)), 0);
  const requestedTurns = itemRequestedTurns || Number(result.total_requested_turns || 0);
  const loadedTurns = itemLoadedTurns || Number(result.total_loaded_turns ?? result.total_delivered_turns ?? 0);
  const loadedChars = itemLoadedChars || Number(result.total_loaded_chars ?? result.total_delivered_chars ?? 0);
  const requestedWindows = Math.max(sources.length, Number(result.requested_windows || 0));
  const loadedWindows = Math.max(sources.length, Number(result.loaded_windows || 0));
  const requestedMessages = rawItems.reduce((sum, item) => sum + Math.max(0, Number(item.requested_messages) || 0), 0)
    || Math.max(0, Number(result.total_requested_messages) || 0);
  const loadedMessages = rawItems.reduce((sum, item) => sum + Math.max(0, Number(item.loaded_messages) || (Array.isArray(item.messages) ? item.messages.length : 0)), 0)
    || Math.max(0, Number(result.total_loaded_messages) || 0);

  if (failure || error) {
    return {
      ...emptyDesk(normalizedMode, '递送失败'),
      requested_windows: requestedWindows,
      loaded_windows: loadedWindows,
      window_count: sources.length,
      requested_turns: requestedTurns,
      loaded_turns: loadedTurns,
      attempted_delivered_turns: loadedTurns,
      attempted_chars: loadedChars,
      total_requested_turns: requestedTurns,
      total_loaded_turns: loadedTurns,
      total_delivered_turns: 0,
      requested_messages: requestedMessages,
      loaded_messages: loadedMessages,
      delivered_to_model_messages: 0,
      trimmed: false,
      failure_reason: String(failure?.reason || failure?.type || (error ? 'cross_window_read_failed' : 'provider_error')).slice(0, 120),
      provider_error_type: String(failure?.type || '').slice(0, 120),
      provider_error_message: String(failure?.message || error || '').slice(0, 500),
      sources,
      messages: ownerVisible ? rawItems.map((item) => ({ conversation_id: item.conversation_id, messages: item.messages })) : [],
    };
  }

  const delivered = loadedTurns > 0;
  return {
    label: '跨窗口读取',
    description: CROSS_WINDOW_DESCRIPTION,
    status: modelRead ? (delivered ? '已由模型读取' : '未递给') : (delivered ? '已递给' : '未递给'),
    mode: normalizedMode,
    delivered,
    requested_windows: requestedWindows,
    loaded_windows: loadedWindows,
    window_count: sources.length,
    requested_turns: requestedTurns,
    loaded_turns: loadedTurns,
    delivered_to_model_turns: loadedTurns,
    requested_messages: requestedMessages,
    loaded_messages: loadedMessages,
    delivered_to_model_messages: loadedMessages,
    total_requested_turns: requestedTurns,
    total_loaded_turns: loadedTurns,
    total_delivered_turns: loadedTurns,
    loaded_chars: loadedChars,
    delivered_to_model_chars: loadedChars,
    trimmed: false,
    failure_reason: null,
    sources,
    messages: ownerVisible ? rawItems.map((item) => ({
      conversation_id: item.conversation_id,
      messages: item.messages,
    })) : [],
  };
}

function previewText(value, max = 180) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function listCrossWindowMessageIndex(db, { currentConversationId = '' } = {}) {
  const current = currentConversationId ? sanitizeId(currentConversationId, 'conversation') : '';
  const conversations = await eligibleConversations(db);
  const sources = [];
  for (const conversation of conversations) {
    const record = await sourceRecord(db, conversation, current);
    const { _turns, ...publicRecord } = record;
    sources.push({
      ...publicRecord,
      turns: _turns.map((turn, index) => ({
        turn_id: turn.turn_id,
        turn_number: index + 1,
        messages: turn.messages.map((message) => ({
          message_id: message.message_id,
          role: message.role,
          created_at: message.created_at || null,
          model_id: message.model_id || null,
          display_author: message.display_author || null,
          preview: previewText(message.content),
          length: String(message.content || '').length,
        })),
      })),
    });
  }
  return { description: CROSS_WINDOW_DESCRIPTION, limits: crossWindowLimits(), sources };
}

function matchSnippet(content, needle, matchedTerms, max = 220) {
  const text = String(content || '').replace(/\s+/gu, ' ').trim();
  if (!text) return '';
  const lower = text.toLocaleLowerCase('zh-CN');
  let index = lower.indexOf(needle);
  if (index < 0) {
    for (const term of matchedTerms) {
      index = lower.indexOf(term);
      if (index >= 0) break;
    }
  }
  if (index < 0) return previewText(text, max);
  const before = Math.max(0, index - Math.floor(max * 0.38));
  const after = Math.min(text.length, before + max);
  return `${before > 0 ? '…' : ''}${text.slice(before, after)}${after < text.length ? '…' : ''}`;
}

export async function searchCrossWindowMessages(db, {
  query = '', currentConversationId = '', limit = 10,
} = {}) {
  const needle = String(query || '').trim().toLocaleLowerCase('zh-CN');
  if (!needle) return { query: '', hits: [] };
  const terms = [...new Set(needle.split(/[\s,，。！？!?、:：;；()（）「」“”]+/u).map((item) => item.trim()).filter(Boolean))].slice(0, 12);
  const current = currentConversationId ? sanitizeId(currentConversationId, 'conversation') : '';
  const conversations = await eligibleConversations(db);
  const hits = [];
  for (const conversation of conversations) {
    const record = await sourceRecord(db, conversation, current);
    if (!record.readable) continue;
    for (let turnIndex = 0; turnIndex < record._turns.length; turnIndex += 1) {
      const turn = record._turns[turnIndex];
      for (const message of turn.messages) {
        const body = String(message.content || '');
        const haystack = body.toLocaleLowerCase('zh-CN');
        const direct = haystack.includes(needle) ? 12 : 0;
        const matched = terms.filter((term) => haystack.includes(term));
        const score = direct + matched.length;
        if (!score) continue;
        hits.push({
          conversation_id: record.conversation_id, title: record.title, room_type: record.room_type,
          source: record.source, updated_at: record.updated_at, turn_id: turn.turn_id,
          turn_number: turnIndex + 1, message_id: message.message_id, role: message.role,
          created_at: message.created_at, preview: matchSnippet(body, needle, matched),
          length: body.length, matched_terms: matched, score,
        });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return { query: needle, hits: hits.slice(0, Math.min(10, Math.max(1, Number(limit) || 10))) };
}
