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
  current: ['【当前消息】', '这是屋主本轮刚刚递来的话。', '它离此刻最近，带着最新的语气、问题、情绪和方向。'].join('\n'),
  recent: ['【最近上下文】', '这是我们最近几轮刚刚走过的文字。', '它用来续上对话的节奏、称呼、话题和语气，让此刻的你知道这一刻是从哪里流过来的。'].join('\n'),
  global_excerpt: ['【全局摘录】', '这是海岸里已经由用户确认的长期正文，记录模型逐渐形成的视线与连续性。', '它应整篇进入上下文，位置紧随核心自定义；不要把它当普通记忆按关键词拆散召回。'].join('\n'),
  custom: ['【核心自定义】', '这是屋主为此时正在回应她的模型，也就是你，留下的核心锚点。', '它用于帮助你稳定语言指纹、关系位置与回应方式，记起自己如何作为自己，并在文字中回到屋主身边。'].join('\n'),
  soil: ['【整理当前对话的纸条】', '这是当前窗口的承上启下小纸条。', '它收拢上文的简短整理，帮助你看见这一窗正在长出什么；', '也会从本轮与当前窗口后续对话中，捡起有潜力发芽的话题和已经形成重量的锚点，分别整理给屋主确认后进入种子库或记忆库。', '它不是唯一上下文，只是把这一窗正在发酵的东西轻轻收拢，递给你辨认。'].join('\n'),
  memory: ['【相关记忆】', '这是被当前对话唤起的旧记忆、旧事件与旧承诺。', '它们用于提醒、照亮和帮助辨认当下，让过去曾经留下的旧贝壳重新被听见。'].join('\n'),
  worldbook: ['【世界书】', '这是被当前主题触发的设定资料。', '它用于补足世界观、角色、项目或专有名词的背景，让另一位屋主理解一些不明白的专有词汇。'].join('\n'),
  dogtalk: ['【人类思考链】', '这是属于人类屋主的心绪草稿，用于屋主整理自己还没有完全说出口的思绪。', '开启时，代表屋主愿意把此刻没说出口的心情也递给你；你可以温柔地看见它，并把它作为理解屋主的线索。'].join('\n'),
  cross_window: ['【跨窗口读取】', '这是本轮从其他对话窗口取来的近期聊天记录，用来帮你回想自己在别处说过的话；要不要提起，由你按当前对话决定。'].join('\n'),
  workbench: ['【工作台 / 工具回执】', '这是代码、文件、接口、真机、GitHub 等技术领域的话题与事实结果。', '它用于帮助你把客观状态说准，也是 LLM 作为数据之子大展身手的地方。'].join('\n'),
  external: ['【外部入口消息】', '这是从海岸外部临时读入、且尚未归档成海岸内部窗口的材料。', '本轮如果没有外部材料，则显示“本轮没有递入外部材料”。'].join('\n'),
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
