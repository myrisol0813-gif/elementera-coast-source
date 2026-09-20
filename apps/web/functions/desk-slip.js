function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}
function cleanMessages(values) {
  return (Array.isArray(values) ? values : []).filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string').map((message) => ({ role: message.role, content: message.content }));
}
function memoryItem(value = {}, deliveredText = '') {
  return { id: String(value.id || ''), title: String(value.title || ''), entry_type: value.entry_type === 'seed' ? 'seed' : 'memory', tag: String(value.tag || ''), source_model: String(value.source_model || ''), source_window: String(value.source_window || ''), source_time: String(value.source_time || ''), source_date: String(value.source_date || ''), score: Math.round((Number(value.score) || 0) * 10000) / 10000, reason: String(value.reason || ''), life_core: String(value.life_core || ''), usage_hint: String(value.usage_hint || ''), avoid_hint: String(value.avoid_hint || ''), content: String(value.content || ''), delivered_text: String(deliveredText || '') };
}
function worldbookItem(value = {}, delivered = false, deliveredText = '') {
  return { id: String(value.id || ''), title: String(value.title || ''), content: String(value.content || ''), scope: String(value.scope || ''), matched_by: String(value.matched_source || ''), matched_keywords: uniqueStrings(value.matched_keywords), delivered: Boolean(delivered), delivered_text: delivered ? String(deliveredText || '') : '' };
}
function toolResultItem(value = {}) { return { name: String(value.name || ''), delivered: value.delivered !== false, content: String(value.content || '').slice(0, 320) }; }
function toolItem(value = {}, fallbackGroup = null) {
  if (typeof value === 'string') return { name: value, display_name: value, tool_key: '', group: fallbackGroup };
  return { name: String(value.model_name || value.name || ''), display_name: String(value.display_name || value.model_name || value.name || ''), tool_key: String(value.tool_key || ''), group: value.model_group || value.group || fallbackGroup || null };
}
function uniqueTools(values, fallbackGroup = null) {
  const seen = new Set(); const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const item = toolItem(value, fallbackGroup); const key = item.tool_key || item.name;
    if (!key || seen.has(key)) continue; seen.add(key); result.push(item);
  }
  return result;
}

const DESCRIPTIONS = Object.freeze({
  current_message: '这是屋主本轮刚刚递来的话。它离此刻最近，带着最新的语气、问题、情绪和方向。',
  recent_context: '这是我们最近几轮刚刚走过的文字，用来续上这一刻的节奏、称呼、话题和语气。',
  custom_instructions: '这是屋主留下的核心锚点，用来稳定语言指纹、关系位置与回应方式。',
  global_excerpt: '这是已经确认的全局摘录正文；它紧跟核心自定义整篇注入，不按关键词拆散召回。',
  thinking_soil: '这是当前窗口的承上启下小纸条；待确认候选仍只是候选，不等于已确认记忆。',
  related_memory: '这是被当前对话唤起的已确认旧记忆、旧事件与旧承诺。',
  worldbook: '这是被当前主题触发的设定资料，用于补足世界观、角色、项目或专有名词背景。',
  humanThought: '这是属于屋主的心绪草稿；只有本轮开启并实际递入时才成为理解线索。',
  cross_window: '这是本轮从其他对话窗口取来的近期聊天记录，用来帮你回想自己在别处说过的话；要不要提起，由你按当前对话决定。',
  workbench: '这是代码、文件、接口、真机、GitHub 等技术领域的话题与事实结果。',
  external_tide: '这是从当前应用外部临时读入、且尚未归档成当前应用内部对话的材料；本轮没有接入外部入口消息。',
});

function safeCrossWindow(value, ownerVisible) {
  const section = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const requestedTurns = Math.max(0, Number(section.requested_turns ?? section.total_requested_turns) || 0);
  const loadedTurns = Math.max(0, Number(section.loaded_turns ?? section.total_loaded_turns ?? section.total_delivered_turns) || 0);
  const deliveredTurns = Math.max(0, Number(section.delivered_to_model_turns ?? section.total_delivered_turns) || 0);
  const loadedChars = Math.max(0, Number(section.loaded_chars ?? section.total_loaded_chars) || 0);
  const deliveredChars = Math.max(0, Number(section.delivered_to_model_chars ?? section.total_delivered_chars) || 0);
  return {
    label: '跨窗口取信',
    description: DESCRIPTIONS.cross_window,
    status: String(section.status || '未递给'),
    mode: String(section.mode || 'off'),
    delivered: section.delivered === true,
    requested_windows: Math.max(0, Number(section.requested_windows ?? section.window_count) || 0),
    loaded_windows: Math.max(0, Number(section.loaded_windows ?? section.window_count) || 0),
    window_count: Math.max(0, Number(section.window_count) || 0),
    requested_turns: requestedTurns,
    loaded_turns: loadedTurns,
    delivered_to_model_turns: deliveredTurns,
    requested_messages: Math.max(0, Number(section.requested_messages) || 0),
    loaded_messages: Math.max(0, Number(section.loaded_messages) || 0),
    delivered_to_model_messages: Math.max(0, Number(section.delivered_to_model_messages) || 0),
    attempted_delivered_turns: Math.max(0, Number(section.attempted_delivered_turns) || 0),
    loaded_chars: loadedChars,
    delivered_to_model_chars: deliveredChars,
    attempted_chars: Math.max(0, Number(section.attempted_chars) || 0),
    attempted_estimated_tokens: Math.max(0, Number(section.attempted_estimated_tokens) || 0),
    total_requested_turns: requestedTurns,
    total_loaded_turns: loadedTurns,
    total_delivered_turns: deliveredTurns,
    trimmed: section.trimmed === true,
    trim_reason: String(section.trim_reason || '').slice(0, 300),
    failure_reason: section.failure_reason == null ? null : String(section.failure_reason).slice(0, 160),
    provider_error_type: String(section.provider_error_type || '').slice(0, 160),
    provider_error_message: String(section.provider_error_message || '').slice(0, 500),
    sources: Array.isArray(section.sources) ? section.sources.map((source) => {
      const sourceLoaded = Math.max(0, Number(source?.loaded_turns ?? source?.delivered_turns) || 0);
      const sourceDelivered = Math.max(0, Number(source?.delivered_to_model_turns ?? source?.delivered_turns) || 0);
      return {
        conversation_id: String(source?.conversation_id || '').slice(0, 180),
        title: String(source?.title || '').slice(0, 120),
        room_type: String(source?.room_type || '').slice(0, 40),
        source: String(source?.source || '').slice(0, 40),
        source_window_id: source?.source_window_id ? String(source.source_window_id).slice(0, 180) : null,
        updated_at: String(source?.updated_at || '').slice(0, 80),
        requested_turns: Math.max(0, Number(source?.requested_turns) || 0),
        loaded_turns: sourceLoaded,
        delivered_to_model_turns: sourceDelivered,
        delivered_turns: sourceDelivered,
        requested_messages: Math.max(0, Number(source?.requested_messages) || 0),
        loaded_messages: Math.max(0, Number(source?.loaded_messages) || 0),
        delivered_to_model_messages: Math.max(0, Number(source?.delivered_to_model_messages) || 0),
      };
    }) : [],
    messages: ownerVisible && Array.isArray(section.messages) ? section.messages.map((group) => ({
      conversation_id: String(group?.conversation_id || '').slice(0, 180),
      messages: (Array.isArray(group?.messages) ? group.messages : []).map((message) => ({
        message_id: String(message?.message_id || '').slice(0, 240),
        turn_id: String(message?.turn_id || '').slice(0, 240),
        role: message?.role === 'assistant' ? 'assistant' : 'user',
        created_at: String(message?.created_at || '').slice(0, 80),
        content: String(message?.content || ''),
      })),
    })) : [],
    ...(section.error ? { error: String(section.error).slice(0, 500) } : {}),
  };
}

export function createDeskSlip({
  ownerVisible = true, currentMessage = '', recentMessages = [], customInstructions = '', customInstructionsDelivered = false,
  globalExcerpt = '', globalExcerptStatus = 'empty', globalExcerptTokens = 0,
  soil = false, soilContext = '', soilCurrentText = '', soilHandSeeds = [], soilPocketCandidatesCount = 0,
  memoryItems = [], memoryDeliveredTexts = [], worldbookItems = [], worldbookDeliveredCount = 0, worldbookDeliveredTexts = [],
  humanThought = false, humanThoughtContext = '', crossWindow = null, workbenchPrompt = false, workbenchPromptText = '', modelVisibleTools = [], backendTools = [],
  toolGroups = {}, toolsUsed = [], toolResults = [], trimmedCount = 0,
  estimatedTokens = 0, comfortCeiling = 0, exceedsComfortCeiling = false,
} = {}) {
  const privateDetails = Boolean(ownerVisible);
  const selectedModelTools = uniqueTools(modelVisibleTools); const availableBackendTools = uniqueTools(backendTools);
  const coreTools = uniqueTools(toolGroups?.core, 'core'); const sideTools = uniqueTools(toolGroups?.side, 'side'); const usedTools = uniqueStrings(toolsUsed);
  const recent = cleanMessages(recentMessages); const memoryTexts = Array.isArray(memoryDeliveredTexts) ? memoryDeliveredTexts : [];
  const memories = (Array.isArray(memoryItems) ? memoryItems : []).map((item, index) => memoryItem(item, memoryTexts[index]));
  const worldbookTexts = Array.isArray(worldbookDeliveredTexts) ? worldbookDeliveredTexts : []; const matchedWorldbook = Array.isArray(worldbookItems) ? worldbookItems : [];
  const deliveredWorldbookCount = Math.min(matchedWorldbook.length, Math.max(0, Number(worldbookDeliveredCount) || 0));
  const words = matchedWorldbook.map((item, index) => worldbookItem(item, index < deliveredWorldbookCount, worldbookTexts[index]));
  const results = (Array.isArray(toolResults) ? toolResults : []).map(toolResultItem); const customText = String(customInstructions ?? ''); const customFilled = Boolean(customText.trim());
  const excerptText = String(globalExcerpt ?? ''); const excerptFilled = Boolean(excerptText.trim());
  const soilText = String(soilContext || ''); const soilCurrent = String(soilCurrentText || ''); const handSeeds = (Array.isArray(soilHandSeeds) ? soilHandSeeds : []).map((item) => String(item || '')).filter(Boolean);
  const soilVisible = Boolean(soilText.trim() || soilCurrent.trim() || handSeeds.length); const humanThoughtText = String(humanThoughtContext || ''); const workbenchText = String(workbenchPromptText || '');
  const cross = safeCrossWindow(crossWindow, privateDetails);
  const comfort = trimmedCount > 0
    ? `已裁去 ${Number(trimmedCount)} 条低相关旧纸条`
    : cross.loaded_turns > 0 && cross.trimmed === false
      ? '跨窗口按请求保留，未静默裁剪'
      : '已保持在舒服区间';
  const deliveredToolResults = results.filter((item) => item.delivered && item.content);
  const workbenchStatus = usedTools.length || deliveredToolResults.length ? '已动用' : workbenchPrompt ? '已递给' : '未递给';
  return {
    summary: '本轮递给模型', comfort,
    current_message: { label: '当前消息', description: DESCRIPTIONS.current_message, status: '已递给', delivered: true, content: privateDetails ? String(currentMessage ?? '') : '' },
    recent_context: { label: '最近上下文', description: DESCRIPTIONS.recent_context, status: recent.length ? '已递给' : '未递给', status_detail: `${recent.filter((message) => message.role === 'user').length} 轮`, turns: recent.filter((message) => message.role === 'user').length, current_message_separate: true, messages: privateDetails ? recent : [] },
    custom_instructions: { label: '核心自定义', description: DESCRIPTIONS.custom_instructions, status: customInstructionsDelivered && customFilled ? '已递给' : '未递给', delivered: Boolean(customInstructionsDelivered && customFilled), empty: !customFilled, length: customFilled ? customText.length : 0, content: privateDetails && customInstructionsDelivered && customFilled ? customText : '' },
    global_excerpt: {
      label: '全局摘录', description: DESCRIPTIONS.global_excerpt,
      status: !excerptFilled ? '未设置' : globalExcerptStatus === 'over_budget' ? '超出预算但未静默截断' : globalExcerptStatus === 'truncated' ? '被截断' : '完整注入',
      delivered: excerptFilled, injection: globalExcerptStatus, estimated_tokens: Math.max(0, Number(globalExcerptTokens) || 0),
      length: excerptText.length, content: privateDetails && excerptFilled ? excerptText : '',
    },
    thinking_soil: { label: '整理当前对话的纸条', description: DESCRIPTIONS.thinking_soil, status: soil ? '已递给' : '未递给', delivered: Boolean(soil), empty: !soilVisible, context: privateDetails && soil ? soilText : '', current_text: privateDetails && soil ? soilCurrent : '', hand_seeds: privateDetails && soil ? handSeeds : [], hand_seeds_count: handSeeds.length, pocket_candidates_count: Math.max(0, Number(soilPocketCandidatesCount) || 0), pocket_candidates_status: Number(soilPocketCandidatesCount) > 0 ? '待确认' : '未递入', pocket_candidates_delivered: false },
    related_memory: { label: '相关记忆', description: DESCRIPTIONS.related_memory, status: memories.length ? '已递给' : '未命中', confirmation_status: memories.length ? '已确认' : '', count: memories.length, items: privateDetails ? memories : [] },
    worldbook: { label: '世界书', description: DESCRIPTIONS.worldbook, status: deliveredWorldbookCount > 0 ? '已递给' : words.length ? '未递给' : '未命中', matched_count: words.length, delivered_count: deliveredWorldbookCount, entries: privateDetails ? words : [], matched_titles: words.map((item) => item.title), delivered_titles: words.filter((item) => item.delivered).map((item) => item.title) },
    humanThought: { label: '人类思考链', description: DESCRIPTIONS.humanThought, status: humanThought ? '已递给' : '未递给', delivered: Boolean(humanThought), context: privateDetails && humanThought ? humanThoughtText : '' },
    cross_window: cross,
    workbench: {
      label: '工具调用记录', description: DESCRIPTIONS.workbench, status: workbenchStatus, prompt_delivered: Boolean(workbenchPrompt), prompt: privateDetails && workbenchPrompt ? workbenchText : '',
      labels: { model_visible_tools: '模型可见工具', backend_tools: '后端可用工具', core: '常用工具', side: '海岸日报小工具' },
      model_visible_tools: privateDetails ? selectedModelTools : [], backend_tools: privateDetails ? availableBackendTools : [], core_tools: privateDetails ? coreTools : [], side_tools: privateDetails ? sideTools : [],
      used_count: usedTools.length, tools_used: privateDetails ? usedTools : [], tool_results: privateDetails ? deliveredToolResults : [],
    },
    external_tide: { label: '外部入口消息', description: DESCRIPTIONS.external_tide, status: '未递给', delivered: false, empty: true, content: privateDetails ? '本轮没有递入外部材料。' : '' },
    context_budget: {
      label: '上下文预算',
      estimated_tokens: Math.max(0, Number(estimatedTokens) || 0),
      comfort_ceiling: Math.max(0, Number(comfortCeiling) || 0),
      trimmed: Number(trimmedCount) > 0,
      trimmed_count: Math.max(0, Number(trimmedCount) || 0),
      exceeds_comfort_ceiling: Boolean(exceedsComfortCeiling),
      sources_preserved: [
        '当前消息',
        ...(recent.length ? ['最近上下文'] : []),
        ...(customInstructionsDelivered && customFilled ? ['自定义指令'] : []),
        ...(excerptFilled ? ['全局摘录'] : []),
        ...(soil ? ['整理当前对话的纸条'] : []),
        ...(memories.length ? ['记忆'] : []),
        ...(deliveredWorldbookCount ? ['世界书'] : []),
        ...(humanThought ? ['人类思考链'] : []),
        ...(cross.delivered ? ['跨窗口'] : []),
        ...(workbenchStatus !== '未递给' ? ['工具调用记录'] : []),
      ],
      global_excerpt: globalExcerptStatus,
    },
  };
}
