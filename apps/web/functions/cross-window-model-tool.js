import { CROSS_WINDOW_LIMITS, listCrossWindowSources, readCrossWindow, searchCrossWindowMessages } from './cross-window-service.js';

function objectSchema(properties = {}, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function tool(name, description, properties, required = []) {
  return Object.freeze({
    type: 'function',
    function: { name, description, parameters: objectSchema(properties, required) },
  });
}

export const CROSS_WINDOW_MODEL_TOOLS = Object.freeze({
  search: tool(
    'cross_window_search',
    '仅当本轮屋主已开启“让模型决定”时，查看可读取的其他对话窗口标题与来源；不会读取正文。',
    {
      query: { type: 'string', maxLength: 120, description: '可选标题关键词。' },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
  ),
  keyword_search: tool(
    'cross_window_keyword_search',
    '只检索本地跨窗口历史，不搜索互联网。先返回最多 10 条短摘录与定位，再决定是否读取 1–3 条具体消息；不会把全部命中正文一次性塞入上下文。',
    {
      query: { type: 'string', minLength: 1, maxLength: 160 },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
    },
    ['query'],
  ),
  read_messages: tool(
    'cross_window_read_messages',
    '读取关键词检索后选中的少量具体旧消息。每条消息可独立选择，不强制 user + assistant 成组。',
    {
      messages: {
        type: 'array', minItems: 1, maxItems: 3,
        items: objectSchema({
          conversation_id: { type: 'string', minLength: 1, maxLength: 200 },
          message_id: { type: 'string', minLength: 1, maxLength: 240 },
        }, ['conversation_id', 'message_id']),
      },
    },
    ['messages'],
  ),
  read_recent: tool(
    'cross_window_read_recent',
    '仅当本轮屋主已开启“让模型决定”时，从一个其他对话窗口读取近期聊天；只读，不改变原窗口。',
    {
      conversation_id: { type: 'string', minLength: 1, maxLength: 200 },
      turns: { type: 'integer', minimum: 1, maximum: CROSS_WINDOW_LIMITS.technical_max_turns_per_source },
    },
    ['conversation_id'],
  ),
});

export async function executeCrossWindowModelTool(db, kind, input = {}, context = {}) {
  const mode = String(context.cross_window_mode || 'off');
  const allowed = context.permission === 'owner' && (
    (['search', 'read_recent'].includes(kind) && mode === 'model_decides')
    || (kind === 'keyword_search' && mode === 'keyword')
    || (kind === 'read_messages' && ['model_decides', 'keyword'].includes(mode))
  );
  if (!allowed) {
    const error = new Error(mode === 'keyword' ? '本轮只开放本地跨窗关键词漫游检索与少量精读。' : '本轮没有开放对应的跨窗口读取工具。');
    error.type = 'cross_window_tool_forbidden';
    error.status = 403;
    throw error;
  }
  if (kind === 'keyword_search') {
    const result = await searchCrossWindowMessages(db, {
      query: input.query,
      limit: input.limit,
      currentConversationId: context.conversation_id || '',
    });
    return result.hits.length
      ? { ...result, status: 'matched', message: `本地历史命中 ${result.hits.length} 条短摘录。` }
      : { ...result, status: 'no_match', message: '本地历史无命中。' };
  }

  if (kind === 'read_messages') {
    const result = await readCrossWindow(db, {
      mode: 'manual',
      current_conversation_id: context.conversation_id || '',
      messages: Array.isArray(input.messages) ? input.messages : [],
    });
    if (typeof context.on_cross_window_read === 'function') context.on_cross_window_read(result);
    return {
      description: result.description, limits: result.limits, items: result.items,
      requested_windows: result.requested_windows, loaded_windows: result.loaded_windows,
      total_requested_messages: result.total_requested_messages || 0,
      total_loaded_messages: result.total_loaded_messages || 0,
      total_loaded_chars: result.total_loaded_chars, trimmed: false, trim_reason: '',
    };
  }

  if (kind === 'search') {
    const result = await listCrossWindowSources(db, { currentConversationId: context.conversation_id || '' });
    const query = String(input.query || '').trim().toLocaleLowerCase('zh-CN');
    const limit = Math.min(20, Math.max(1, Math.trunc(Number(input.limit) || 10)));
    const sources = result.sources
      .filter((source) => source.readable)
      .filter((source) => !query || `${source.title} ${source.source} ${source.room_type}`.toLocaleLowerCase('zh-CN').includes(query))
      .slice(0, limit)
      .map((source) => ({
        conversation_id: source.conversation_id,
        title: source.title,
        room_type: source.room_type,
        source: source.source,
        source_window_id: source.source_window_id,
        updated_at: source.updated_at,
        turn_count: source.turn_count,
      }));
    return { description: result.description, limits: result.limits, sources };
  }

  const result = await readCrossWindow(db, {
    mode: 'manual',
    current_conversation_id: context.conversation_id || '',
    sources: [{ conversation_id: input.conversation_id, turns: input.turns }],
  });

  if (typeof context.on_cross_window_read === 'function') context.on_cross_window_read(result);
  return {
    description: result.description,
    limits: result.limits,
    items: result.items,
    requested_windows: result.requested_windows,
    loaded_windows: result.loaded_windows,
    total_requested_turns: result.total_requested_turns,
    total_loaded_turns: result.total_loaded_turns,
    total_loaded_chars: result.total_loaded_chars,
    total_delivered_turns: result.total_delivered_turns,
    total_delivered_chars: result.total_delivered_chars,
    trimmed: false,
    trim_reason: '',
  };
}
