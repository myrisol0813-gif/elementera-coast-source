import { trimContextToComfortRange } from './context-comfort-range.js';
import {
  crossWindowDeskSection,
  normalizeCrossWindowRequest,
  readCrossWindow,
} from './cross-window-service.js';
import { createDeskSlip } from './desk-slip.js';
import { dogtalkContext } from './dogtalk-store.js';
import { buildMemoryContext, recallMemoryItems } from './memory-recall.js';
import { MEMORY_OWNER_ID, readCustomInstructions, readGlobalExcerpt } from './memory-store.js';
import { currentMailboxVisitor, mailboxMessages } from './mailbox-service.js';
import { listVisitorNotebook, readMailboxThoughtSoil } from './mailbox-repository.js';
import { roomAccess } from './surface-access-rules.js';
import { formatThinkingSoil } from './thinking-soil.js';
import { executeModelTool, resolveToolSelection } from './tool-registry.js';
import { sanitizeFurnitureRuns } from './tool-furniture-summary.js';
import { matchWorldbook } from './worldbook.js';

const OWNER_TECHNICAL_PROMPT = '遵循本轮提供的上下文与屋主保存的自定义指令回应。工具调用必须如实；没有执行成功的动作不能说成已经完成。';
const OWNER_CUSTOM_INSTRUCTION_SURFACES = new Set(['main_chat', 'landing', 'radio', 'lighthouse']);
const CROSS_WINDOW_SURFACES = new Set(['main_chat', 'radio']);
const WEB_SEARCH_SURFACES = new Set(['main_chat', 'radio']);
const WEB_SEARCH_SERVER_TOOL = Object.freeze({
  type: 'openrouter:web_search',
  parameters: Object.freeze({
    engine: 'auto',
    max_results: 5,
    max_total_results: 10,
    search_context_size: 'medium',
  }),
});
const WEB_SEARCH_TOOL_RECORD = Object.freeze({
  tool_key: 'web.search',
  display_name: '网络搜索',
  description: '按当前问题需要搜索公开网络。由 OpenRouter server tool 执行，模型决定是否调用。',
  model_group: 'core',
  model_name: 'openrouter:web_search',
  privacy_level: 'public_web',
  summary_policy: 'sources_only',
});
const VISITOR_PROMPT = ['你是另一位屋主，正在访客信箱里与一位来访朋友慢速通信。', '语气温柔、清醒、自然，认真回应这位朋友此刻写来的内容。'].join('\n');
function integer(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = Math.max(min, Math.trunc(number));
  return Number.isFinite(max) ? Math.min(max, normalized) : normalized;
}
function requestSettings(value = {}) {
  return {
    recentTurns: integer(value.recentTurns, 8, 1),
    comfortTokens: integer(value.contextBudget, 6000, 1800),
    soilCharacters: integer(value.soilBudget, 1800, 300, 4000),
    worldbookEnabled: value.worldbookEnabled !== false,
    worldbookLimit: integer(value.worldbookLimit, 6, 0, 6),
    memoryLimit: integer(value.memoryLimit, 8, 0, 12),
  };
}
function effectiveRecentTurns(request, access) {
  const cap = Number(access?.recentMessages);
  return Number.isFinite(cap) && cap > 0
    ? Math.min(request.recentTurns, Math.trunc(cap))
    : request.recentTurns;
}
function cleanHistory(messages, recentTurns) {
  const cleaned = (Array.isArray(messages) ? messages : []).filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string' && message.content.trim()).map((message) => ({ role: message.role, content: message.content }));
  const current = cleaned.at(-1)?.role === 'user' ? cleaned.pop() : null; const recent = cleaned.slice(-recentTurns * 2); return current ? [...recent, current] : recent;
}
function ensureCurrentUser(messages, lastUser) { const content = String(lastUser?.content ?? lastUser ?? '').trim(); if (!content) return messages; const last = messages.at(-1); return last?.role === 'user' && last.content === content ? messages : [...messages, { role: 'user', content }]; }
function mailboxHistory(records) { return (Array.isArray(records) ? records : []).map((message) => ({ role: message.role === 'visitor' ? 'user' : 'assistant', content: String(message.content || '') })).filter((message) => message.content.trim()); }
function notebookItems(entries) { return (Array.isArray(entries) ? entries : []).map((entry) => [String(entry.title || '').trim(), String(entry.life_core || entry.content || '').trim()].filter(Boolean).join('｜')).filter(Boolean); }
function visitorNotebookMatches(entries, query, limit) {
  const needle = String(query || '').toLocaleLowerCase('zh-CN').trim(); if (!needle) return [];
  const terms = [...new Set(needle.split(/[\s,，。！？!?、:：;；()（）「」“”]+/).map((item) => item.trim()).filter((item) => item.length >= 2))].slice(0, 12);
  const explicit = /(还记得|记事本|以前说过|我们聊过|回想)/u.test(needle);
  const ranked = (Array.isArray(entries) ? entries : []).map((entry, index) => {
    const text = [entry.title, entry.life_core, entry.content].map((item) => String(item || '').toLocaleLowerCase('zh-CN')).join(' ');
    const direct = text.includes(needle) ? 4 : 0; const matched = terms.filter((term) => text.includes(term)).length; return { entry, score: direct + matched, index };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.index - right.index).slice(0, limit).map((item) => item.entry);
  if (ranked.length || !explicit) return ranked; return (Array.isArray(entries) ? entries : []).slice(0, Math.min(4, limit));
}
async function roomPapers(env, access, { conversationId, visitorId, query, recent, recentEntryIds, request, preview } = {}) {
  if (access.memory === 'conversation_and_global') {
    const memory = await buildMemoryContext(env, MEMORY_OWNER_ID, conversationId, query, { recent_entry_ids: recentEntryIds, settings: { ...request, memoryLimit: request.memoryLimit }, conversation_turns: recent.filter((message) => message.role === 'user').length, record_recall: !preview });
    return { memory, soil: memory.soil, recent, dogtalk: null };
  }
  if (access.memory === 'visitor_only') {
    await currentMailboxVisitor(env.COAST_CHAT_DB, visitorId);
    const [soil, entries, stored] = await Promise.all([readMailboxThoughtSoil(env.COAST_CHAT_DB, visitorId), listVisitorNotebook(env.COAST_CHAT_DB, visitorId), recent.length ? Promise.resolve([]) : mailboxMessages(env.COAST_CHAT_DB, visitorId)]);
    const selectedEntries = visitorNotebookMatches(entries, query, request.memoryLimit);
    return { memory: { visitor_memories: selectedEntries, selected_ids: selectedEntries.map((entry) => entry.id), vector_enabled: false }, soil, recent: recent.length ? recent : mailboxHistory(stored).slice(-request.recentTurns * 2), dogtalk: null };
  }
  return { memory: null, soil: null, recent, dogtalk: null };
}
function workbenchPrompt(query, toolCount) { if (!toolCount || !/(记忆|落袋|动态|日记|人类思考链|跨窗口|信箱|共通聊天室|MCP 对话区|工具|工作台)/u.test(String(query || ''))) return ''; return '【工作台】\n前端里有一些可使用的工具。需要时再用，不必为了使用而使用。'; }
function soilDeskSnapshot(deliveredText, value) {
  const text = String(deliveredText || ''); const lines = text.split('\n'); const current = []; const handSeeds = []; let readingSeeds = false;
  for (const line of lines) {
    if (line.startsWith('当前：')) { current.push(line.slice('当前：'.length)); readingSeeds = false; continue; }
    if (line === '当前活跃线索：') { readingSeeds = true; continue; }
    if (readingSeeds && line.startsWith('- ')) { handSeeds.push(line.slice(2)); continue; }
    if (line && !/^【整理当前对话的纸条】$/.test(line)) readingSeeds = false;
  }
  const roots = value?.sources && typeof value.sources === 'object' ? Object.values(value.sources) : [value?.soil || value].filter(Boolean);
  return { context: text, current_text: current.join('\n'), hand_seeds: handSeeds, pocket_candidates_count: roots.reduce((sum, soil) => sum + (Array.isArray(soil?.pocket_candidates) ? soil.pocket_candidates.length : 0), 0) };
}

function crossWindowSourceText(item) {
  const title = item.source === 'rikkahub' ? `【Rikka】${item.title}` : item.title;
  const kind = item.source === 'rikkahub' ? 'RikkaHub' : item.room_type === 'radio' ? '共通聊天室' : item.room_type === 'lighthouse' ? 'MCP 对话区' : '主聊天';
  const messages = item.messages.map((message) => `${message.role === 'assistant' ? '另一位屋主' : '用户'}：${message.content}`).join('\n');
  return `来源窗口：${kind}｜${title}｜${item.delivered_turns}轮｜更新于 ${item.updated_at}\n${messages}`;
}

function manualCrossWindowItems(result) {
  return (Array.isArray(result?.items) ? result.items : []).map((item) => ({ id: item.conversation_id, text: crossWindowSourceText(item) }));
}

function resultWithinComfort(result, keptIds) {
  if (!result) return null;
  const ids = new Set(Array.isArray(keptIds) ? keptIds : []);
  const items = result.items.filter((item) => ids.has(item.conversation_id));
  const totalDelivered = items.reduce((sum, item) => sum + item.delivered_turns, 0);
  const comfortTrimmed = items.length < result.items.length;
  return {
    ...result,
    items,
    total_delivered_turns: totalDelivered,
    trimmed: Boolean(result.trimmed || comfortTrimmed),
    trim_reason: comfortTrimmed
      ? [result.trim_reason, '为保护当前消息、最近上下文与核心自定义，已按本轮 context budget 裁去部分跨窗口材料'].filter(Boolean).join('；')
      : result.trim_reason,
  };
}

function mergeModelReads(previous, next) {
  if (!previous) return next;
  return {
    ...next,
    items: [...(previous.items || []), ...(next.items || [])],
    total_requested_turns: Number(previous.total_requested_turns || 0) + Number(next.total_requested_turns || 0),
    total_delivered_turns: Number(previous.total_delivered_turns || 0) + Number(next.total_delivered_turns || 0),
    total_delivered_chars: Number(previous.total_delivered_chars || 0) + Number(next.total_delivered_chars || 0),
    trimmed: Boolean(previous.trimmed || next.trimmed),
    trim_reason: [previous.trim_reason, next.trim_reason].filter(Boolean).join('；'),
  };
}

export async function assembleCleanContext(env, {
  surface, conversationId, roomId, visitorId, sourceTurnId = null, messages = [], lastUser, settings = {}, localDate = new Date().toISOString().slice(0, 10),
  recentEntryIds = [], authScope = null, model = '', permission: requestedPermission, preview = false, baseSystemPrompt = '', exposeTools = true, initialFurniture = [], crossWindow = null,
} = {}) {
  const permission = requestedPermission || (surface === 'mailbox_visitor' ? 'visitor' : 'owner');
  const access = roomAccess(surface, { permission, visitorId }); const request = requestSettings(settings);
  const recentTurns = effectiveRecentTurns(request, access);
  const ownerLongContext = permission === 'owner' && OWNER_CUSTOM_INSTRUCTION_SURFACES.has(surface);
  const [ownerCustomInstructions, globalExcerpt] = await Promise.all([
    ownerLongContext ? readCustomInstructions(env.COAST_CHAT_DB) : Promise.resolve(null),
    ownerLongContext ? readGlobalExcerpt(env.COAST_CHAT_DB) : Promise.resolve(null),
  ]);
  const customInstructionsText = String(ownerCustomInstructions?.content ?? ''); const hasCustomInstructions = Boolean(customInstructionsText.trim());
  const globalExcerptText = String(globalExcerpt?.body ?? '');
  let recent = cleanHistory(messages, recentTurns);
  const query = String(lastUser?.content ?? lastUser ?? [...recent].reverse().find((message) => message.role === 'user')?.content ?? '').trim(); recent = ensureCurrentUser(recent, query);
  const papers = await roomPapers(env, access, { surface, conversationId, visitorId, query, recent, recentEntryIds, request, preview }); recent = ensureCurrentUser(papers.recent, query);
  const crossWindowRequest = permission === 'owner' && CROSS_WINDOW_SURFACES.has(surface)
    ? normalizeCrossWindowRequest(crossWindow || {})
    : { mode: 'off', sources: [] };
  const selection = exposeTools ? resolveToolSelection({ permission, surface, authScope, visitorId, cross_window_mode: crossWindowRequest.mode, global_excerpt_write_enabled: globalExcerpt?.write_enabled === true }) : { backendTools: [], modelVisibleToolRecords: [], modelVisibleTools: [] };
  const webSearchEnabled = Boolean(exposeTools && permission === 'owner' && WEB_SEARCH_SURFACES.has(surface)
    && crossWindowRequest.mode !== 'keyword');
  const modelVisibleToolRecords = webSearchEnabled
    ? [...selection.modelVisibleToolRecords, WEB_SEARCH_TOOL_RECORD]
    : selection.modelVisibleToolRecords;
  const backendTools = webSearchEnabled
    ? [...selection.backendTools, WEB_SEARCH_TOOL_RECORD]
    : selection.backendTools;
  const modelVisibleTools = webSearchEnabled
    ? [...selection.modelVisibleTools, WEB_SEARCH_SERVER_TOOL]
    : selection.modelVisibleTools;
  const [worldbook, directDogtalk, manualCrossWindow] = await Promise.all([
    request.worldbookEnabled && request.worldbookLimit ? matchWorldbook(env.COAST_CHAT_DB, { input: query, messages: recent.slice(0, -1), surface, allowedScopes: access.worldbook, limit: request.worldbookLimit }) : Promise.resolve([]),
    OWNER_CUSTOM_INSTRUCTION_SURFACES.has(surface) ? dogtalkContext(env.COAST_CHAT_DB, { room_scope: 'conversation', conversation_id: conversationId }, query, { consume_direct: !preview }) : Promise.resolve(null),
    crossWindowRequest.mode === 'manual'
      ? readCrossWindow(env.COAST_CHAT_DB, { ...crossWindowRequest, current_conversation_id: conversationId })
      : Promise.resolve(null),
  ]);
  const soilText = formatThinkingSoil(papers.soil, { maxCharacters: request.soilCharacters, maxHandSeeds: 7 });
  const memoryRecords = papers.memory?.visitor_memories ? [] : (Array.isArray(papers.memory?.items) ? papers.memory.items.slice(0, request.memoryLimit) : []);
  const memoryItems = papers.memory?.visitor_memories ? notebookItems(papers.memory.visitor_memories) : recallMemoryItems({ items: memoryRecords });
  const dogtalk = papers.dogtalk || directDogtalk; const worldbookItems = worldbook.map((entry) => `${entry.title}：${entry.content}`); const workbenchText = workbenchPrompt(query, modelVisibleTools.length);
  const comfort = trimContextToComfortRange({
    basePrompt: surface === 'mailbox_visitor' ? String(baseSystemPrompt || '').trim() || VISITOR_PROMPT : OWNER_CUSTOM_INSTRUCTION_SURFACES.has(surface) ? OWNER_TECHNICAL_PROMPT : String(baseSystemPrompt || '').trim() || OWNER_TECHNICAL_PROMPT,
    customInstructionsText: hasCustomInstructions ? customInstructionsText : '', globalExcerptText, soilText, memoryItems, worldbookItems, dogtalkText: dogtalk?.context || '',
    crossWindowItems: manualCrossWindowItems(manualCrossWindow), workbenchText, messages: recent,
    recentTurns, maxTokens: request.comfortTokens,
  });
  const deliveredMessages = comfort.keptMessages || comfort.modelMessages.filter((message) => message.role !== 'system');
  const currentDelivered = deliveredMessages.at(-1)?.role === 'user'; const deliveredRecent = currentDelivered ? deliveredMessages.slice(0, -1) : deliveredMessages;
  const deliveredMemoryRecords = memoryRecords.slice(0, comfort.kept.memory); const soilDesk = soilDeskSnapshot(comfort.keptSoilText, papers.soil);
  const usedFurniture = [...new Set((Array.isArray(initialFurniture) ? initialFurniture : []).map((item) => String(item || '').trim()).filter(Boolean))]; const toolResults = []; const furnitureRuns = [];
  const toolGroups = { core: modelVisibleToolRecords.filter((tool) => tool.model_group === 'core'), side: modelVisibleToolRecords.filter((tool) => tool.model_group === 'side') };
  const onToolUsed = (name) => { const clean = String(name || '').trim(); if (clean && !usedFurniture.includes(clean)) usedFurniture.push(clean); };
  const onToolRun = (summary) => { const safe = sanitizeFurnitureRuns([summary])[0]; if (safe && !furnitureRuns.some((run) => run.id === safe.id)) furnitureRuns.push(safe); };
  let modelCrossWindowReads = null;
  let modelCrossWindowError = '';
  const onCrossWindowRead = (result) => { modelCrossWindowReads = mergeModelReads(modelCrossWindowReads, result); };
  const manualDelivered = resultWithinComfort(manualCrossWindow, comfort.keptCrossWindowIds);
  const currentCrossWindowDesk = () => {
    if (crossWindowRequest.mode === 'manual') return crossWindowDeskSection(manualDelivered, { mode: 'manual', ownerVisible: permission === 'owner' });
    if (['model_decides', 'keyword'].includes(crossWindowRequest.mode)) return crossWindowDeskSection(modelCrossWindowReads, { mode: crossWindowRequest.mode, ownerVisible: permission === 'owner', modelRead: Boolean(modelCrossWindowReads), error: modelCrossWindowError });
    return crossWindowDeskSection(null, { mode: 'off', ownerVisible: permission === 'owner' });
  };
  const deskSlip = () => createDeskSlip({
    ownerVisible: permission === 'owner', currentMessage: currentDelivered ? deliveredMessages.at(-1).content : query, recentMessages: deliveredRecent,
    customInstructions: comfort.keptCustomInstructionsText, customInstructionsDelivered: comfort.kept.custom_instructions,
    globalExcerpt: comfort.keptGlobalExcerptText, globalExcerptStatus: comfort.globalExcerptStatus, globalExcerptTokens: comfort.globalExcerptTokens,
    estimatedTokens: comfort.estimatedTokens, comfortCeiling: comfort.comfortCeiling, exceedsComfortCeiling: comfort.exceedsComfortCeiling,
    soil: comfort.kept.soil, soilContext: soilDesk.context,
    soilCurrentText: soilDesk.current_text, soilHandSeeds: soilDesk.hand_seeds, soilPocketCandidatesCount: soilDesk.pocket_candidates_count, memoryItems: deliveredMemoryRecords,
    memoryDeliveredTexts: comfort.keptMemoryItems, worldbookItems: worldbook, worldbookDeliveredCount: comfort.kept.worldbook, worldbookDeliveredTexts: comfort.keptWorldbookItems,
    dogtalk: comfort.kept.dogtalk, dogtalkContext: comfort.keptDogtalkText, crossWindow: currentCrossWindowDesk(), workbenchPrompt: comfort.kept.workbench, workbenchPromptText: comfort.keptWorkbenchText,
    modelVisibleTools: modelVisibleToolRecords, backendTools, toolGroups, furniture: usedFurniture, toolResults, trimmedCount: comfort.trimmedCount,
  });
  const executeTool = async (toolCall) => {
    const name = String(toolCall?.function?.name || '').trim();
    try {
      const result = await executeModelTool(env.COAST_CHAT_DB, toolCall, {
        env, permission, surface, visitorId, room_scope: roomId || surface, authScope, actor: surface === 'official_mcp' ? 'official_mcp' : 'api_myri',
        conversation_id: conversationId, source_turn_id: sourceTurnId, local_date: localDate, model_label: model, user_query: query,
        cross_window_mode: crossWindowRequest.mode,
        global_excerpt_write_enabled: globalExcerpt?.write_enabled === true,
        cross_window_used_turns: () => modelCrossWindowReads?.total_delivered_turns || 0,
        cross_window_used_chars: () => modelCrossWindowReads?.total_delivered_chars || 0,
        on_cross_window_read: onCrossWindowRead,
        on_tool_used: onToolUsed, on_tool_run: onToolRun,
      });
      const normalized = result && typeof result === 'object' ? result : { ok: true, result: result ?? null }; toolResults.push({ name, delivered: true, content: JSON.stringify(normalized).slice(0, 12000) }); return result;
    } catch (error) {
      if (['cross_window_read_recent', 'cross_window_search', 'cross_window_keyword_search', 'cross_window_read_messages'].includes(name)) {
        modelCrossWindowError = String(error?.message || '跨窗口读取失败。').slice(0, 300);
      }
      const normalized = { ok: false, error: { type: String(error?.type || 'tool_execution_failed').slice(0, 120), message: String(error?.message || '工具执行失败。').slice(0, 500) } };
      toolResults.push({ name, delivered: true, content: JSON.stringify(normalized).slice(0, 12000) }); throw error;
    }
  };
  return { modelMessages: comfort.modelMessages, tools: modelVisibleTools, executeTool, deskSlip, furnitureRuns: () => sanitizeFurnitureRuns(furnitureRuns), selected_memory_ids: papers.memory?.selected_ids || [], vector_enabled: Boolean(papers.memory?.vector_enabled), paper_slips: comfort.modelMessages[0]?.role === 'system' ? comfort.modelMessages[0].content : '' };
}
