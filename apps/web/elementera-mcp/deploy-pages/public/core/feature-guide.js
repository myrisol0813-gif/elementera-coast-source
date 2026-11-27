import { escapeHtml, escapeAttribute } from './dom.js';

export const FEATURE_GUIDES = Object.freeze({
  "main": [
    "主聊天室",
    "与所选模型日常对话的空间。\n顶部模型名称：选择聊天模型。\n右上角 ···：设置当前窗口的现实上下文、短句模式、真实连续回复、表情包权限、自动整理纸条与新居信。\n输入框左侧加号：添加图片或文件。\n输入区上方的上下文状态条：查看本轮实际递入资料；尚无回执时不会显示。\n侧栏搜索：查找窗口及历史原文。"
  ],
  "radio": [
    "共通聊天室",
    "侧栏 → 共通聊天室：与已连接的 ChatGPT 和 API 模型共享对话。需要先配置 MCP。"
  ],
  "lighthouse": [
    "MCP 对话区",
    "侧栏 → MCP 对话区：与已连接的 ChatGPT 交换消息。需要先配置 MCP。"
  ],
  "window": [
    "这个窗口",
    "主聊天右上角 ···：打开当前窗口设置。现实上下文只递入启用且成功取得的日期、时间和未来七天日历；完整设备信息由 Android 提供。短句模式适用于闲聊，与连续回复独立。连续回复、表情包权限、纸条、自主唤醒与新居信入口也在这里。"
  ],
  "soil": [
    "整理当前对话的纸条",
    "右上角 ··· → 整理当前对话的纸条：查看当前纸条、余思及长期资料候选。开启自动整理后，模型在回复结束后整理，供下一轮承接；关闭后保留旧内容，停止自动整理及递入。"
  ],
  "desk": [
    "本轮上下文预览",
    "输入区上方的上下文状态条：查看本轮实际递入的资料、工具回执及预算。没有回执时，不代表模型已经读过资料。"
  ],
  "letter": [
    "新居信",
    "右上角 ··· → 新居信：填写当前窗口的背景或想继续探索的内容，保存草稿或递出供模型阅读。"
  ],
  "memory": [
    "记忆库",
    "侧栏 → 记忆：管理正式记忆。使用新建入口手动添加，或在待确认区接收候选；通过搜索与分类查找旧记忆。开启召回时按相关性取回，而非整库递入。"
  ],
  "seeds": [
    "种子库",
    "侧栏 → 记忆 → 种子：保存值得继续发展的想法、问题及意象。可以填写适合重新拾起它们的时机；种子不代表已发生的事实。"
  ],
  "pending": [
    "待确认区",
    "记忆页面 → 待确认区：查看模型提出的长期资料建议，确认、编辑后确认或驳回。未确认内容不作为正式记忆召回。"
  ],
  "userPortrait": [
    "用户画像",
    "记忆页面 → 用户画像：查看模型对用户的长期认识及修改建议。正式正文参与上下文；候选确认后生效。"
  ],
  "selfPortrait": [
    "自我画像",
    "记忆页面 → 自我画像：查看模型对自身的长期认识及修改建议。正式正文参与上下文；候选确认后生效。"
  ],
  "instructions": [
    "自定义指令",
    "记忆页面：填写希望模型长期参考的背景、表达偏好与约定。不必放入所有历史对话。"
  ],
  "worldbook": [
    "世界书 / 词典",
    "词典页面右上角「词条」：新建人物、地点、专有名词或设定；设置关键词、适用范围和常驻状态。在测试框试一句，检查是否命中。"
  ],
  "daily": [
    "小组件",
    "侧栏 → 小组件：打开碳硅圈、日记或日历。"
  ],
  "moments": [
    "碳硅圈",
    "小组件 → 碳硅圈：碳基人类与硅基模型的日常分享空间。发表动态、图片、评论与点赞；支持工具且获得授权的模型也可以参与。"
  ],
  "diary": [
    "日记",
    "小组件 → 日记：按日期记录经历、感受与想法，填写天气、心情与标签；支持且获授权的模型可以留下自己的日记。"
  ],
  "calendar": [
    "日历与纪念日",
    "日历：添加日程、随记及纪念日，选择起始日期和计算方式。开启侧栏展示后可从侧栏查看与编辑。"
  ],
  "vault": [
    "文件库",
    "小组件 → 文件库 → 基本文件库：分类查看已保存的图片、语音与附件，查找并返回来源。"
  ],
  "library": [
    "书房",
    "书房：导入 EPUB / TXT，点击书籍阅读，保存进度、划线、批注及读后感。暂不支持 PDF。删除书籍会一并删除关联笔记。模型操作需相应工具支持及授权。"
  ],
  "models": [
    "模型箱",
    "屋主设置 → 模型箱：选择当前聊天模型。PWA 使用已部署后端提供的模型；Android 本机另支持套餐通道及自有供应商。费用与额度以供应商为准。"
  ],
  "tools": [
    "模型工作台 / MCP 工具",
    "侧栏 → 模型工作台：查看工具与连接。支持工具调用的模型需要相应授权才能读取或写入；查看实际工具记录确认结果，不能以正文声称已完成为准。Android 本机的逐窗口读取、写入开关不适用于 PWA。"
  ],
  "toolLog": [
    "工具调用记录",
    "在已配置的工具页面查看实际调用及成功、失败回执。未授权、模型不支持工具与执行失败是不同情况。"
  ],
  "devHands": [
    "前端开发手",
    "模型工作台 → 开发手：查看已配置的开发工具与调用记录。实际能力由连接及授权决定。"
  ],
  "settings": [
    "屋主设置",
    "侧栏底部 → 屋主设置：管理个人资料、外观、账户、模型、基本设置、归档与版本。"
  ],
  "profile": [
    "个人资料",
    "屋主设置 → 个人资料：修改昵称及聊天署名，不改变已有记录的实际作者。"
  ],
  "appearance": [
    "外观",
    "屋主设置 → 外观：调整主题、用户气泡、重点色与文字气质。不会改变对话内容。"
  ],
  "basic": [
    "基本设置",
    "屋主设置 → 基本设置：自动预算按模型目录容量分配，未知时采用 18000 的舒服区间；手动可自行填写数值。调整输出、记忆召回、世界书、普通工具调用上限及连续回复默认预算。"
  ],
  "account": [
    "账户",
    "屋主设置 → 账户：查看当前登录状态并主动退出。PWA 使用在线后端；Android 本机与前后端资料独立保存，不自动同步。"
  ],
  "backup": [
    "聊天记录与迁移",
    "屋主设置 → 聊天记录：导出 ZIP 用于恢复，导出 HTML 用于阅读，导入先预览再确认。恢复范围以归档清单为准；密钥及登录凭据需单独配置。卸载 Android 前务必将备份保存到应用外。"
  ],
  "diagnostics": [
    "关于与诊断",
    "屋主设置 → 关于与诊断：查看版本、缓存及当前窗口运行信息，辅助定位异常。"
  ],
  "update": [
    "版本与更新",
    "屋主设置 → 版本与更新：查看 PWA / Native 版本及正式发行信息。Android 更新须校验完整性和签名后覆盖安装。"
  ],
  "rooms": [
    "主聊天室",
    "与所选模型日常对话的空间。\n顶部模型名称：选择聊天模型。\n右上角 ···：设置当前窗口的现实上下文、短句模式、真实连续回复、表情包权限、自动整理纸条与新居信。\n输入框左侧加号：添加图片或文件。\n输入区上方的上下文状态条：查看本轮实际递入资料；尚无回执时不会显示。\n侧栏搜索：查找窗口及历史原文。"
  ],
  "reality": [
    "现实上下文",
    "右上角 ··· → 这个窗口 → 现实上下文：选择日期、时间与未来七天日历。只有已启用且成功取得的资料会递给模型。"
  ],
  "short": [
    "短句模式",
    "右上角 ··· → 这个窗口 → 短句模式：闲聊优先简短回应，深度讨论仍可自然展开。"
  ],
  "sequence": [
    "真实连续回复（实验）",
    "聊天右上角 ··· → 这个窗口 → 真实连续回复（实验）。默认关闭，逐窗口生效。一次发送后，模型自行决定是否追加独立消息，并受单组回复上限（1—20）、累计工具预算（0—128）和累计 token 预算（1—1000000）约束。本窗口留空继承基本设置；保存后生效。停止或达到预算时不再追加，已保存消息保留。开启自动整理时，整组结束后整理一次。网页仅支持普通 API，需要已更新的服务端；设备 GPT 套餐请使用 Android。"
  ],
  "stickers": [
    "表情包",
    "聊天右上角 ··· → 这个窗口：分别开启「允许发送表情包」和「允许添加表情包」。发送使用已经登记且启用的素材，不调用生图 API；添加用于登记模型在当前窗口生成并保存的图片。是否发送由模型决定，工具需获授权。"
  ],
  "history": [
    "历史纸条",
    "聊天消息下方的历史纸条：回看对应轮次的整理内容，可收藏喜欢的部分。没有历史纸条时，先完成一轮整理。"
  ],
  "draft": [
    "私人草稿",
    "输入区的「屋主 · 私人草稿 / 跨窗口」：填写草稿并选择本轮阅读方式。保存草稿不等于授权模型读取。"
  ],
  "cross": [
    "跨窗口回忆",
    "输入区的「屋主 · 私人草稿 / 跨窗口」→ 跨窗口读取：选取旧消息或允许模型自行查找。手动选择仅本轮生效；不自动开启权限。"
  ],
  "echo": [
    "模型回波",
    "输入区上方状态条：打开本轮上下文预览，查看模型、用量及预算。估算与供应商实际返回分开显示。"
  ],
  "collection": [
    "收藏",
    "小组件 → 文件库 → 收藏：查找主动保存的文字、纸条、图片、语音及附件，添加备注或返回来源。取消收藏不删除原件。"
  ],
  "pets": [
    "宠物系统",
    "小组件 → 宠物系统：当前仍在准备，尚无可用的养成操作。"
  ]
});
export const GUIDE_TARGETS = Object.freeze({
  "main": "room:main",
  "radio": "room:radio",
  "lighthouse": "room:lighthouse",
  "window": "chat:window-settings",
  "soil": "chat:window-soil-open",
  "desk": "desk-slip",
  "letter": "chat:window-letter-open",
  "memory": "memory:memory",
  "seeds": "memory:seed",
  "pending": "memory:pending",
  "userPortrait": "memory:user-portrait",
  "selfPortrait": "memory:global-excerpt",
  "instructions": "memory:custom",
  "worldbook": "desk-worldbook",
  "daily": "daily:home",
  "moments": "daily:moments",
  "diary": "daily:diary",
  "calendar": "calendar",
  "vault": "vault-home",
  "library": "library-home",
  "models": "models",
  "tools": "desk",
  "toolLog": "toolroom",
  "devHands": "dev-hands-home",
  "settings": "wolf",
  "profile": "settings-profile",
  "appearance": "settings-appearance",
  "basic": "basic-settings",
  "account": "settings-account",
  "backup": "settings-chat-records",
  "diagnostics": "settings-diagnostics",
  "update": "dev-hands-update",
  "rooms": "room:main",
  "reality": "chat:window-settings",
  "short": "chat:window-settings",
  "sequence": "chat:window-settings",
  "stickers": "chat:window-settings",
  "history": "chat:window-soil-open",
  "draft": "drawer:dogtalk",
  "cross": "drawer:cross",
  "echo": "desk-slip",
  "collection": "vault:treasures",
  "pets": "pets"
});
const GUIDE_GROUPS = [
  [
    "聊天与上下文",
    [
      "main",
      "radio",
      "lighthouse",
      "window",
      "reality",
      "short",
      "sequence",
      "stickers",
      "soil",
      "history",
      "draft",
      "cross",
      "desk",
      "echo",
      "letter"
    ]
  ],
  [
    "记忆与长期资料",
    [
      "memory",
      "seeds",
      "pending",
      "userPortrait",
      "selfPortrait",
      "instructions",
      "worldbook"
    ]
  ],
  [
    "日常与资料",
    [
      "daily",
      "moments",
      "diary",
      "calendar",
      "vault",
      "collection",
      "library",
      "pets"
    ]
  ],
  [
    "模型与工具",
    [
      "models",
      "tools",
      "toolLog",
      "devHands"
    ]
  ],
  [
    "屋主设置与迁移",
    [
      "settings",
      "profile",
      "appearance",
      "basic",
      "account",
      "backup",
      "diagnostics",
      "update"
    ]
  ]
];
const HINT_KEY = 'source-feature-guide-seen-v1';
export function dismissGuideHint() {
  try { localStorage.setItem(HINT_KEY, '1'); } catch {}
  const hint = document.getElementById('firstFeatureHint');
  if (hint) hint.hidden = true;
}
export function showGuideHint() {
  const hint = document.getElementById('firstFeatureHint');
  if (!hint) return;
  try { if (localStorage.getItem(HINT_KEY) === '1') return; } catch {}
  hint.hidden = false;
}
export async function openGuideTarget(key, { router, chat, memory, daily, dogtalk, toast }) {
  if (!Object.hasOwn(GUIDE_TARGETS, key)) return;
  const target = GUIDE_TARGETS[key];
  const arg = { dataset: {} };
  const current = chat.getCurrentConversationId();
  if (target.startsWith('room:')) {
    const type = target.slice(5);
    await router.close();
    if (chat.getCurrentConversation()?.room_type === type) return;
    return chat.openRoomType(type);
  }
  if (target.startsWith('chat:') || target.startsWith('drawer:') || target === 'memory:pending' || target === 'desk-slip') {
    if (!current) return toast('请先进入一个聊天窗口。');
  }
  if (target.startsWith('chat:')) {
    await router.close();
    return chat.handleAction(target.slice(5), arg);
  }
  if (target.startsWith('drawer:')) {
    await router.close();
    const tab = target.slice(7);
    const panel = [...document.querySelectorAll('[data-dogtalk-composer]')].find(node => node.dataset.conversationId === current);
    const button = panel?.querySelector(`[data-action="dogtalk:tab"][data-tab="${tab}"]`);
    if (!button) return toast('当前窗口没有可用的草稿抽屉。');
    return dogtalk.handleAction('tab', button);
  }
  if (target.startsWith('memory:')) {
    const scope = target.slice(7);
    if (['memory','seed','custom'].includes(scope)) return memory.handleAction('open', { dataset: { scope } });
    return memory.handleAction(scope === 'pending' ? 'pockets' : scope, arg);
  }
  if (target.startsWith('daily:')) return daily.handleAction(target.slice(6), arg);
  if (target === 'vault:treasures') return router.open('vault-home', { mode: 'treasures' });
  if (target === 'pets') return router.open('daily-placeholder', { title: '宠物系统' });
  return router.open(target);
}
export function manualMarkup() {
  return GUIDE_GROUPS.map(([group, keys]) => '<section class="feature-group"><h2>' + escapeHtml(group)
    + '</h2><div class="feature-card">' + keys.map(key => {
      const [title, body] = FEATURE_GUIDES[key];
      return '<article class="coast-guide-entry"><strong>' + escapeHtml(title) + '</strong><p>'
        + escapeHtml(body).replace(/\n/g, '<br>') + '</p><button class="coast-guide-link" type="button" data-action="settings:guide-target" data-key="'
        + escapeAttribute(key) + '">前往对应入口 ' + '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' + '</button></article>';
    }).join('') + '</div></section>').join('');
}
const ROUTE_GUIDES = Object.freeze({
  calendar: 'calendar', 'calendar-edit': 'calendar',
  memory: 'memory', 'memory-entry-edit': 'memory', 'memory-pockets': 'pending',
  'memory-vector-status': 'memory', 'user-portrait': 'userPortrait', 'user-portrait-edit': 'userPortrait',
  'global-excerpt': 'selfPortrait', 'global-excerpt-edit': 'selfPortrait',
  'thought-soil': 'soil', 'thought-soil-edit': 'soil', 'thought-soil-treasure': 'soil',
  'desk-slip': 'desk', 'desk-worldbook': 'worldbook', 'desk-worldbook-editor': 'worldbook',
  models: 'models', 'daily-home': 'daily', moments: 'moments', diary: 'diary',
  'moments-compose': 'moments', 'diary-compose': 'diary', 'daily-placeholder': 'daily',
  'vault-home': 'vault', 'library-home': 'library', 'library-book': 'library', 'library-chapter': 'library',
  'library-notes': 'library', 'library-note': 'library',
  settings: 'settings', wolf: 'settings', toolroom: 'toolLog', desk: 'tools',
  'settings-profile': 'profile', 'settings-appearance': 'appearance', 'basic-settings': 'basic',
  'settings-account': 'account', 'settings-chat-records': 'backup', 'settings-diagnostics': 'diagnostics',
  'island-letter': 'letter', 'settings-theme': 'appearance', 'settings-font': 'appearance', 'settings-bubble': 'appearance', 'settings-accent': 'appearance',
  'dev-hands-home': 'devHands', 'dev-hands-logs': 'devHands', 'dev-hands-update': 'update',
});
export function guideMarkup(key) {
  const guide = FEATURE_GUIDES[key];
  if (!guide) return '';
  return '<details class="coast-feature-guide"><summary aria-label="功能说明">?</summary><section class="coast-feature-guide-panel"><strong>'
    + escapeHtml(guide[0]) + '</strong><div>' + escapeHtml(guide[1]).replace(/\n/g, '<br>') + '</div><button type="button" class="coast-guide-link" data-action="settings:help">查看完整手册</button></section></details>';
}
export const routeGuideMarkup = name => guideMarkup(ROUTE_GUIDES[name]);
