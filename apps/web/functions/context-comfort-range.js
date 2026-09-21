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
  current: ['【当前消息】', '这是用户本轮刚刚提交的消息。', '它是当前任务最直接的输入，应优先用于理解问题、目标和约束。'].join('\n'),
  recent: ['【最近上下文】', '这是当前会话最近几轮消息。', '它用于保持主题、术语和任务连续性，避免重复询问已经给出的信息。'].join('\n'),
  global_excerpt: ['【全局摘录】', '这是应用内由用户确认的长期参考正文。', '它应整篇进入上下文，位置紧随核心自定义；不要把它当普通记忆按关键词拆散召回。'].join('\n'),
  custom: ['【核心自定义】', '这是用户为当前公开 demo assistant 保存的自定义指令。', '它用于补充响应偏好、格式要求、任务约束与允许的工具行为。'].join('\n'),
  soil: ['【整理当前对话的纸条】', '这是当前窗口的滚动摘要与待确认笔记。', '它用于压缩较早内容并保留仍然相关的任务线索；', '候选内容只有在用户确认后才可进入种子库或记忆库。', '它不是唯一上下文，也不应覆盖当前消息与最近上下文。'].join('\n'),
  memory: ['【相关记忆】', '这是与当前任务相关、且已确认可使用的长期记录。', '只在确实有帮助时引用，并以当前消息为最高优先级。'].join('\n'),
  worldbook: ['【世界书】', '这是被当前主题触发的设定资料。', '它用于补足世界观、角色、项目或专有名词的背景，帮助模型正确理解上下文。'].join('\n'),
  dogtalk: ['【用户草稿】', '这是用户可选提供的私有草稿，用于补充当前消息尚未完整表达的背景。', '仅在本轮明确提供时使用，不应自动升级为长期记忆或稳定偏好。'].join('\n'),
  cross_window: ['【跨窗口读取】', '这是本轮从其他对话窗口读取的近期聊天记录。', '仅用于补充当前任务上下文；是否引用其中内容，应由当前消息与任务相关性决定。'].join('\n'),
  workbench: ['【工作台 / 工具回执】', '这是代码、文件、接口、真机、GitHub 等技术领域的话题与事实结果。', '它用于提供可核对的客观状态，并约束回复不要把未完成的动作说成已经完成。'].join('\n'),
  external: ['【外部入口消息】', '这是从应用外部临时读入、且尚未归档成内部对话窗口的材料。', '本轮如果没有外部材料，则显示“本轮没有递入外部材料”。'].join('\n'),
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
    sourceBlock(SOURCE_GUIDES.dogtalk, value.dogtalkText),
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
  dogtalkText = '',
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
    dogtalkText: String(dogtalkText || '').trim(),
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
  if (total() > ceiling && value.dogtalkText) { value.dogtalkText = ''; trimmedCount += 1; }
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
      dogtalk: Boolean(value.dogtalkText),
      cross_window: value.crossWindowItems.length,
      workbench: Boolean(value.workbenchText),
    },
    keptMessages: keptMessages.map((message) => ({ ...message })),
    keptCustomInstructionsText: value.customInstructionsText,
    keptGlobalExcerptText: value.globalExcerptText,
    keptSoilText: sourceBody(value.soilText),
    keptMemoryItems: value.memoryItems,
    keptWorldbookItems: value.worldbookItems,
    keptDogtalkText: sourceBody(value.dogtalkText),
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
