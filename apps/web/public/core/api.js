export const API = Object.freeze({
  health: '/api/health',
  v1Snapshot: '/api/export/v1-snapshot',
  fullArchive: '/api/export/full-archive',
  session: '/api/session',
  models: '/api/models',
  chat: '/api/chat',
  attachments: '/api/chat/attachments',
  messageMetadata: '/api/chat/message-metadata',
  landingLetter: '/api/chat/landing-letter',
  conversations: '/api/chat/conversations',
  history: '/api/chat/history',
  profile: '/api/chat/profile',
  title: '/api/chat/title',
  crossWindowSources: '/api/chat/cross-window/sources',
  crossWindowMessages: '/api/chat/cross-window/messages',
  crossWindowRead: '/api/chat/cross-window/read',
  memorySoil: '/api/memory/soil',
  memorySoilOrganize: '/api/memory/soil/organize',
  memoryPockets: '/api/memory/pockets',
  memoryEntries: '/api/memory/entries',
  memoryCustomInstructions: '/api/memory/custom-instructions',
  memoryGlobalExcerpt: '/api/memory/global-excerpt',
  memorySearch: '/api/memory/search',
  memoryRecall: '/api/memory/recall',
  memoryVectorStatus: '/api/memory/vector-status',
  dailyMoments: '/api/daily/moments',
  dailyDiaries: '/api/daily/diaries',
  dailyProfile: '/api/daily/profile',
  humanThought: '/api/human-thought',
  externalMessages: '/api/external/messages',
  externalStatus: '/api/external/status',
  externalMcpContract: '/api/external/mcp-contract',
  mailboxMe: '/api/mailbox/me',
  mailboxMessages: '/api/mailbox/messages',
  mailboxSend: '/api/mailbox/send',
  mailboxStatus: '/api/mailbox/status',
  mailboxMemory: '/api/mailbox/memory',
  mailboxAccount: '/api/mailbox/account',
  worldbook: '/api/worldbook',
  worldbookTest: '/api/worldbook/test-match',
  workbenchTools: '/api/workbench/tools',
  workbenchRuns: '/api/workbench/runs',
  devSelfCheck: '/api/workbench/dev/self-check',
  devLogs: '/api/workbench/dev/logs',
});

export class ApiError extends Error {
  constructor(message, { type = 'request_failed', status = 0, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.type = type;
    this.status = status;
    this.details = details;
  }
}

export async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = data?.error;
    throw new ApiError(
      typeof error === 'string' ? error : error?.message || `请求失败（${response.status}）`,
      {
        type: error?.type || 'request_failed',
        status: response.status,
        details: error || data,
      },
    );
  }
  return data;
}
