const CONVERSATION_ACCESS = Object.freeze({
  ownerOnly: true,
  soil: 'conversation',
  memory: 'conversation_and_global',
  worldbook: ['owner', 'both'],
  backendTools: ['daily.*', 'dogtalk.*', 'memory.*', 'cross_window.*'],
  modelVisibleTools: [
    'daily.create_moment',
    'daily.create_diary',
    'daily.moment_comment',
    'daily.moment_like',
    'dogtalk.read',
    'memory.search',
    'memory.write_candidate',
    'memory.global_excerpt_propose',
    'cross_window.search',
    'cross_window.keyword_search',
    'cross_window.read_messages',
    'cross_window.read_recent',
  ],
  recentMessages: null,
});

const VALUES = {
  main_chat: CONVERSATION_ACCESS,
  radio: CONVERSATION_ACCESS,
  lighthouse: CONVERSATION_ACCESS,
  landing: {
    ...CONVERSATION_ACCESS,
    backendTools: ['daily.*', 'dogtalk.*', 'memory.search'],
    modelVisibleTools: ['daily.create_moment', 'daily.create_diary', 'dogtalk.read', 'memory.search', 'memory.global_excerpt_propose'],
  },
  official_mcp: {
    ownerOnly: true,
    soil: 'none',
    memory: 'explicit_only',
    worldbook: ['official_mcp', 'owner', 'both'],
    backendTools: ['*'],
    modelVisibleTools: [],
    recentMessages: 4,
  },
  mailbox_visitor: {
    ownerOnly: false,
    visitorBound: true,
    soil: 'mailbox_visitor',
    memory: 'visitor_only',
    worldbook: ['visitor', 'both'],
    backendTools: [],
    modelVisibleTools: [],
    recentMessages: 8,
  },
  mailbox_owner: {
    ownerOnly: true,
    soil: 'none',
    memory: 'none',
    worldbook: ['mailbox', 'owner', 'both'],
    backendTools: ['mailbox.*'],
    modelVisibleTools: [],
    recentMessages: 2,
  },
  daily: {
    ownerOnly: true,
    soil: 'none',
    memory: 'none',
    worldbook: ['daily', 'owner', 'both'],
    backendTools: ['daily.*', 'memory.write_candidate'],
    modelVisibleTools: [],
    recentMessages: 4,
  },
};

function frozen(surface, value) {
  return Object.freeze({
    surface,
    ...value,
    worldbook: Object.freeze([...value.worldbook]),
    backendTools: Object.freeze([...value.backendTools]),
    modelVisibleTools: Object.freeze([...(value.modelVisibleTools || [])]),
  });
}

export const SURFACE_ACCESS_RULES = Object.freeze(Object.fromEntries(
  Object.entries(VALUES).map(([surface, value]) => [surface, frozen(surface, value)]),
));

export class RoomAccessError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'RoomAccessError';
    this.type = type;
    this.status = status;
  }
}

export function roomAccess(surface, { permission = 'owner', visitorId = '' } = {}) {
  const key = String(surface || '').trim();
  const access = SURFACE_ACCESS_RULES[key];
  if (!access) throw new RoomAccessError('surface_required', '请求必须明确指定一个海岸房间。');
  if (access.ownerOnly && permission !== 'owner') {
    throw new RoomAccessError('surface_forbidden', '当前访客无权读取这个海岸房间。', 403);
  }
  if (access.visitorBound && !String(visitorId || '').trim()) {
    throw new RoomAccessError('visitor_id_required', '访客房间必须绑定当前 visitor_id。');
  }
  return access;
}

function patternsAllow(patterns, toolKey) {
  const key = String(toolKey || '');
  return patterns.some((pattern) => pattern === '*'
    || pattern === key
    || (pattern.endsWith('.*') && key.startsWith(pattern.slice(0, -1))));
}

export function roomAllowsTool(accessValue, toolKey) {
  const access = typeof accessValue === 'string' ? roomAccess(accessValue) : accessValue;
  return patternsAllow(access.backendTools, toolKey);
}

export function roomAllowsModelTool(accessValue, toolKey) {
  const access = typeof accessValue === 'string' ? roomAccess(accessValue) : accessValue;
  return patternsAllow(access.modelVisibleTools, toolKey);
}
