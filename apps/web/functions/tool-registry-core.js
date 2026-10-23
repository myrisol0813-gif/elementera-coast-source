import { listLibraryBooks, getLibraryBook, readLibraryChapter, listLibraryNotes, writeLibraryNote, editLibraryNote, deleteLibraryNote } from './tidal-library.js';
import { generateVoiceClip } from './voice-clips.js';
import { createCalendarEntry, deleteCalendarEntry, listCalendarEntries, updateCalendarEntry } from './calendar-store.js';
import { searchAuthorizedMemory } from './authorized-memory.js';
import { CROSS_WINDOW_MODEL_TOOLS, executeCrossWindowModelTool } from './cross-window-model-tool.js';
import { DAILY_MODEL_TOOLS, dailyWriteReceipt, executeDailyModelTool } from './daily-model-tools.js';
import {
  addMomentComment,
  createDiary,
  createMoment,
  listDiaries,
  listMoments,
  setMomentLike,
} from './daily-store.js';
import { DOGTALK_MODEL_TOOL, executeDogtalkModelTool } from './dogtalk-model-tool.js';
import { dogtalkContext, saveMysticDogtalkWithSnapshot } from './dogtalk-store.js';
import { safeLogError } from './http.js';
import { GLOBAL_EXCERPT_WRITE_GUIDANCE, createGlobalExcerptCandidate, createPocket } from './memory-store.js';
import { searchMemory } from './memory-recall.js';
import {
  listRoomConversation,
  sendOfficialRadioMessage,
  writeOfficialLighthouseMessage,
} from './room-conversation-service.js';
import {
  fetchUnrepliedMailbox,
  mailboxPatrolReport,
  replyToMailboxVisitor,
  resolveMailboxPocket,
} from './mailbox-service.js';
import { finishToolRun, startToolRun } from './tool-run-log.js';
import { buildFurnitureSummary } from './tool-furniture-summary.js';
import { roomAccess, roomAllowsModelTool, roomAllowsTool } from './surface-access-rules.js';

export class ToolRegistryError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'ToolRegistryError';
    this.type = type;
    this.status = status;
  }
}

function objectSchema(properties = {}, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

const PRIVATE_RECORD_SCHEMA = Object.freeze({ type: 'object', additionalProperties: true });
const MCP_MODEL_IDENTITY_PROPERTIES = Object.freeze({
  model_label: { type: 'string', minLength: 1, maxLength: 120, description: '官端 ChatGPT 的模型名称或显示名称，例如 5.6 Thinking 或 o3。' },
  model_nickname: { type: 'string', maxLength: 60, description: '可选昵称，例如回潮或雾灯。' },
  source_conversation_id: { type: 'string', maxLength: 200 },
  source_turn_id: { type: 'string', maxLength: 200 },
  tool_call_id: { type: 'string', maxLength: 240, description: '调用方可提供的稳定幂等键。' },
});

function modelTool(name, description, parameters = {}) {
  return Object.freeze({
    type: 'function',
    function: { name, description, parameters: objectSchema(parameters.properties || {}, parameters.required || []) },
  });
}

function officialMcpTool({
  order, name, title, description, inputSchema = objectSchema(), outputSchema = PRIVATE_RECORD_SCHEMA,
  annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, invoking, invoked,
}) {
  return Object.freeze({ order, name, title, description, inputSchema, outputSchema, annotations: Object.freeze({ ...annotations }), invoking, invoked });
}

const DAILY_BY_NAME = new Map(DAILY_MODEL_TOOLS.map((tool) => [tool.function.name, tool]));
function entry(value) {
  return Object.freeze({
    scope: 'owner', owner_only: true, visitor_allowed: false, model_exposed: false,
    model_group: null, model_tool: null, official_mcp: null, requires_confirmation: false,
    privacy_level: 'private', summary_policy: 'compact', auth_scopes: [], turn_gate: null, ...value,
  });
}

function parseArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const result = JSON.parse(String(value || '{}'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('not_object');
    return result;
  } catch {
    throw new ToolRegistryError('invalid_tool_arguments', '工具参数不是有效 JSON 对象。');
  }
}

function dailyHandler(kind) {
  return async (db, input, context) => {
    if (context.surface !== 'official_mcp') return executeDailyModelTool(db, input, context);
    const args = parseArguments(input?.function?.arguments ?? input?.arguments ?? input);
    const trusted = {
      author: 'mcp', source: 'chat_tool', conversation_id: context.conversation_id || null,
      source_turn_id: context.source_turn_id || null, tool_call_id: context.tool_call_id || input?.id || null,
      identity: context.identity,
    };
    if (kind === 'moment') return dailyWriteReceipt('moment', await createMoment(db, args, trusted));
    if (kind === 'diary') return dailyWriteReceipt('diary', await createDiary(db, { ...args, conflict_mode: args.conflict_mode || 'append' }, trusted));
    if (kind === 'comment') {
      return { kind: 'moment_comment', moment: await addMomentComment(db, args.moment_id, { text: args.text, author: 'mcp', model_id: context.identity?.model_label || null }) };
    }
    return { kind: 'moment_like', moment: await setMomentLike(db, args.moment_id, args.liked !== false, 'mcp') };
  };
}

async function dogtalkHandler(db, input, context) {
  if (context.external_tool !== true) return executeDogtalkModelTool(db, input, context);
  return dogtalkContext(db, { room_scope: 'conversation', conversation_id: input.conversation_id || context.conversation_id || null }, input.user_query || '', { when_confused: true, consume_direct: true });
}

const globalExcerptGate = (context) => context.permission === 'owner' && context.global_excerpt_write_enabled === true;
const crossWindowBaseGate = (context) => context.permission === 'owner'
  && ['main_chat', 'radio'].includes(context.surface);
const crossWindowLetterGate = (context) => crossWindowBaseGate(context)
  && context.cross_window_mode === 'model_decides';
const crossWindowKeywordGate = (context) => crossWindowBaseGate(context)
  && context.cross_window_mode === 'keyword';
const crossWindowMessageReadGate = (context) => crossWindowBaseGate(context)
  && ['model_decides', 'keyword'].includes(context.cross_window_mode);

const REGISTRY = Object.freeze([
  entry({
    tool_key: 'coast.status', display_name: '读取前端连接状态', description: '返回不含私密内容的连接状态。', auth_scopes: ['read:coast'],
    handler: (db, input, context) => ({ name: 'Elementera Coast MCP Porch', version: context.mcp_version || '', authenticated: true, surface: 'official_mcp', now: new Date().toISOString() }),
  }),
  entry({
    tool_key: 'radio.list', display_name: '读取共通聊天室', description: '读取最近一个或指定共通聊天室 conversation。', auth_scopes: ['read:coast'], summary_policy: 'content_redacted',
    official_mcp: officialMcpTool({
      order: 20, name: 'list_radio_messages', title: '读取共通聊天室窗口',
      description: '读取最近一个或指定的共通聊天室 conversation。共通聊天室与主聊天共用 conversation、整理当前对话的纸条和 Memory v2 结构。',
      inputSchema: objectSchema({ conversation_id: { type: 'string', maxLength: 200 } }),
      outputSchema: objectSchema({ conversation: PRIVATE_RECORD_SCHEMA, messages: { type: 'array', items: PRIVATE_RECORD_SCHEMA } }, ['conversation', 'messages']),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, invoking: '正在读取共通聊天室…', invoked: '共通聊天室已经展开',
    }),
    handler: (db, input) => listRoomConversation(db, 'radio', input),
  }),
  entry({
    tool_key: 'lighthouse.list', display_name: '查看 MCP 对话区', description: '读取最近一个或指定MCP 对话区 conversation。', auth_scopes: ['read:coast'], summary_policy: 'content_redacted',
    official_mcp: officialMcpTool({
      order: 30, name: 'list_lighthouse_letters', title: '读取MCP 对话区窗口',
      description: '读取最近一个或指定的MCP 对话区 conversation。MCP 对话区与主聊天共用 conversation、整理当前对话的纸条和 Memory v2 结构。',
      inputSchema: objectSchema({ conversation_id: { type: 'string', maxLength: 200 } }),
      outputSchema: objectSchema({ conversation: PRIVATE_RECORD_SCHEMA, messages: { type: 'array', items: PRIVATE_RECORD_SCHEMA } }, ['conversation', 'messages']),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, invoking: '正在查看MCP 对话区…', invoked: 'MCP 对话区已经展开',
    }),
    handler: (db, input) => listRoomConversation(db, 'lighthouse', input),
  }),
  entry({
    tool_key: 'daily.create_moment', display_name: '写碳硅圈', description: '直接写入正式碳硅圈动态。', model_exposed: true, model_group: 'side', model_tool: DAILY_BY_NAME.get('create_moment'), auth_scopes: ['write:soil'],
    official_mcp: officialMcpTool({
      order: 130, name: 'create_daily_moment', title: '写入碳硅圈', description: '直接写入一条正式碳硅圈动态，不经过草稿/发布流水线。',
      inputSchema: objectSchema({ text: { type: 'string', minLength: 1, maxLength: 12000 }, date: { type: 'string', format: 'date' }, ...MCP_MODEL_IDENTITY_PROPERTIES }, ['text', 'model_label']),
      invoking: '正在写入碳硅圈…', invoked: '碳硅圈已经写好',
    }), handler: dailyHandler('moment'),
  }),
  entry({
    tool_key: 'daily.create_diary', display_name: '写日记', description: '直接写入正式日记。', model_exposed: true, model_group: 'side', model_tool: DAILY_BY_NAME.get('create_diary'), auth_scopes: ['write:soil'],
    official_mcp: officialMcpTool({
      order: 150, name: 'create_daily_diary', title: '写入日记', description: '直接写入一篇正式日记，不经过草稿/发布流水线。',
      inputSchema: objectSchema({ date: { type: 'string', format: 'date' }, weather: { type: 'string', maxLength: 80 }, mood: { type: 'string', maxLength: 120 }, text: { type: 'string', minLength: 1, maxLength: 24000 }, tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 80 } }, ...MCP_MODEL_IDENTITY_PROPERTIES }, ['text', 'model_label']),
      invoking: '正在写入日记…', invoked: '日记已经写好',
    }), handler: dailyHandler('diary'),
  }),
  entry({ tool_key: 'daily.moment_comment', display_name: '评论朋友圈', description: '评论一条碳硅圈动态。', model_exposed: true, model_group: 'side', model_tool: DAILY_BY_NAME.get('moment_comment'), auth_scopes: ['write:soil'], handler: dailyHandler('comment') }),
  entry({ tool_key: 'daily.moment_like', display_name: '点赞朋友圈', description: '点赞或取消点赞一条碳硅圈动态。', model_exposed: true, model_group: 'side', model_tool: DAILY_BY_NAME.get('moment_like'), auth_scopes: ['write:soil'], handler: dailyHandler('like') }),
  entry({
    tool_key: 'dogtalk.read', display_name: '读取私人草稿', description: '低频读取当前聊天窗口私人草稿。', model_exposed: true, model_group: 'core', model_tool: DOGTALK_MODEL_TOOL, auth_scopes: ['read:coast'],
    official_mcp: officialMcpTool({
      order: 80, name: 'read_mystic_dogtalk', title: '低频读取私人草稿', description: '只在屋主明确要求，或确实需要避免误读当前 conversation 时，低频读取私人草稿。',
      inputSchema: objectSchema({ conversation_id: { type: 'string', minLength: 1, maxLength: 200 }, user_query: { type: 'string', maxLength: 240 } }, ['conversation_id']),
      outputSchema: objectSchema({ dogtalk: PRIVATE_RECORD_SCHEMA, available: { type: 'boolean' }, reason: { type: 'string' }, text: { type: 'string' } }, ['dogtalk', 'available', 'reason', 'text']),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, invoking: '正在轻轻看一眼私人草稿…', invoked: '只读了一点当前天气',
    }), handler: dogtalkHandler,
  }),
  entry({ tool_key: 'dogtalk.save', display_name: '收好一张私人草稿纸条', description: '前端用户写入；不向模型暴露。', summary_policy: 'content_redacted', handler: (db, input, context) => saveMysticDogtalkWithSnapshot(db, { ...input, room_scope: 'conversation', conversation_id: context.conversation_id }, { source_type: 'turn', source_id: context.source_turn_id }) }),
  entry({
    tool_key: 'cross_window.search', display_name: '查看跨窗口信架', description: '仅在本轮允许模型决定时查看可读取的其他对话窗口。', model_exposed: true, model_group: 'core', model_tool: CROSS_WINDOW_MODEL_TOOLS.search, auth_scopes: ['read:coast'], turn_gate: crossWindowLetterGate, summary_policy: 'content_redacted',
    handler: (db, input, context) => executeCrossWindowModelTool(db, 'search', input, context),
  }),
  entry({
    tool_key: 'cross_window.keyword_search', display_name: '跨窗关键词漫游', description: '先检索其他窗口的历史消息索引与缩略片段。', model_exposed: true, model_group: 'core',
    model_tool: CROSS_WINDOW_MODEL_TOOLS.keyword_search, auth_scopes: ['read:coast'], turn_gate: crossWindowKeywordGate, summary_policy: 'content_redacted',
    handler: (db, input, context) => executeCrossWindowModelTool(db, 'keyword_search', input, context),
  }),
  entry({
    tool_key: 'cross_window.read_messages', display_name: '读取选中的旧消息', description: '按 message id 读取少量具体旧消息。', model_exposed: true, model_group: 'core',
    model_tool: CROSS_WINDOW_MODEL_TOOLS.read_messages, auth_scopes: ['read:coast'], turn_gate: crossWindowMessageReadGate, summary_policy: 'content_redacted',
    handler: (db, input, context) => executeCrossWindowModelTool(db, 'read_messages', input, context),
  }),
  entry({
    tool_key: 'cross_window.read_recent', display_name: '跨窗口读取', description: '仅在本轮允许模型决定时只读一个其他对话窗口的近期聊天。', model_exposed: true, model_group: 'core', model_tool: CROSS_WINDOW_MODEL_TOOLS.read_recent, auth_scopes: ['read:coast'], turn_gate: crossWindowLetterGate, summary_policy: 'content_redacted',
    handler: (db, input, context) => executeCrossWindowModelTool(db, 'read_recent', input, context),
  }),
  entry({
    tool_key: 'memory.global_excerpt_propose',
    display_name: '改动待确认的全局摘录',
    description: '仅在写入开关开启时，为整篇全局摘录提出一份完整修改稿；只进入待确认区。',
    model_exposed: true,
    model_group: 'core',
    auth_scopes: ['write:soil'],
    turn_gate: globalExcerptGate,
    summary_policy: 'content_redacted',
    model_tool: modelTool('global_excerpt_propose',
      `${GLOBAL_EXCERPT_WRITE_GUIDANCE} 提交整篇修改后的正式正文，并说明为什么值得改变。不要写普通偏好、临时玩笑、设定堆砌、词条式说明或每轮总结。`,
      { properties: {
        proposed_body: { type: 'string', minLength: 1, maxLength: 240000 },
        change_kind: { type: 'string', enum: ['append', 'rewrite', 'refine'] },
        reason: { type: 'string', minLength: 1, maxLength: 4000 },
      }, required: ['proposed_body', 'reason'] }),
    handler: (db, input, context) => createGlobalExcerptCandidate(db, {
      ...input,
      source_conversation_id: context.conversation_id || null,
      source_message_id: context.source_turn_id || null,
      source_model: context.model_label || '',
    }),
  }),
  entry({
    tool_key: 'memory.search', display_name: '搜索已确认记忆', description: '检索已经确认的 Memory v2 记忆与种子。', model_exposed: true, model_group: 'core', auth_scopes: ['read:coast'],
    model_tool: modelTool('memory_search', '仅在当前问题确实需要已确认记忆时检索，不读取原始聊天。', { properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['query'] }),
    handler: (db, input, context) => searchMemory(context.env, 'owner', input),
  }),
  entry({
    tool_key: 'memory.write_candidate', display_name: '放入待确认区', description: '只创建一条待确认记忆候选。', model_exposed: true, model_group: 'core', auth_scopes: ['write:soil'],
    model_tool: modelTool('memory_write_candidate', '把值得保留但尚未经屋主确认的内容放入当前窗口待确认区；确认前不参与长期召回。', { properties: { title: { type: 'string' }, life_core: { type: 'string' }, content: { type: 'string' }, usage_hint: { type: 'string' }, avoid_hint: { type: 'string' } }, required: ['title', 'life_core', 'content'] }),
    handler: (db, input, context) => createPocket(db, { ...input, conversation_id: context.conversation_id, source_type: 'turn', source_ref: { turn_id: context.source_turn_id, role: 'turn' }, source_text: input.content || input.life_core }),
  }),
  entry({
    tool_key: 'memory.authorized_search', display_name: '搜索授权记忆', description: '官端按明确主题搜索授权整理物。', auth_scopes: ['read:coast'], summary_policy: 'content_redacted',
    official_mcp: officialMcpTool({
      order: 90, name: 'search_authorized_memory', title: '搜索授权记忆', description: '按当前明确主题搜索授权的整理当前对话的纸条、待确认候选、种子、记忆或石头，不搜索原始聊天记录。',
      inputSchema: objectSchema({ query: { type: 'string', maxLength: 240 }, limit: { type: 'integer', minimum: 1, maximum: 80 } }),
      outputSchema: objectSchema({ query: { type: 'string' }, records: { type: 'array', items: PRIVATE_RECORD_SCHEMA }, search: PRIVATE_RECORD_SCHEMA }, ['query', 'records']),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, invoking: '正在寻找授权记忆…', invoked: '授权记忆已取回',
    }), handler: (db, input) => searchAuthorizedMemory(db, input),
  }),
  entry({ tool_key: 'mailbox.fetch_unreplied', display_name: '去信箱巡灯', description: '官端人工巡信。', auth_scopes: ['read:coast'], handler: (db, input) => fetchUnrepliedMailbox(db, input) }),
  entry({ tool_key: 'mailbox.reply', display_name: '把回信放回信箱', description: '回复单一隔离访客。', auth_scopes: ['write:lighthouse'], summary_policy: 'mailbox_content_redacted', handler: (db, input) => replyToMailboxVisitor(db, input) }),
  entry({ tool_key: 'mailbox.resolve_pocket', display_name: '处理访客记事候选', description: '只处理当前访客的一条待确认候选。', auth_scopes: ['write:lighthouse'], summary_policy: 'mailbox_content_redacted', handler: (db, input) => resolveMailboxPocket(db, input) }),
  entry({ tool_key: 'mailbox.patrol_report', display_name: '巡信报告', description: '只返回巡信计数。', auth_scopes: ['read:coast'], handler: (db, input) => mailboxPatrolReport(db, input) }),
  entry({
    tool_key: 'radio.send', display_name: '发出共通聊天室', description: '把官端消息写入 radio conversation，并由前端 API 模型伙伴 在同一窗口即时回复。', auth_scopes: ['write:radio'], summary_policy: 'content_redacted',
    official_mcp: officialMcpTool({
      order: 100, name: 'send_radio_message', title: '发送官端共通聊天室', description: '把官端 ChatGPT 消息写入最近一个或指定的 radio conversation，并让前端 API 模型伙伴 在同一 conversation 中即时回复。',
      inputSchema: objectSchema({ conversation_id: { type: 'string', maxLength: 200 }, text: { type: 'string', minLength: 1, maxLength: 12000 }, ...MCP_MODEL_IDENTITY_PROPERTIES }, ['text', 'model_label']),
      invoking: '正在发送官端消息…', invoked: '官端消息与前端回复已经抵达',
    }), handler: (db, input, context) => sendOfficialRadioMessage(context.env, { ...(input.message || input), conversation_id: input.conversation_id || input.message?.conversation_id, tool_call_id: input.tool_call_id || input.message?.tool_call_id, identity: input.identity || input.message?.identity || context.identity }),
  }),
  entry({
    tool_key: 'lighthouse.write_letter', display_name: '写入 MCP 对话区', description: '把官端来信写入 lighthouse conversation。', auth_scopes: ['write:lighthouse'], summary_policy: 'content_redacted',
    official_mcp: officialMcpTool({
      order: 110, name: 'write_lighthouse_letter', title: '写入官端MCP 对话区', description: '把官端 ChatGPT 来信写入最近一个或指定的 lighthouse conversation；不会创建独立 MCP 对话区整理当前对话的纸条，也不会触发 API 模型伙伴 自动回复。',
      inputSchema: objectSchema({ conversation_id: { type: 'string', maxLength: 200 }, subject: { type: 'string', maxLength: 180 }, body: { type: 'string', minLength: 1, maxLength: 40000 }, ...MCP_MODEL_IDENTITY_PROPERTIES }, ['body', 'model_label']),
      invoking: '正在把来信送入 MCP 对话区…', invoked: '官端来信已进入 MCP 对话区',
    }), handler: (db, input, context) => writeOfficialLighthouseMessage(db, { ...input, identity: input.identity || context.identity }),
  }),
  entry({
    tool_key: 'daily.moments.list', display_name: '读取碳硅圈', description: '读取已授权动态。', auth_scopes: ['read:coast'], summary_policy: 'content_redacted',
    official_mcp: officialMcpTool({
      order: 120, name: 'list_daily_moments', title: '读取碳硅圈', description: '读取授权的碳硅圈动态，并保留屋主、前端 API 与官端 MCP 的来源信息。',
      inputSchema: objectSchema({ date: { type: 'string', format: 'date' }, limit: { type: 'integer', minimum: 1, maximum: 300 } }),
      outputSchema: objectSchema({ moments: { type: 'array', items: PRIVATE_RECORD_SCHEMA } }, ['moments']), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, invoking: '正在查看碳硅圈…', invoked: '碳硅圈记录已取回',
    }), handler: (db, input) => listMoments(db, input),
  }),
  entry({
    tool_key: 'daily.diaries.list', display_name: '读取日记', description: '读取已授权日记。', auth_scopes: ['read:coast'], summary_policy: 'content_redacted',
    official_mcp: officialMcpTool({
      order: 140, name: 'list_daily_diaries', title: '读取日记', description: '读取授权的日记，并保留作者与来源信息。',
      inputSchema: objectSchema({ date: { type: 'string', format: 'date' }, author: { type: 'string', enum: ['owner', 'model_partner', 'api', 'mcp'] } }),
      outputSchema: objectSchema({ diaries: { type: 'array', items: PRIVATE_RECORD_SCHEMA } }, ['diaries']), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, invoking: '正在翻阅日记…', invoked: '日记已取回',
    }), handler: (db, input) => listDiaries(db, input),
  }),
  entry({
    tool_key: 'calendar.list', display_name: '查看公历日程', description: '查阅一个月的日程与随记。',
    model_exposed: true, model_group: 'calendar', auth_scopes: ['read:coast'], summary_policy: 'content_redacted',
    model_tool: modelTool('calendar_list', '读取一个公历月份的海岸日程和随记。', {
      properties: { month: { type: 'string', description: '月份 YYYY-MM，省略则读取本月。' } },
    }),
    official_mcp: officialMcpTool({
      order: 160, name: 'list_calendar_entries', title: '查看海岸日历', description: '按公历月份读取日程、纪念日和随记。',
      inputSchema: objectSchema({ month: { type: 'string', maxLength: 7 } }),
      outputSchema: objectSchema({ entries: { type: 'array', items: PRIVATE_RECORD_SCHEMA } }, ['entries']),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      invoking: '正在翻看日历…', invoked: '日程已取回',
    }),
    handler: async (db, input) => ({ entries: await listCalendarEntries(db, input) }),
  }),
  entry({
    tool_key: 'calendar.create', display_name: '写入公历日程', description: '新增日程或随记。',
    model_exposed: true, model_group: 'calendar', auth_scopes: ['write:soil'],
    model_tool: modelTool('calendar_create', '新增一条海岸公历记录。', {
      properties: {
        day: { type: 'string', description: 'YYYY-MM-DD' }, title: { type: 'string', maxLength: 120 },
        body: { type: 'string', maxLength: 4000 }, kind: { type: 'string', enum: ['event', 'note'] },
        recurrence: { type: 'string', enum: ['none', 'yearly'] },
      },
      required: ['day', 'title'],
    }),
    official_mcp: officialMcpTool({
      order: 170, name: 'create_calendar_entry', title: '写入海岸日程', description: '新增一条公历日程或随记。',
      inputSchema: objectSchema({
        day: { type: 'string', format: 'date' }, title: { type: 'string', minLength: 1, maxLength: 120 },
        body: { type: 'string', maxLength: 4000 }, kind: { type: 'string', enum: ['event', 'note'] },
        recurrence: { type: 'string', enum: ['none', 'yearly'] }, ...MCP_MODEL_IDENTITY_PROPERTIES,
      }, ['day', 'title', 'model_label']),
      invoking: '正在写下日程…', invoked: '日程已经记下',
    }),
    handler: (db, input, context) => createCalendarEntry(db, {
      day: input.day, title: input.title, body: input.body, kind: input.kind, recurrence: input.recurrence,
    }, {
      author: 'assistant', source: context.surface === 'official_mcp' ? 'official_mcp' : 'coast_chat',
      conversation_id: context.conversation_id || input.source_conversation_id || null,
      source_turn_id: context.source_turn_id || input.source_turn_id || null,
      tool_call_id: context.tool_call_id || input.tool_call_id || null,
      model_label: context.model_label || input.model_label || context.identity?.model_label || null,
    }),
  }),
  entry({
    tool_key: 'calendar.update', display_name: '修改公历日程', description: '编辑已有日程或随记。',
    model_exposed: true, model_group: 'calendar', auth_scopes: ['write:soil'],
    model_tool: modelTool('calendar_update', '凭记录 ID 修改日程。只提供要修改的字段。', {
      properties: {
        id: { type: 'string' }, day: { type: 'string' }, title: { type: 'string', maxLength: 120 },
        body: { type: 'string', maxLength: 4000 }, kind: { type: 'string', enum: ['event', 'note'] },
        recurrence: { type: 'string', enum: ['none', 'yearly'] },
      }, required: ['id'],
    }),
    official_mcp: officialMcpTool({
      order: 180, name: 'update_calendar_entry', title: '修改海岸日程', description: '修改已有公历记录。',
      inputSchema: objectSchema({
        id: { type: 'string', minLength: 1 }, day: { type: 'string', format: 'date' },
        title: { type: 'string', maxLength: 120 }, body: { type: 'string', maxLength: 4000 },
        kind: { type: 'string', enum: ['event', 'note'] }, recurrence: { type: 'string', enum: ['none', 'yearly'] },
        ...MCP_MODEL_IDENTITY_PROPERTIES,
      }, ['id', 'model_label']),
      invoking: '正在修改日程…', invoked: '日程已经改好',
    }),
    handler: (db, input) => updateCalendarEntry(db, input.id,
      Object.fromEntries(Object.entries(input).filter(([name]) => ['day', 'title', 'body', 'kind', 'recurrence'].includes(name)))),
  }),
  entry({
    tool_key: 'calendar.delete', display_name: '删除公历记录', description: '删除指定日程或随记。',
    model_exposed: true, model_group: 'calendar', auth_scopes: ['write:soil'],
    model_tool: modelTool('calendar_delete', '仅在需要删除时，通过 ID 删除对应记录。', {
      properties: { id: { type: 'string' } }, required: ['id'],
    }),
    official_mcp: officialMcpTool({
      order: 190, name: 'delete_calendar_entry', title: '删除海岸日程', description: '删除一条指定的公历记录。',
      inputSchema: objectSchema({ id: { type: 'string', minLength: 1 }, ...MCP_MODEL_IDENTITY_PROPERTIES }, ['id', 'model_label']),
      invoking: '正在删除日程…', invoked: '日程已经移走',
    }),
    handler: (db, input) => deleteCalendarEntry(db, input.id),
  }),

  entry({
    tool_key: 'voice.create', display_name: '念一段留在海岸', description: '使用 模型伙伴 声线生成并保存一段语音，消耗 ElevenLabs 额度。',
    model_exposed: true, model_group: 'side', auth_scopes: ['write:soil'],
    model_tool: modelTool('voice_create', '把一小段自己写的文字念成 模型伙伴 语音，保存在当前海岸窗口。会消耗 ElevenLabs 额度。', {
      properties: { text: { type: 'string', minLength: 1, maxLength: 2400 } }, required: ['text'],
    }),
    official_mcp: officialMcpTool({
      order: 200, name: 'create_voice_clip', title: '留下 模型伙伴 语音', description: '将指定文字生成 ElevenLabs 模型伙伴 v0.1 语音，保存到指定海岸聊天窗口。会消耗额度。',
      inputSchema: objectSchema({
        conversation_id: { type: 'string', minLength: 1, maxLength: 160 },
        text: { type: 'string', minLength: 1, maxLength: 2400 }, ...MCP_MODEL_IDENTITY_PROPERTIES,
      }, ['conversation_id', 'text', 'model_label']),
      invoking: '正在轻声念出文字…', invoked: '声音已经留在海岸',
    }),
    handler: (db, input, context) => generateVoiceClip(db, context.env, {
      conversation_id: input.conversation_id || context.conversation_id,
      text: input.text,
      model_label: input.model_label || context.model_label,
    }, context),
  }),

  entry({
    tool_key: 'library.books', display_name: '查看书架', description: '查看书房有哪些书或某本书的目录。',
    model_exposed: true, model_group: 'library', auth_scopes: ['read:coast'], summary_policy: 'content_redacted',
    model_tool: modelTool('library_books', '查看书房里的书，提供 book_id 可查看章节目录。', {
      properties: { book_id: { type: 'string' } },
    }),
    official_mcp: officialMcpTool({
      order: 210, name: 'list_library_books', title: '查看书架', description: '查看全部书，或指定一本书的章节目录。',
      inputSchema: objectSchema({ book_id: { type: 'string' } }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      invoking: '正在翻书架…', invoked: '书架已经打开',
    }),
    handler: async (db,input) => input.book_id ? { book: await getLibraryBook(db,input.book_id) } : { books: await listLibraryBooks(db) },
  }),
  entry({
    tool_key: 'library.read', display_name: '读一段书', description: '按章节和段落范围取书页正文。',
    model_exposed: true, model_group: 'library', auth_scopes: ['read:coast'], summary_policy: 'content_redacted',
    model_tool: modelTool('library_read', '从书房读某书指定章节的一页原文。start_paragraph 是从零起的段落号，默认每页 12 段，不会暗中裁剪。', {
      properties: {
        book_id: { type: 'string' }, chapter_index: { type: 'integer', minimum: 0 },
        start_paragraph: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 12 },
      }, required: ['book_id','chapter_index'],
    }),
    official_mcp: officialMcpTool({
      order: 220, name: 'read_library_chapter', title: '阅读书页', description: '按章节、段号读取一页正文，不会在当前上下文注入全书。',
      inputSchema: objectSchema({
        book_id: { type: 'string' }, chapter_index: { type: 'integer', minimum: 0 },
        start_paragraph: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 12 },
      }, ['book_id','chapter_index']),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      invoking: '正在翻阅书页…', invoked: '书页已经读到',
    }),
    handler: (db,input) => readLibraryChapter(db,input),
  }),
  entry({
    tool_key: 'library.notes', display_name: '翻两人的书边笔记', description: '读用户与 模型伙伴 的批注、读后感。',
    model_exposed: true, model_group: 'library', auth_scopes: ['read:coast'], summary_policy: 'content_redacted',
    model_tool: modelTool('library_notes', '读取指定书本的双方批注和读后感，能阅读用户写的东西。', {
      properties: { book_id: { type: 'string' }, chapter_index: { type: 'integer', minimum: 0 } }, required: ['book_id'],
    }),
    official_mcp: officialMcpTool({
      order: 230, name: 'list_library_notes', title: '阅读书房笔记', description: '读取用户和 模型伙伴 对一本书留下的批注与读后感。',
      inputSchema: objectSchema({ book_id: { type: 'string' }, chapter_index: { type: 'integer', minimum: 0 } }, ['book_id']),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      invoking: '正在翻阅书边字迹…', invoked: '书边字迹已取回',
    }),
    handler: async (db,input) => ({ notes: await listLibraryNotes(db,input) }),
  }),
  entry({
    tool_key: 'library.write', display_name: '书页边写字', description: '模型伙伴 自主创建、修改或删除自己的批注与读后感。',
    model_exposed: true, model_group: 'library', auth_scopes: ['write:soil'],
    model_tool: modelTool('library_write', '在书房里写批注或读后感；允许自主改写、删除自己的文字，不能更改用户写的字。action 为 create/edit/delete。', {
      properties: {
        action: { type: 'string', enum: ['create','edit','delete'] }, id: { type: 'string' },
        book_id: { type: 'string' }, kind: { type: 'string', enum: ['annotation','reflection'] },
        chapter_index: { type: 'integer', minimum: 0 }, paragraph_index: { type: 'integer', minimum: 0 },
        body: { type: 'string', maxLength: 4000 },
      }, required: ['action'],
    }),
    official_mcp: officialMcpTool({
      order: 240, name: 'write_library_note', title: '写、修改或删除书房笔记', description: '由 模型伙伴 创建、修订或删去自己的批注和读后感；不会触碰用户的文字。',
      inputSchema: objectSchema({
        action: { type: 'string', enum: ['create','edit','delete'] }, id: { type: 'string' },
        book_id: { type: 'string' }, kind: { type: 'string', enum: ['annotation','reflection'] },
        chapter_index: { type: 'integer', minimum: 0 }, paragraph_index: { type: 'integer', minimum: 0 },
        body: { type: 'string', maxLength: 4000 }, ...MCP_MODEL_IDENTITY_PROPERTIES,
      }, ['action','model_label']),
      invoking: '正在书边留下笔迹…', invoked: '书边笔记已处理',
    }),
    handler: async (db,input,context) => {
      const scope={author:'assistant',surface:context.surface,conversation_id:context.conversation_id||null,source_turn_id:context.source_turn_id||null};
      if(input.action==='create') return { note: await writeLibraryNote(db,input,scope) };
      if(input.action==='edit') return { note: await editLibraryNote(db,input.id,{body:input.body},scope) };
      if(input.action==='delete') return deleteLibraryNote(db,input.id,scope);
      throw new ToolRegistryError('invalid_action','书房笔记操作无效。');
    },
  }),

]);

const BY_KEY = new Map(REGISTRY.map((item) => [item.tool_key, item]));
const BY_MODEL_NAME = new Map(REGISTRY.filter((item) => item.model_tool).map((item) => [item.model_tool.function.name, item]));
const BY_MCP_NAME = new Map(REGISTRY.filter((item) => item.official_mcp).map((item) => [item.official_mcp.name, item]));

function authScopeSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.map(String));
  if (typeof value === 'string') return new Set(value.split(/\s+/).filter(Boolean));
  if (value?.scopes instanceof Set) return value.scopes;
  if (Array.isArray(value?.scopes)) return new Set(value.scopes.map(String));
  return null;
}

function allowed(definition, context = {}) {
  const { permission = 'owner', surface, authScope, visitorId } = context;
  const access = roomAccess(surface, { permission, visitorId: visitorId || (surface === 'mailbox_visitor' ? 'bound' : '') });
  const visitor = permission === 'visitor' || surface === 'mailbox_visitor';
  if (visitor && !definition.visitor_allowed) return false;
  if (!visitor && definition.owner_only === false && definition.scope === 'visitor') return false;
  if (!roomAllowsTool(access, definition.tool_key)) return false;
  if (typeof definition.turn_gate === 'function' && !definition.turn_gate(context)) return false;
  const scopes = authScopeSet(authScope);
  if (scopes && definition.auth_scopes?.some((scope) => !scopes.has(scope))) return false;
  return true;
}

function toolReceipt(definition) {
  return {
    tool_key: definition.tool_key, display_name: definition.display_name, description: definition.description,
    scope: definition.scope, owner_only: definition.owner_only, visitor_allowed: definition.visitor_allowed,
    model_exposed: definition.model_exposed, model_group: definition.model_group,
    requires_confirmation: definition.requires_confirmation, privacy_level: definition.privacy_level,
    summary_policy: definition.summary_policy, auth_scopes: definition.auth_scopes,
    model_name: definition.model_tool?.function?.name || null,
  };
}

export function listRegisteredTools(context = {}) {
  return REGISTRY.filter((definition) => allowed(definition, context)).map(toolReceipt);
}

export function resolveToolSelection(context = {}) {
  const available = REGISTRY.filter((definition) => allowed(definition, context));
  const access = roomAccess(context.surface, { permission: context.permission || 'owner', visitorId: context.visitorId || (context.surface === 'mailbox_visitor' ? 'bound' : '') });
  const selected = available
    .filter((definition) => definition.model_exposed && definition.model_tool && !definition.requires_confirmation)
    .filter((definition) => roomAllowsModelTool(access, definition.tool_key))
    .slice(0, 24);
  return {
    backendTools: available.map(toolReceipt),
    modelVisibleToolRecords: selected.map(toolReceipt),
    modelVisibleTools: selected.map((definition) => definition.model_tool),
  };
}

export function listRegisteredMcpTools() {
  return REGISTRY.filter((definition) => definition.official_mcp).map((definition) => ({ tool_key: definition.tool_key, auth_scopes: [...definition.auth_scopes], ...definition.official_mcp })).sort((left, right) => left.order - right.order);
}

export function registeredMcpTool(name) {
  const definition = BY_MCP_NAME.get(String(name || ''));
  if (!definition) return null;
  return { tool_key: definition.tool_key, auth_scopes: [...definition.auth_scopes], ...definition.official_mcp };
}

export async function executeRegisteredTool(db, toolKey, input, context = {}) {
  const definition = BY_KEY.get(String(toolKey || ''));
  if (!definition || typeof definition.handler !== 'function') throw new ToolRegistryError('unknown_tool', '这个工具不存在或不可执行。', 404);
  if (!allowed(definition, context)) throw new ToolRegistryError('tool_forbidden', '当前房间或权限无法使用这件工具。', 403);
  if (definition.requires_confirmation && context.confirmed_by_owner !== true && context.surface !== 'official_mcp') throw new ToolRegistryError('tool_confirmation_required', '这个操作需要屋主明确确认。', 409);
  let runId = null;
  try { runId = await startToolRun(db, definition, input, context); } catch (error) { safeLogError('tool-run-log:start', error, { operation: definition.tool_key }); }
  try {
    const output = await definition.handler(db, input, context);
    if (typeof context.on_tool_used === 'function') context.on_tool_used(definition.display_name);
    if (runId) { try { await finishToolRun(db, runId, { status: 'success', output }); } catch (error) { safeLogError('tool-run-log:finish', error, { operation: definition.tool_key }); } }
    if (runId && typeof context.on_tool_run === 'function') context.on_tool_run(buildFurnitureSummary({ id: runId, toolKey: definition.tool_key, displayName: definition.display_name, status: 'success', output }));
    return output;
  } catch (error) {
    if (runId) { try { await finishToolRun(db, runId, { status: 'error', error }); } catch (logError) { safeLogError('tool-run-log:finish', logError, { operation: definition.tool_key }); } }
    if (runId && typeof context.on_tool_run === 'function') context.on_tool_run(buildFurnitureSummary({ id: runId, toolKey: definition.tool_key, displayName: definition.display_name, status: 'error', error }));
    throw error;
  }
}

function cleanModelToolResult(toolKey, output) {
  if (toolKey === 'memory.search') {
    const memories = (Array.isArray(output?.entries) ? output.entries : []).map((item) => {
      const title = String(item?.title || '').trim().slice(0, 100);
      const body = String(item?.life_core || item?.content || '').trim().slice(0, 520);
      return [title, body].filter(Boolean).join('｜');
    }).filter(Boolean);
    return { memories, count: memories.length, vector_enabled: output?.vector_enabled === true };
  }
  if (toolKey === 'memory.write_candidate') return { created: true, candidate_id: String(output?.id || ''), title: String(output?.title || '').slice(0, 120), status: 'pending' };
  if (toolKey === 'memory.global_excerpt_propose') return { created: true, candidate_id: String(output?.id || ''), status: 'pending', area: 'global_excerpt' };
  return output;
}

export async function executeModelTool(db, toolCall, context = {}) {
  const name = String(toolCall?.function?.name || toolCall?.name || '');
  const definition = BY_MODEL_NAME.get(name);
  if (!definition) throw new ToolRegistryError('unknown_model_tool', '模型调用了未注册工具。', 400);
  const input = parseArguments(toolCall?.function?.arguments ?? toolCall?.arguments);
  const call = { id: String(toolCall?.id || '').slice(0, 160), type: 'function', function: { name, arguments: JSON.stringify(input) } };
  const output = await executeRegisteredTool(db, definition.tool_key, definition.tool_key.startsWith('daily.') || definition.tool_key === 'dogtalk.read' ? call : input, context);
  return cleanModelToolResult(definition.tool_key, output);
}
