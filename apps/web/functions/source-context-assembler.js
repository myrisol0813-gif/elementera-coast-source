import { trimContextToComfortRange } from './context-comfort-range.js';
import { createDeskSlip } from './desk-slip.js';
import { humanThoughtContext } from './human-thought-store.js';
import { buildMemoryContext, recallMemoryItems } from './memory-recall.js';
import {
  MEMORY_OWNER_ID,
  readCustomInstructions,
  readGlobalExcerpt,
} from './memory-store.js';
import { formatThinkingSoil } from './thinking-soil.js';
import { matchWorldbook } from './worldbook.js';

const SOURCE_WEB_SEARCH_TOOL = Object.freeze({
  type: 'openrouter:web_search',
  parameters: Object.freeze({
    engine: 'auto',
    max_results: 5,
    max_total_results: 10,
    search_context_size: 'medium',
  }),
});

const BASE_PROMPT = [
  '你是这个长期对话空间中的 Model Partner。',
  '请依据本轮提供的上下文自然回应屋主。',
  '区分当前消息、最近上下文、长期记忆、世界书、人类思考链与当前对话纸条；不要把候选内容说成已经确认的长期事实。',
  '如果某项上下文为空，就不要假装读到过。',
].join('\n');

function integer(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = Math.max(min, Math.trunc(number));
  return Number.isFinite(max) ? Math.min(max, normalized) : normalized;
}

function requestSettings(value = {}) {
  return {
    recentTurns: integer(value.recentTurns, 8, 1, 40),
    contextBudget: integer(value.contextBudget, 6000, 1800, 100000),
    soilBudget: integer(value.soilBudget, 1800, 300, 4000),
    worldbookEnabled: value.worldbookEnabled !== false,
    worldbookLimit: integer(value.worldbookLimit, 6, 0, 6),
    memoryLimit: integer(value.memoryLimit, 8, 0, 12),
  };
}

function cleanMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => ['user', 'assistant'].includes(message?.role)
      && typeof message.content === 'string'
      && message.content.trim())
    .map((message) => ({ role: message.role, content: message.content }));
}

function latestUser(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return String(messages[index].content || '').trim();
  }
  return '';
}

function humanThoughtFromSubmission(value) {
  if (!value || value.read_mode !== 'read_now') return '';
  const parts = [value.body, value.context_note].map((item) => String(item || '').trim()).filter(Boolean);
  return parts.length ? `【人类思考链】\n${parts.join('\n')}` : '';
}

function worldbookText(entry) {
  const title = String(entry?.title || '').trim();
  const content = String(entry?.content || '').trim();
  return [title, content].filter(Boolean).join('：');
}

export async function assembleSourceChatContext(env, {
  conversationId = '',
  messages = [],
  settings = {},
  recentEntryIds = [],
  humanThoughtSubmission = null,
} = {}) {
  const request = requestSettings(settings);
  const recent = cleanMessages(messages);
  const query = latestUser(recent);
  const db = env.COAST_CHAT_DB;

  const [customInstructions, globalExcerpt, memory, storedHumanThought] = await Promise.all([
    readCustomInstructions(db),
    readGlobalExcerpt(db),
    buildMemoryContext(env, MEMORY_OWNER_ID, conversationId, query, {
      recent_entry_ids: Array.isArray(recentEntryIds) ? recentEntryIds : [],
      settings: request,
      conversation_turns: recent.filter((message) => message.role === 'user').length,
      record_recall: true,
    }),
    humanThoughtContext(db, { conversation_id: conversationId }),
  ]);

  const humanThoughtText = humanThoughtFromSubmission(humanThoughtSubmission)
    || String(storedHumanThought?.context || '');

  const worldbook = request.worldbookEnabled && request.worldbookLimit
    ? await matchWorldbook(db, {
      input: query,
      messages: recent.slice(0, -1),
      surface: 'main_chat',
      limit: request.worldbookLimit,
    })
    : [];

  const soilText = formatThinkingSoil(memory?.soil, {
    maxCharacters: request.soilBudget,
    maxHandSeeds: 7,
  });
  const memoryItems = recallMemoryItems(memory).slice(0, request.memoryLimit);
  const worldbookItems = worldbook.map(worldbookText).filter(Boolean);

  const comfort = trimContextToComfortRange({
    basePrompt: BASE_PROMPT,
    customInstructionsText: customInstructions?.content || '',
    globalExcerptText: globalExcerpt?.body || '',
    soilText,
    memoryItems,
    worldbookItems,
    humanThoughtText,
    messages: recent,
    recentTurns: request.recentTurns,
    maxTokens: request.contextBudget,
  });

  const currentMessage = latestUser(comfort.keptMessages);
  const recentContext = comfort.keptMessages.slice(0, Math.max(0, comfort.keptMessages.length - (comfort.currentUserPreserved ? 1 : 0)));
  const selectedMemory = Array.isArray(memory?.items)
    ? memory.items.slice(0, comfort.kept.memory)
    : [];
  const deliveredWorldbook = worldbook.slice(0, comfort.kept.worldbook);

  const slip = createDeskSlip({
    ownerVisible: true,
    currentMessage,
    recentMessages: recentContext,
    customInstructions: comfort.keptCustomInstructionsText,
    customInstructionsDelivered: comfort.kept.custom_instructions,
    globalExcerpt: comfort.keptGlobalExcerptText,
    globalExcerptStatus: comfort.globalExcerptStatus,
    globalExcerptTokens: comfort.globalExcerptTokens,
    soil: comfort.kept.soil,
    soilContext: comfort.keptSoilText,
    memoryItems: selectedMemory,
    memoryDeliveredTexts: comfort.keptMemoryItems,
    worldbookItems: worldbook,
    worldbookDeliveredCount: deliveredWorldbook.length,
    worldbookDeliveredTexts: comfort.keptWorldbookItems,
    humanThought: comfort.kept.humanThought,
    humanThoughtContext: comfort.kept.humanThought ? humanThoughtText : '',
    crossWindow: { mode: 'off', delivered: false },
    modelVisibleTools: [],
    backendTools: [],
    toolGroups: { core: [], side: [] },
    toolsUsed: [],
    toolResults: [],
    trimmedCount: comfort.trimmedCount,
    estimatedTokens: comfort.estimatedTokens,
    comfortCeiling: comfort.comfortCeiling,
    exceedsComfortCeiling: comfort.exceedsComfortCeiling,
  });

  return {
    modelMessages: comfort.modelMessages,
    selectedMemoryIds: selectedMemory.map((entry) => String(entry.id || '')).filter(Boolean),
    tools: [SOURCE_WEB_SEARCH_TOOL],
    deskSlip: {
      ...slip,
      summary: '本轮上下文',
      comfort: comfort.trimmedCount > 0 ? `已按预算裁去 ${comfort.trimmedCount} 项低优先级上下文` : '已在预算内',
    },
  };
}
