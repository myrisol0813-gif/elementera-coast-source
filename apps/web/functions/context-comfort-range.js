export function estimateContextTokens(value) {
  let wide = 0;
  let narrow = 0;
  for (const character of String(value || '')) {
    if (/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u.test(character)) wide += 1;
    else narrow += 1;
  }
  return wide + Math.ceil(narrow / 4);
}

export const SOURCE_GUIDES = Object.freeze({
  current: ['【当前消息】', '这是屋主本轮刚刚递来的消息。', '它离此刻最近，带着最新的语气、问题、情绪和方向。'].join('\n'),
  recent: ['【最近上下文】', '这是我们最近几轮刚刚走过的文字。', '它用来续上对话的节奏、称呼、话题和语气，让此刻的你知道这一刻是从哪里流过来的。'].join('\n'),
  global_excerpt: ['【全局摘录】', '这是屋主已经确认的长期全局摘录正文。', '它应整篇进入上下文，位置紧随核心自定义；不要把它当普通记忆按关键词拆散召回。'].join('\n'),
  custom: ['【核心自定义】', '这是屋主为当前 Model Partner 保存的核心自定义内容。', '它用于稳定当前对话中的语言偏好、角色设定与回应方式。'].join('\n'),
  soil: ['【整理当前对话的纸条】', '这是当前对话的简短整理纸条。', '它收拢当前对话里仍在进行的主题与必要背景；', '其中的候选内容需要屋主确认后，才会进入线索库或记忆库。', '它只是上下文的一部分，用于减少跨轮次遗失。'].join('\n'),
  memory: ['【相关记忆】', '这是被当前对话唤起的旧记忆、旧事件与旧承诺。', '它们用于提醒、照亮和帮助辨认当下，让过去曾经留下的旧贝壳重新被听见。'].join('\n'),
  worldbook: ['【世界书】', '这是被当前主题触发的设定资料。', '它用于补足世界观、角色、项目或专有名词的背景，帮助 Model Partner 理解专有词汇。'].join('\n'),
  humanThought: ['【人类思考链】', '这是屋主为本轮对话填写的人类思考链。', '只有屋主明确选择本轮递送时，它才进入模型上下文。'].join('\n'),
  cross_window: ['【跨窗口取信】', '这是本轮从其他对话窗口取来的近期聊天记录，用来帮你回想自己在别处说过的话；要不要提起，由你按当前对话决定。'].join('\n'),
  workbench: ['【工具调用记录】', '这是代码、文件、接口、真机、GitHub 等技术领域的话题与事实结果。', '它用于提供本轮工具调用的客观状态与结果。'].join('\n'),
  external: ['【外部入口消息】', '这是从外部入口临时读入、尚未归档为当前应用内部对话的材料。', '本轮如果没有外部材料，则显示“本轮没有递入外部材料”。'].join('\n'),
});

function messageTokens(message) {
  return estimateContextTokens(message?.content) + 4;
}

function cleanMessages(messages, recentTurns) {
  const cleaned = (Array.isArray(messages) ? messages : [])
    .filter((message) => ['user', 'assistant'].includes(message?.role)
      && typeof message.content === 'string'
      && message.content.trim())
    .map((message) => ({ role: message.role, content: message.content }));
  const current = cleaned.at(-1)?.role === 'user' ? cleaned.pop() : null;
  const turns = Math.max(1, Math.trunc(Number(recentTurns) || 8));
  const recent = cleaned.slice(-(turns * 2));
  return current ? [...recent, current] : recent;
}

function sourceBody(value) {
  return String(value ?? '').trim().replace(/^【[^】]+】\s*(?:\n|$)/u, '').trim();
}

function sourceBlock(guide, value) {
  const text = sourceBody(value);
  return text ? `${guide}\n${text}` : '';
}

function itemBlock(guide, items) {
  const lines = (Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean);
  return lines.length ? `${guide}\n${lines.join('\n')}` : '';
}

function crossWindowBlock(items) {
  const blocks = (Array.isArray(items) ? items : [])
    .map((item) => String(item?.text || '').trim())
    .filter(Boolean);
  return blocks.length ? `${SOURCE_GUIDES.cross_window}\n${blocks.join('\n\n')}` : '';
}

function hasCurrentMessage(messages) {
  return messages.at(-1)?.role === 'user';
}

function recentCount(messages) {
  return Math.max(0, messages.length - (hasCurrentMessage(messages) ? 1 : 0));
}

function visibleMessages(messages) {
  return messages.map((message) => ({ ...message }));
}

function assembleText(value, messages) {
  const recent = recentCount(messages);
  return [
    value.basePrompt,
    sourceBlock(SOURCE_GUIDES.custom, value.customInstructionsText),
    sourceBlock(SOURCE_GUIDES.global_excerpt, value.globalExcerptText),
    sourceBlock(SOURCE_GUIDES.humanThought, value.humanThoughtText),
    crossWindowBlock(value.crossWindowItems),
    sourceBlock(SOURCE_GUIDES.soil, value.soilText),
    itemBlock(SOURCE_GUIDES.memory, value.memoryItems.map((item) => `- ${item}`)),
    itemBlock(SOURCE_GUIDES.worldbook, value.worldbookItems.map((item) => `- ${item}`)),
    sourceBlock(SOURCE_GUIDES.workbench, value.workbenchText),
    `${SOURCE_GUIDES.external}\n本轮没有递入外部材料。`,
    recent ? `${SOURCE_GUIDES.recent}\n以下 ${recent} 条消息属于最近上下文。` : '',
    hasCurrentMessage(messages) ? SOURCE_GUIDES.current : '',
  ].filter(Boolean).join('\n\n');
}

export function trimContextToComfortRange({
  basePrompt = '',
  customInstructionsText = '',
  globalExcerptText = '',
  soilText = '',
  memoryItems = [],
  worldbookItems = [],
  humanThoughtText = '',
  crossWindowItems = [],
  workbenchText = '',
  messages = [],
  recentTurns = 8,
  maxTokens = 6000,
} = {}) {
  const rawCustomInstructions = String(customInstructionsText ?? '');
  const value = {
    basePrompt: String(basePrompt || '').trim(),
    customInstructionsText: rawCustomInstructions.trim() ? rawCustomInstructions : '',
    globalExcerptText: String(globalExcerptText ?? '').trim(),
    soilText: String(soilText || '').trim(),
    memoryItems: [...memoryItems].filter(Boolean),
    worldbookItems: [...worldbookItems].filter(Boolean),
    humanThoughtText: String(humanThoughtText || '').trim(),
    crossWindowItems: (Array.isArray(crossWindowItems) ? crossWindowItems : [])
      .map((item) => ({ id: String(item?.id || ''), text: String(item?.text || '').trim() }))
      .filter((item) => item.id && item.text),
    workbenchText: String(workbenchText || '').trim(),
  };
  const keptMessages = cleanMessages(messages, recentTurns);
  const ceiling = Math.max(1800, Math.trunc(Number(maxTokens) || 6000));
  let trimmedCount = 0;
  const total = () => estimateContextTokens(assembleText(value, keptMessages))
    + visibleMessages(keptMessages).reduce((sum, message) => sum + messageTokens(message), 0);

  if (total() > ceiling && value.workbenchText) { value.workbenchText = ''; trimmedCount += 1; }
  while (total() > ceiling && value.worldbookItems.length > 2) { value.worldbookItems.pop(); trimmedCount += 1; }
  while (total() > ceiling && value.memoryItems.length > 3) { value.memoryItems.pop(); trimmedCount += 1; }
  while (total() > ceiling && value.worldbookItems.length) { value.worldbookItems.pop(); trimmedCount += 1; }
  while (total() > ceiling && value.memoryItems.length) { value.memoryItems.pop(); trimmedCount += 1; }
  if (total() > ceiling && value.soilText.length > 700) {
    value.soilText = value.soilText.slice(0, 700);
    trimmedCount += 1;
  }
  if (total() > ceiling && value.soilText) { value.soilText = ''; trimmedCount += 1; }
  if (total() > ceiling && value.humanThoughtText) { value.humanThoughtText = ''; trimmedCount += 1; }
  while (total() > ceiling && keptMessages.length > 4) {
    keptMessages.shift();
    trimmedCount += 1;
  }

  const systemText = assembleText(value, keptMessages);
  const modelMessages = visibleMessages(keptMessages);
  const currentUser = keptMessages.at(-1)?.role === 'user' ? keptMessages.at(-1) : null;
  const estimatedTokens = total();
  return {
    modelMessages: [
      ...(systemText ? [{ role: 'system', content: systemText }] : []),
      ...modelMessages,
    ],
    kept: {
      custom_instructions: Boolean(value.customInstructionsText),
      global_excerpt: Boolean(value.globalExcerptText),
      soil: Boolean(value.soilText),
      memory: value.memoryItems.length,
      worldbook: value.worldbookItems.length,
      humanThought: Boolean(value.humanThoughtText),
      cross_window: value.crossWindowItems.length,
      workbench: Boolean(value.workbenchText),
    },
    keptMessages: keptMessages.map((message) => ({ ...message })),
    keptCustomInstructionsText: value.customInstructionsText,
    keptGlobalExcerptText: value.globalExcerptText,
    keptSoilText: sourceBody(value.soilText),
    keptMemoryItems: value.memoryItems,
    keptWorldbookItems: value.worldbookItems,
    keptDogtalkText: sourceBody(value.humanThoughtText),
    keptCrossWindowIds: value.crossWindowItems.map((item) => item.id),
    keptCrossWindowItems: value.crossWindowItems.map((item) => ({ ...item })),
    keptWorkbenchText: value.workbenchText,
    trimmedCount,
    estimatedTokens,
    comfortCeiling: ceiling,
    exceedsComfortCeiling: estimatedTokens > ceiling,
    globalExcerptStatus: value.globalExcerptText ? (estimatedTokens > ceiling ? 'over_budget' : 'complete') : 'empty',
    globalExcerptTokens: estimateContextTokens(value.globalExcerptText),
    currentUserPreserved: Boolean(currentUser),
  };
}
