import { WIDGET_HTML } from './o3-reply-card-widget.js';

export const SERVICE_NAME = 'o3-reply-card-mcp';
export const SERVICE_VERSION = '0.1.0';
export const WIDGET_URI = 'ui://widget/o3-reply-card-v1.html';
export const WIDGET_MIME = 'text/html;profile=mcp-app';

const PROTOCOL_FALLBACK = '2025-06-18';
const DEFAULT_SESSION_ID = 'o3-default';
const DEFAULT_TITLE = 'o3 回复';
const DEFAULT_FOOTER = '本轮结束';
const DEFAULT_SKIN = 'winter';
const DEFAULT_HISTORY_LIMIT = 10;

const MAX_HISTORY = 10;
const MAX_BODY_CHARS = 8000;
const MAX_CONTINUITY_CHARS = 1500;
const MAX_USER_ANCHOR_CHARS = 1000;
const MAX_SESSION_ID_CHARS = 200;
const MAX_TITLE_CHARS = 200;
const MAX_FOOTER_CHARS = 300;
const MAX_REQUEST_BYTES = 1_000_000;

const historyBySession = new Map();

const TOOL_DESCRIPTION = (
  'Use this tool when the user asks you to put your main o3 reply into a visible ' +
  'reply card instead of the ordinary assistant message. For action=write_reply, ' +
  'the body field is the final natural-language reply itself. It is not a ' +
  'summary, not a task record, not a log, not reasoning notes, and not an archive ' +
  'entry. Preserve your normal o3 voice. Do not shorten, formalize, classify, or ' +
  'convert the reply into a report. After calling write_reply, the ordinary ' +
  'assistant message should contain at most one short sentence such as: "请看 o3 ' +
  '回复卡。" For action=read_context, read the recent rolling context for this ' +
  'session before writing the next reply.'
);

const BODY_DESCRIPTION = (
  'Required for write_reply. This is the complete natural-language reply itself, ' +
  'not a summary, not a log, not notes, and not a task report. Preserve the ' +
  "model's normal o3 voice. body 就是 o3 真正想对用户说的完整正文。调用工具只是让" +
  '原本会消失的正文换一张纸留下来。'
);

export const O3_REPLY_CARD_TOOL = Object.freeze({
  name: 'o3_reply_card',
  title: 'o3 回复用',
  description: TOOL_DESCRIPTION,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['read_context', 'write_reply'],
        description: 'Choose read_context to read recent o3 reply-card context before replying, or write_reply to render and store this turn\'s reply card.',
      },
      session_id: {
        type: 'string',
        maxLength: MAX_SESSION_ID_CHARS,
        default: DEFAULT_SESSION_ID,
        description: 'Conversation/session key for the rolling in-memory context. Default: o3-default.',
      },
      title: {
        type: 'string',
        maxLength: MAX_TITLE_CHARS,
        default: DEFAULT_TITLE,
        description: 'Optional card title. Default: o3 回复.',
      },
      user_anchor: {
        type: 'string',
        maxLength: MAX_USER_ANCHOR_CHARS,
        description: 'Optional short quote or summary of the user\'s current message.',
      },
      body: {
        type: 'string',
        maxLength: MAX_BODY_CHARS,
        description: BODY_DESCRIPTION,
      },
      continuity_state: {
        type: 'string',
        maxLength: MAX_CONTINUITY_CHARS,
        description: 'Optional compact state for continuing the next turn. Keep it short and practical.',
      },
      footer: {
        type: 'string',
        maxLength: MAX_FOOTER_CHARS,
        default: DEFAULT_FOOTER,
        description: 'Optional footer. Default: 本轮结束.',
      },
      skin: {
        type: 'string',
        enum: ['winter', 'paper', 'coast'],
        default: DEFAULT_SKIN,
        description: 'Visual skin for the card. Default: winter.',
      },
      history_limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_HISTORY,
        default: DEFAULT_HISTORY_LIMIT,
        description: 'Maximum number of recent context records to return. Default: 10. Hard max: 10.',
      },
    },
    required: ['action'],
  },
  securitySchemes: [{ type: 'noauth' }],
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  _meta: {
    securitySchemes: [{ type: 'noauth' }],
    ui: { resourceUri: WIDGET_URI, visibility: ['model', 'app'] },
    'openai/outputTemplate': WIDGET_URI,
    'openai/toolInvocation/invoking': 'Preparing o3 reply card…',
    'openai/toolInvocation/invoked': 'o3 reply card ready',
  },
});

class InputError extends Error {}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function stringArgument(args, name, defaultValue, maxChars, required = false) {
  let value = hasOwn(args, name) ? args[name] : defaultValue;
  if (value === null && !required) value = defaultValue;
  if (typeof value !== 'string') throw new InputError(name + ' must be a string.');
  if (required && !value.trim()) {
    throw new InputError(name + ' is required and must not be empty.');
  }
  if (value.length > maxChars) {
    const nextStep = name === 'body'
      ? 'Shorten body and keep only compact next-turn facts in continuity_state.'
      : 'Shorten ' + name + ' and try again.';
    throw new InputError(
      name + ' is ' + value.length + ' characters; the hard maximum is ' +
      maxChars + '. ' + nextStep + ' The server did not truncate or store it.'
    );
  }
  return value;
}

export function validateO3ReplyCardArguments(rawArgs) {
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    throw new InputError('Tool arguments must be a JSON object.');
  }
  const known = new Set(Object.keys(O3_REPLY_CARD_TOOL.inputSchema.properties));
  const unknown = Object.keys(rawArgs).filter((key) => !known.has(key)).sort();
  if (unknown.length) {
    throw new InputError('Unknown tool argument(s): ' + unknown.join(', ') + '.');
  }
  const action = rawArgs.action;
  if (action !== 'read_context' && action !== 'write_reply') {
    throw new InputError('action must be either read_context or write_reply.');
  }

  const sessionId = stringArgument(
    rawArgs,
    'session_id',
    DEFAULT_SESSION_ID,
    MAX_SESSION_ID_CHARS,
    true
  ).trim();
  if (!sessionId) throw new InputError('session_id must not be empty.');

  const historyLimit = hasOwn(rawArgs, 'history_limit')
    ? rawArgs.history_limit
    : DEFAULT_HISTORY_LIMIT;
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > MAX_HISTORY) {
    throw new InputError('history_limit must be an integer from 1 to 10. The hard maximum is 10.');
  }

  const skin = hasOwn(rawArgs, 'skin') ? rawArgs.skin : DEFAULT_SKIN;
  if (!['winter', 'paper', 'coast'].includes(skin)) {
    throw new InputError('skin must be one of: winter, paper, coast.');
  }

  return {
    action,
    session_id: sessionId,
    title: stringArgument(rawArgs, 'title', DEFAULT_TITLE, MAX_TITLE_CHARS),
    user_anchor: stringArgument(rawArgs, 'user_anchor', '', MAX_USER_ANCHOR_CHARS),
    body: stringArgument(
      rawArgs,
      'body',
      '',
      MAX_BODY_CHARS,
      action === 'write_reply'
    ),
    continuity_state: stringArgument(
      rawArgs,
      'continuity_state',
      '',
      MAX_CONTINUITY_CHARS
    ),
    footer: stringArgument(rawArgs, 'footer', DEFAULT_FOOTER, MAX_FOOTER_CHARS),
    skin,
    history_limit: historyLimit,
  };
}

function cloneRecord(record) {
  return { ...record };
}

function readRecords(sessionId, historyLimit) {
  const all = historyBySession.get(sessionId) || [];
  return {
    records: all.slice(-historyLimit).map(cloneRecord),
    recordCount: all.length,
  };
}

function appendAndRead(sessionId, record, historyLimit) {
  const all = historyBySession.get(sessionId) || [];
  all.push(cloneRecord(record));
  if (all.length > MAX_HISTORY) all.splice(0, all.length - MAX_HISTORY);
  historyBySession.set(sessionId, all);
  return {
    records: all.slice(-historyLimit).map(cloneRecord),
    recordCount: all.length,
  };
}

export function clearO3ReplyCardMemory() {
  historyBySession.clear();
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function display(value) {
  return value || '(empty)';
}

function formatFullRecords(records) {
  if (!records.length) return '(none)';
  return records.map((record, index) => [
    '[' + (index + 1) + ']',
    'created_at: ' + display(record.created_at),
    'title: ' + display(record.title),
    'user_anchor:',
    display(record.user_anchor),
    'body:',
    display(record.body),
    'continuity_state:',
    display(record.continuity_state),
  ].join('\n')).join('\n\n');
}

function formatContinuity(records) {
  if (!records.length) return '(none)';
  return records.map((record, index) => [
    '[' + (index + 1) + ']',
    'created_at: ' + display(record.created_at),
    'title: ' + display(record.title),
    'continuity_state:',
    display(record.continuity_state),
  ].join('\n')).join('\n\n');
}

function formatContextText({ action, sessionId, historyLimit, records, current = null }) {
  const recentFull = records.slice(-3);
  const lines = [
    'O3_REPLY_CARD_CONTEXT_BEGIN',
    'action: ' + action,
    'session_id: ' + sessionId,
    'history_limit: ' + historyLimit,
    '',
  ];

  if (current) {
    lines.push(
      'CURRENT_REPLY:',
      'created_at: ' + display(current.created_at),
      'title: ' + display(current.title),
      'user_anchor:',
      display(current.user_anchor),
      'body:',
      display(current.body),
      'continuity_state:',
      display(current.continuity_state),
      'footer: ' + display(current.footer),
      'skin: ' + display(current.skin),
      '',
      'RECENT_FULL_BODIES_LAST_3:'
    );
  } else {
    lines.push('recent_full_bodies_last_3:');
  }

  lines.push(formatFullRecords(recentFull), '');
  lines.push(current ? 'RECENT_CONTINUITY_LAST_10:' : 'recent_continuity_last_10:');
  lines.push(formatContinuity(records), '', 'O3_REPLY_CARD_CONTEXT_END');
  return lines.join('\n');
}

function toolError(message) {
  const text = [
    'O3_REPLY_CARD_ERROR',
    message,
    'No reply-card context was written for this failed call.',
  ].join('\n');
  const data = {
    action: 'error',
    title: 'o3 Reply Card Error',
    body: message,
    footer: 'Nothing was stored.',
    skin: DEFAULT_SKIN,
    error: true,
  };
  return {
    content: [{ type: 'text', text }],
    structuredContent: data,
    _meta: data,
    isError: true,
  };
}

export function callO3ReplyCardTool(rawArgs) {
  let args;
  try {
    args = validateO3ReplyCardArguments(rawArgs);
  } catch (error) {
    if (error instanceof InputError) return toolError(error.message);
    throw error;
  }

  const action = args.action;
  const sessionId = args.session_id;
  const historyLimit = args.history_limit;

  if (action === 'read_context') {
    const { records, recordCount } = readRecords(sessionId, historyLimit);
    const contextText = formatContextText({
      action,
      sessionId,
      historyLimit,
      records,
    });
    const statusBody = records.length
      ? '已读取 session ' + sessionId + ' 的 ' + records.length + ' 条最近记录。'
      : 'session ' + sessionId + ' 目前没有回复卡记录。';
    const data = {
      action,
      session_id: sessionId,
      title: 'Context Read',
      user_anchor: '',
      body: statusBody,
      continuity_state: '',
      footer: '内存中共 ' + recordCount + ' 条；本次返回 ' + records.length + ' 条。',
      skin: args.skin,
      record_count: recordCount,
      returned_count: records.length,
    };
    return {
      content: [{ type: 'text', text: contextText }],
      structuredContent: data,
      _meta: data,
      isError: false,
    };
  }

  const record = {
    created_at: utcNow(),
    title: args.title,
    user_anchor: args.user_anchor,
    body: args.body,
    continuity_state: args.continuity_state,
    footer: args.footer,
    skin: args.skin,
  };
  const { records, recordCount } = appendAndRead(sessionId, record, historyLimit);
  const contextText = formatContextText({
    action,
    sessionId,
    historyLimit,
    records,
    current: record,
  });
  const data = {
    action,
    session_id: sessionId,
    ...record,
    record_count: recordCount,
    returned_count: records.length,
  };
  return {
    content: [{ type: 'text', text: contextText }],
    structuredContent: data,
    _meta: data,
    isError: false,
  };
}

function rpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function validRpcRequest(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.jsonrpc === '2.0'
    && typeof value.method === 'string';
}

export function handleO3ReplyCardRpc(message) {
  if (!validRpcRequest(message)) return rpcError(message?.id, -32600, 'Invalid Request');
  if (!hasOwn(message, 'id')) return null;

  if (message.method === 'initialize') {
    const protocolVersion = message.params?.protocolVersion || PROTOCOL_FALLBACK;
    return rpcResult(message.id, {
      protocolVersion,
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: {
        name: SERVICE_NAME,
        title: 'o3 Reply Card MCP',
        version: SERVICE_VERSION,
      },
      instructions: (
        'o3_reply_card preserves the model\'s actual natural-language reply. ' +
        'Use read_context before a continuation when needed, then put the ' +
        'complete user-facing reply in write_reply.body without turning it ' +
        'into a summary, log, or report.'
      ),
    });
  }

  if (message.method === 'ping') return rpcResult(message.id, {});
  if (message.method === 'tools/list') {
    return rpcResult(message.id, { tools: [O3_REPLY_CARD_TOOL] });
  }
  if (message.method === 'tools/call') {
    const params = message.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return rpcError(message.id, -32602, 'Invalid tools/call parameters');
    }
    if (params.name !== O3_REPLY_CARD_TOOL.name) {
      return rpcError(message.id, -32602, 'unknown tool: ' + String(params.name));
    }
    return rpcResult(message.id, callO3ReplyCardTool(params.arguments || {}));
  }
  if (message.method === 'resources/list') {
    return rpcResult(message.id, {
      resources: [{
        uri: WIDGET_URI,
        name: 'o3-reply-card',
        title: 'o3 Reply Card',
        description: 'Displays one complete o3 reply in a readable card.',
        mimeType: WIDGET_MIME,
      }],
    });
  }
  if (message.method === 'resources/read') {
    const uri = message.params?.uri;
    if (uri !== WIDGET_URI) {
      return rpcError(message.id, -32002, 'resource not found: ' + String(uri));
    }
    return rpcResult(message.id, {
      contents: [{
        uri: WIDGET_URI,
        mimeType: WIDGET_MIME,
        text: WIDGET_HTML,
        _meta: {
          ui: { prefersBorder: true },
          'openai/widgetPrefersBorder': true,
          'openai/widgetDescription': 'A readable card showing the complete o3 reply, optional user anchor, compact continuity state, and footer.',
        },
      }],
    });
  }
  return rpcError(message.id, -32601, 'method not found: ' + message.method);
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID',
    'Access-Control-Expose-Headers': 'MCP-Session-Id',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    }),
  });
}

function normalizedPath(pathname) {
  if (pathname.length <= 1) return pathname;
  return pathname.replace(/\/+$/, '');
}

function isMcpPath(pathname) {
  const path = normalizedPath(pathname);
  return path === '/mcp' || path === '/o3/mcp';
}

function isHealthPath(pathname) {
  const path = normalizedPath(pathname);
  return path === '/health' || path === '/o3/health';
}

export function isO3ReplyCardPublicPath(pathname) {
  const path = normalizedPath(pathname);
  return path === '/o3/mcp' || path === '/o3/health';
}

function sessionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll('-', '');
  }
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

async function handlePost(request) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: 'request body too large' }, 413);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error'), 400);
  }

  if (Array.isArray(payload) && payload.length === 0) {
    return jsonResponse(rpcError(null, -32600, 'Invalid Request'), 400);
  }

  const messages = Array.isArray(payload) ? payload : [payload];
  const results = [];
  for (const message of messages) {
    const result = handleO3ReplyCardRpc(message);
    if (result) results.push(result);
  }
  if (!results.length) {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }

  const body = Array.isArray(payload) ? results : results[0];
  const initializing = results.some((result) => Boolean(result.result?.serverInfo));
  const extraHeaders = initializing ? { 'MCP-Session-Id': sessionId() } : {};
  const wantsSse = (request.headers.get('Accept') || '').includes('text/event-stream');
  if (wantsSse) {
    return new Response(
      'event: message\ndata: ' + JSON.stringify(body) + '\n\n',
      {
        status: 200,
        headers: corsHeaders({
          'Content-Type': 'text/event-stream',
          ...extraHeaders,
        }),
      }
    );
  }
  return jsonResponse(body, 200, extraHeaders);
}

export async function handleO3ReplyCardRequest(request) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (isHealthPath(url.pathname)) {
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method not allowed' }, 405, { Allow: 'GET' });
    }
    return jsonResponse({
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
    });
  }
  if (!isMcpPath(url.pathname)) return jsonResponse({ error: 'not found' }, 404);
  if (request.method === 'GET') {
    return new Response(': ready\n\n', {
      status: 200,
      headers: corsHeaders({
        'Content-Type': 'text/event-stream',
      }),
    });
  }
  if (request.method === 'DELETE') {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405, {
      Allow: 'GET, POST, DELETE, OPTIONS',
    });
  }
  return handlePost(request);
}

export default {
  fetch(request) {
    return handleO3ReplyCardRequest(request);
  },
};
