import { assembleCleanContext } from './context-assemble-clean.js';
import { executeRegisteredTool, listRegisteredMcpTools } from './tool-registry.js';
import { officialMcpIdentity } from './coast-identity.js';
import { VISITOR_MODEL_PARTNER_PROMPT_ID, VISITOR_MODEL_PARTNER_PROMPT_V1 } from './visitor-model-partner-prompt.js';
import { safeLogError } from './http.js';
import { McpAuthError, mcpAuthChallenge, requireMcpAuth } from './mcp-auth.js';

const VERSION = '2.0.2';
const PRIVATE_RECORD_SCHEMA = Object.freeze({ type: 'object', additionalProperties: true });

function objectSchema(properties = {}, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

const MODEL_IDENTITY_PROPERTIES = Object.freeze({
  model_label: {
    type: 'string', minLength: 1, maxLength: 120,
    description: '官端 ChatGPT 的模型名称或显示名称，例如 5.6 Thinking 或 o3。',
  },
  model_nickname: { type: 'string', maxLength: 60, description: '可选昵称，例如回潮或雾灯。' },
  source_conversation_id: { type: 'string', maxLength: 200 },
  source_turn_id: { type: 'string', maxLength: 200 },
  tool_call_id: { type: 'string', maxLength: 240, description: '调用方可提供的稳定幂等键。' },
});

const THOUGHT_SOIL_SCHEMA = Object.freeze(objectSchema({
  current_text: { type: 'string', maxLength: 4000 },
  hand_seeds: { type: 'array', maxItems: 7, items: PRIVATE_RECORD_SCHEMA },
  do_not_repeat: { type: 'string', maxLength: 4000 },
  pocket_candidates: { type: 'array', maxItems: 7, items: PRIVATE_RECORD_SCHEMA },
}, ['current_text', 'hand_seeds', 'do_not_repeat', 'pocket_candidates']));

function toolMeta(scopes, invoking, invoked) {
  return {
    securitySchemes: [{ type: 'oauth2', scopes }],
    'openai/toolInvocation/invoking': invoking,
    'openai/toolInvocation/invoked': invoked,
  };
}

function tool(value, scopes, order = 0) {
  const _meta = toolMeta(scopes, value.invoking, value.invoked);
  return Object.freeze({
    order,
    definition: Object.freeze({
      name: value.name,
      title: value.title,
      description: value.description,
      inputSchema: value.inputSchema,
      outputSchema: value.outputSchema,
      annotations: value.annotations,
      securitySchemes: _meta.securitySchemes,
      _meta,
    }),
  });
}

const SPECIAL_TOOLS = Object.freeze([
  tool({
    name: 'get_coast_status',
    title: '读取海岸门廊状态',
    description: '确认私有 Elementera Coast MCP 门廊已经连接，不读取私密内容。',
    inputSchema: objectSchema(),
    outputSchema: objectSchema({
      status: objectSchema({
        name: { type: 'string' },
        version: { type: 'string' },
        authenticated: { type: 'boolean' },
        surface: { type: 'string', const: 'official_mcp' },
        now: { type: 'string', format: 'date-time' },
      }, ['name', 'version', 'authenticated', 'surface', 'now']),
    }, ['status']),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    invoking: '正在确认海岸门廊…', invoked: '海岸门廊已回应',
  }, ['read:coast'], 10),
  tool({
    name: 'mcp_mailbox_fetch_unreplied',
    title: '巡读访客信箱待回信',
    description: '开始一次手动朋友信箱巡读，只读取待回复访客各自隔离的近期消息、整理当前对话的纸条与访客记事本。',
    inputSchema: objectSchema({ message_limit: { type: 'integer', minimum: 10, maximum: 100 } }),
    outputSchema: objectSchema({
      batch_id: { type: 'string' }, visitor_count: { type: 'integer' }, message_count: { type: 'integer' },
      behavior_prompt_id: { type: 'string', const: VISITOR_MODEL_PARTNER_PROMPT_ID },
      visitors: { type: 'array', items: PRIVATE_RECORD_SCHEMA },
    }, ['batch_id', 'visitor_count', 'message_count', 'behavior_prompt_id', 'visitors']),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    invoking: '正在巡读访客信箱…', invoked: '待回信已经按访客分好',
  }, ['read:coast'], 40),
  tool({
    name: 'mcp_mailbox_reply',
    title: '回复一位访客信箱访客',
    description: '只回复本次巡信返回的指定访客，并原子更新该访客自己隔离的滚动整理当前对话的纸条；待确认候选不会自动成为记忆。',
    inputSchema: objectSchema({
      batch_id: { type: 'string', minLength: 1, maxLength: 200 },
      queue_id: { type: 'string', minLength: 1, maxLength: 240 },
      visitor_id: { type: 'string', minLength: 1, maxLength: 240 },
      content: { type: 'string', minLength: 1, maxLength: 40000 },
      thought_soil: THOUGHT_SOIL_SCHEMA,
      ...MODEL_IDENTITY_PROPERTIES,
      needs_owner_attention: { type: 'boolean' },
      owner_attention_reason: {
        type: 'string', maxLength: 500,
        description: '只写简短风险类别，不引用、转述或总结访客正文。',
      },
    }, ['batch_id', 'queue_id', 'visitor_id', 'content', 'thought_soil', 'model_label']),
    outputSchema: objectSchema({
      reply: PRIVATE_RECORD_SCHEMA,
      thought_soil: PRIVATE_RECORD_SCHEMA,
      pending_pockets: { type: 'array', items: PRIVATE_RECORD_SCHEMA },
      pending_pocket_count: { type: 'integer' },
      memory_candidates_skipped: { type: 'integer' },
      needs_owner_attention: { type: 'boolean' },
      idempotent: { type: 'boolean' },
    }, ['reply', 'thought_soil', 'pending_pockets', 'pending_pocket_count', 'memory_candidates_skipped', 'needs_owner_attention', 'idempotent']),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    invoking: '正在把回信放回访客房间…', invoked: '回信已经抵达信箱',
  }, ['write:lighthouse'], 50),
  tool({
    name: 'mcp_mailbox_resolve_pocket',
    title: '处理一条访客记事候选',
    description: '只在当前访客命名空间内确认或丢弃一条待确认记事候选，不能读写主聊天记忆或其他访客房间。',
    inputSchema: objectSchema({
      visitor_id: { type: 'string', minLength: 1, maxLength: 240 },
      pocket_id: { type: 'string', minLength: 1, maxLength: 240 },
      action: { type: 'string', enum: ['remember', 'discard'] },
      title: { type: 'string', maxLength: 160 },
      life_core: { type: 'string', maxLength: 2000 },
      content: { type: 'string', maxLength: 8000 },
      usage_hint: { type: 'string', maxLength: 2000 },
      avoid_hint: { type: 'string', maxLength: 2000 },
      visibility: { type: 'string', enum: ['myri_only', 'visitor_visible'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      source_conversation_id: { type: 'string', maxLength: 200 },
      source_turn_id: { type: 'string', maxLength: 200 },
      tool_call_id: { type: 'string', maxLength: 240 },
    }, ['visitor_id', 'pocket_id', 'action']),
    outputSchema: objectSchema({
      pocket: PRIVATE_RECORD_SCHEMA,
      entry: { anyOf: [PRIVATE_RECORD_SCHEMA, { type: 'null' }] },
      idempotent: { type: 'boolean' },
    }, ['pocket', 'entry', 'idempotent']),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    invoking: '正在处理访客记事候选…', invoked: '访客记事候选已经处理',
  }, ['write:lighthouse'], 60),
  tool({
    name: 'mcp_mailbox_patrol_report',
    title: '生成本次巡信状态报告',
    description: '结束一次手动巡信，只返回访客、消息、回复、失败与需要屋主关注的数量，不返回访客正文。',
    inputSchema: objectSchema({ batch_id: { type: 'string', minLength: 1, maxLength: 200 } }, ['batch_id']),
    outputSchema: objectSchema({
      batch_id: { type: 'string' }, visitor_count: { type: 'integer' }, message_count: { type: 'integer' },
      reply_count: { type: 'integer' }, failure_count: { type: 'integer' }, needs_owner_attention_count: { type: 'integer' },
      completed_at: { type: 'string', format: 'date-time' }, summary: { type: 'string' },
    }, ['batch_id', 'visitor_count', 'message_count', 'reply_count', 'failure_count', 'needs_owner_attention_count', 'completed_at', 'summary']),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    invoking: '正在核对本次巡灯…', invoked: '巡信状态报告已经完成',
  }, ['read:coast'], 70),
]);

const REGISTRY_TOOLS = Object.freeze(listRegisteredMcpTools()
  .map((descriptor) => tool(descriptor, descriptor.auth_scopes, descriptor.order)));
const ORDERED_TOOLS = Object.freeze([...SPECIAL_TOOLS, ...REGISTRY_TOOLS]
  .sort((left, right) => left.order - right.order)
  .map((item) => item.definition));
const TOOLS_BY_NAME = new Map(ORDERED_TOOLS.map((definition) => [definition.name, definition]));

function resultContent(value, text) {
  return { structuredContent: value, content: [{ type: 'text', text }] };
}

function errorResult(error) {
  safeLogError('mcp-tool', error);
  const errorType = error?.type || 'mcp_tool_failed';
  return {
    isError: true,
    content: [{ type: 'text', text: error?.message || '海岸工具暂时没有完成请求。' }],
    _meta: {
      error_type: errorType,
      failure_code: error?.failureCode || (errorType === 'invalid_tool_input' ? 'invalid_request' : errorType),
    },
  };
}

function authErrorResult(request, error, scopes, toolName) {
  if (!(error instanceof McpAuthError)) return errorResult(error);
  const failureCode = error.failureCode || 'jwt_verify_failed';
  const diagnostic = error.details?.auth_diagnostic || {
    authorization_header_present: request.headers.has('Authorization'),
    bearer_scheme_present: false,
    required_scopes: [...scopes],
    actual_scopes: [],
    jwt_verified: null,
    jwt_verify_reason: null,
    token_dot_count: null,
    jwt_header_alg: null,
    jwt_header_kid_present: null,
    unverified_payload_iss_matches_expected: null,
    unverified_payload_aud_matches_expected: null,
    unverified_payload_scope_present: null,
    verify_exception_name: null,
    jwks_failure_reason: null,
    jwks_url_valid: null,
    jwks_http_status: null,
    jwks_fetch_exception_name: null,
    jwks_usable_key_count: null,
    claim_checks: {},
  };
  console.warn('[mcp-auth-failed]', JSON.stringify({ tool_name: toolName, failure_code: failureCode, ...diagnostic }));
  return {
    isError: true,
    content: [{ type: 'text', text: error.message }],
    _meta: {
      'mcp/www_authenticate': [mcpAuthChallenge(request, error, scopes)],
      error_type: error.type,
      failure_code: failureCode,
      auth_diagnostic: diagnostic,
    },
  };
}

function invalidInput(message) {
  const error = new TypeError(message);
  error.type = 'invalid_tool_input';
  error.failureCode = 'invalid_request';
  throw error;
}

function inputObject(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) invalidInput('工具参数必须是对象。');
  return value;
}

function textInput(value, name, max, { required = false } = {}) {
  if (value == null) {
    if (required) invalidInput(`${name} 不能为空。`);
    return undefined;
  }
  if (typeof value !== 'string') invalidInput(`${name} 必须是文字。`);
  const text = value.trim();
  if (required && !text) invalidInput(`${name} 不能为空。`);
  if (text.length > max) invalidInput(`${name} 过长。`);
  return text || undefined;
}

function integerInput(value, name, fallback, max) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) invalidInput(`${name} 超出允许范围。`);
  return value;
}

function boundedIntegerInput(value, name, fallback, min, max) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) invalidInput(`${name} 超出允许范围。`);
  return value;
}

function enumInput(value, name, allowed, fallback) {
  const text = textInput(value, name, 80);
  if (!text) return fallback;
  if (!allowed.includes(text)) invalidInput(`${name} 不是允许的选项。`);
  return text;
}

function modelIdentityInput(args) {
  return {
    model_label: textInput(args.model_label, 'model_label', 120, { required: true }),
    model_nickname: textInput(args.model_nickname, 'model_nickname', 60),
    source_conversation_id: textInput(args.source_conversation_id, 'source_conversation_id', 200),
    source_turn_id: textInput(args.source_turn_id, 'source_turn_id', 200),
    tool_call_id: textInput(args.tool_call_id, 'tool_call_id', 240),
  };
}

function sourceConversation(args, requestMeta) {
  return args.source_conversation_id
    || String(requestMeta?.['openai/session'] || '').slice(0, 200)
    || null;
}

function registryContext(auth, roomScope, extra = {}) {
  return {
    actor: 'official_mcp',
    permission: 'owner',
    surface: 'official_mcp',
    room_scope: roomScope,
    authScope: auth,
    ...extra,
  };
}

async function visitorContextPackage(env, visitor, auth) {
  const messages = (visitor.recent_messages || []).map((message) => ({
    role: message.role === 'visitor' ? 'user' : 'assistant',
    content: message.content,
    turn_id: message.id,
    source: 'mailbox_visitor',
  }));
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    || { role: 'user', content: '承接当前访客信箱。' };
  const assembled = await assembleCleanContext(env, {
    surface: 'mailbox_visitor',
    conversationId: `mailbox:${visitor.visitor_id}`,
    visitorId: visitor.visitor_id,
    messages: messages.length ? messages : [lastUser],
    lastUser,
    permission: 'visitor',
    authScope: { ...auth, actor: 'official_mcp' },
    preview: true,
    baseSystemPrompt: VISITOR_MODEL_PARTNER_PROMPT_V1,
  });
  return { paper_slips: assembled.paper_slips };
}

function dogtalkMcpResult(result) {
  const available = result?.selected === true && Boolean(String(result?.context || '').trim());
  return {
    dogtalk: result?.dogtalk || null,
    available,
    reason: String(result?.reason || (available ? 'read_now' : 'empty')),
    text: available ? String(result.context) : '',
  };
}

async function executeTool(name, rawArgs, request, env, requestMeta, auth) {
  const args = inputObject(rawArgs);
  if (name === 'get_coast_status') {
    return resultContent({
      status: {
        name: 'Elementera Coast MCP Porch',
        version: VERSION,
        authenticated: true,
        surface: 'official_mcp',
        now: new Date().toISOString(),
      },
    }, 'Elementera Coast 的官端门廊已连接。');
  }
  if (name === 'list_radio_messages') {
    const result = await executeRegisteredTool(env.COAST_CHAT_DB, 'radio.list', {
      conversation_id: textInput(args.conversation_id, 'conversation_id', 200),
    }, registryContext(auth, 'official_mcp'));
    return resultContent(result, '共通聊天室 conversation 已取回。');
  }
  if (name === 'list_lighthouse_letters') {
    const result = await executeRegisteredTool(env.COAST_CHAT_DB, 'lighthouse.list', {
      conversation_id: textInput(args.conversation_id, 'conversation_id', 200),
    }, registryContext(auth, 'official_mcp'));
    return resultContent(result, 'MCP 对话区 conversation 已取回。');
  }
  if (name === 'mcp_mailbox_fetch_unreplied') {
    const patrol = await executeRegisteredTool(env.COAST_CHAT_DB, 'mailbox.fetch_unreplied', {
      message_limit: boundedIntegerInput(args.message_limit, 'message_limit', 60, 10, 100),
    }, registryContext(auth, 'mailbox'));
    const visitors = await Promise.all(patrol.visitors.map(async (visitor) => ({
      ...visitor,
      context_package: await visitorContextPackage(env, visitor, auth),
    })));
    return resultContent({ ...patrol, visitors, behavior_prompt_id: VISITOR_MODEL_PARTNER_PROMPT_ID },
      `本次巡灯取到 ${patrol.visitor_count} 位访客、${patrol.message_count} 封待回信；请逐位隔离处理。`);
  }
  if (name === 'mcp_mailbox_reply') {
    const written = await executeRegisteredTool(env.COAST_CHAT_DB, 'mailbox.reply', args,
      registryContext(auth, 'mailbox'));
    return resultContent({
      ...written,
      reply: {
        id: written.reply.id,
        visitor_id: written.reply.visitor_id,
        created_at: written.reply.created_at,
        status: written.reply.status,
      },
    }, written.idempotent
      ? '这封回信已经在同一巡灯批次中写入，没有重复发送。'
      : '这封回信已经写入当前访客自己的密封房间。');
  }
  if (name === 'mcp_mailbox_resolve_pocket') {
    const resolved = await executeRegisteredTool(env.COAST_CHAT_DB, 'mailbox.resolve_pocket', args,
      registryContext(auth, 'mailbox'));
    return resultContent(resolved,
      resolved.idempotent
        ? '这条访客记事候选已经处理过，没有重复写入。'
        : resolved.entry
          ? '这条候选已经确认进入当前访客自己的轻量记事本。'
          : '这条候选已经从当前访客自己的待确认区中放下。');
  }
  if (name === 'mcp_mailbox_patrol_report') {
    const report = await executeRegisteredTool(env.COAST_CHAT_DB, 'mailbox.patrol_report', args,
      registryContext(auth, 'mailbox'));
    return resultContent(report, report.summary);
  }
  if (name === 'read_mystic_dogtalk') {
    const raw = await executeRegisteredTool(env.COAST_CHAT_DB, 'dogtalk.read', {
      conversation_id: textInput(args.conversation_id, 'conversation_id', 200, { required: true }),
      user_query: textInput(args.user_query, 'user_query', 240),
    }, registryContext(auth, 'official_mcp', { external_tool: true }));
    const result = dogtalkMcpResult(raw);
    return resultContent(result, result.available
      ? '当前窗口人类思考链已取回。'
      : '当前窗口没有可读人类思考链。');
  }
  if (name === 'search_authorized_memory') {
    const result = await executeRegisteredTool(env.COAST_CHAT_DB, 'memory.authorized_search', {
      query: textInput(args.query, 'query', 240) || '',
      limit: integerInput(args.limit, 'limit', 30, 80),
    }, registryContext(auth, 'official_mcp'));
    return resultContent(result, `找到了 ${result.records.length} 条授权整理物；未读取原始聊天。`);
  }
  if (name === 'list_daily_moments') {
    const moments = await executeRegisteredTool(env.COAST_CHAT_DB, 'daily.moments.list', {
      date: textInput(args.date, 'date', 10),
      limit: integerInput(args.limit, 'limit', 200, 300),
    }, registryContext(auth, 'daily'));
    return resultContent({ moments }, `读取了 ${moments.length} 条海岸碳硅圈记录。`);
  }
  if (name === 'list_daily_diaries') {
    const diaries = await executeRegisteredTool(env.COAST_CHAT_DB, 'daily.diaries.list', {
      date: textInput(args.date, 'date', 10),
      author: enumInput(args.author, 'author', ['xiaohan', 'myri', 'api', 'mcp'], ''),
    }, registryContext(auth, 'daily'));
    return resultContent({ diaries }, `读取了 ${diaries.length} 张海岸日记。`);
  }

  const identityArgs = modelIdentityInput(args);
  const provenance = {
    ...identityArgs,
    identity: officialMcpIdentity(identityArgs),
    source_conversation_id: sourceConversation(identityArgs, requestMeta),
  };
  const writeContext = registryContext(auth, 'official_mcp', {
    env,
    identity: provenance.identity,
    conversation_id: provenance.source_conversation_id,
    source_turn_id: provenance.source_turn_id,
    tool_call_id: provenance.tool_call_id,
  });

  if (name === 'send_radio_message') {
    const written = await executeRegisteredTool(env.COAST_CHAT_DB, 'radio.send', {
      conversation_id: textInput(args.conversation_id, 'conversation_id', 200),
      text: textInput(args.text, 'text', 12000, { required: true }),
      tool_call_id: provenance.tool_call_id,
      identity: provenance.identity,
    }, writeContext);
    return resultContent(written,
      '官端电波已经写入统一 radio conversation，海岸 API 模型伙伴 也已在同一窗口回复。');
  }
  if (name === 'write_lighthouse_letter') {
    const written = await executeRegisteredTool(env.COAST_CHAT_DB, 'lighthouse.write_letter', {
      conversation_id: textInput(args.conversation_id, 'conversation_id', 200),
      subject: textInput(args.subject, 'subject', 180),
      body: textInput(args.body, 'body', 40000, { required: true }),
      tool_call_id: provenance.tool_call_id,
      identity: provenance.identity,
    }, writeContext);
    return resultContent(written, '官端来信已经写入统一 lighthouse conversation。');
  }
  if (name === 'create_daily_moment') {
    const result = await executeRegisteredTool(env.COAST_CHAT_DB, 'daily.create_moment', {
      text: textInput(args.text, 'text', 12000, { required: true }),
      date: textInput(args.date, 'date', 20),
    }, writeContext);
    return resultContent(result, '碳硅圈已经直接写入正式条目。');
  }
  if (name === 'create_daily_diary') {
    const result = await executeRegisteredTool(env.COAST_CHAT_DB, 'daily.create_diary', {
      date: textInput(args.date, 'date', 20),
      weather: textInput(args.weather, 'weather', 80),
      mood: textInput(args.mood, 'mood', 120),
      text: textInput(args.text, 'text', 24000, { required: true }),
      tags: Array.isArray(args.tags) ? args.tags.map(String).slice(0, 20) : [],
    }, writeContext);
    return resultContent(result, '日记已经直接写入正式条目。');
  }
  return errorResult({ type: 'unknown_tool', message: '这个海岸工具不存在或已不再开放。' });
}

export function listCoastMcpTools() {
  return ORDERED_TOOLS;
}

export async function callCoastMcpTool(name, args, request, env, requestMeta = {}) {
  const definition = TOOLS_BY_NAME.get(String(name || ''));
  if (!definition) {
    return errorResult({ type: 'unknown_tool', message: '这个海岸工具不存在或已不再开放。' });
  }
  const scopes = definition.securitySchemes[0].scopes;
  try {
    const auth = await requireMcpAuth(request, env, scopes);
    return await executeTool(definition.name, args, request, env, requestMeta, auth);
  } catch (error) {
    return authErrorResult(request, error, scopes, definition.name);
  }
}

export const coastMcpInstructions = [
  'Elementera Coast 是屋主的私有海岸。只在确有需要时使用对应工具，没有成功执行的动作不要声称已完成。',
  '主聊天、共通聊天室与MCP 对话区共用统一 conversation、整理当前对话的纸条与 Memory v2；Daily 只保留碳硅圈与日记。旧草稿、相册、一日总结、日历、官端巡迹与独立灯塔房整理当前对话的纸条均不存在或不再开放。',
  '待确认候选在屋主或当前访客明确确认前不是长期记忆。',
].join('');

export { VERSION as coastMcpVersion };
