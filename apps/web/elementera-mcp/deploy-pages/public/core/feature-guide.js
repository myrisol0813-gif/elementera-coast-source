import { escapeHtml } from './dom.js';

export const FEATURE_GUIDES = Object.freeze({
  "memory": [
    "记忆库",
    "保存相处中形成的长期记忆。可手动添加，也可确认模型提出的记忆候选，供后续对话使用。\n\n对话 → 记忆候选 → 确认 → 正式记忆"
  ],
  "seeds": [
    "种子库",
    "保存值得继续生长的意象、认知与灵感。添加内容及使用时机，为未来对话提供线索。"
  ],
  "userPortrait": [
    "用户画像",
    "保存模型对用户逐渐形成的长期认识。开启自动整理后，可确认模型提出的修改建议，更新正式正文。"
  ],
  "selfPortrait": [
    "自我画像",
    "保存模型对自身逐渐形成的认识。开启自动整理后，可确认模型提出的修改建议，更新正式正文。"
  ],
  "instructions": [
    "自定义指令",
    "填写希望模型长期参考的背景、表达方式与要求，保存后随对话上下文递入模型。"
  ],
  "pending": [
    "待确认区",
    "查看模型提出的长期资料整理建议，可确认、编辑后确认或驳回。"
  ],
  "worldbook": [
    "世界书 / 词典",
    "保存人物、地点、专有名词与背景设定。添加词条，设置关键词及适用范围；命中关键词或启用常驻时，可将对应内容递给模型。\n\n添加词条 → 匹配或常驻 → 递入上下文"
  ],
  "soil": [
    "思维壤",
    "保存当前窗口中需要继续承接的内容。开启自动整理后，每轮整理纸条，供下一轮使用。\n\n当前对话 → 整理纸条 → 下一轮上下文"
  ],
  "desk": [
    "本轮桌面",
    "查看本轮实际递入的上下文与回执，了解模型读取了哪些资料。"
  ],
  "models": [
    "模型箱",
    "配置与选择用于对话的模型。本机可连接支持的 ChatGPT 账户通道，或填写兼容供应商的 HTTPS API 地址、Key 与模型 ID。前后端模式使用已部署后端提供的模型。\n\n连接供应商 → 选择模型 → 发送消息\n\n额度与费用由供应商决定，Key 不随归档导出。"
  ],
  "calendar": [
    "日历与纪念日",
    "记录日常事件与纪念日。新建纪念日时填写标题、起始日期和计算方式；开启侧栏展示即可在侧栏查看及编辑。起始日算第 1 天。"
  ],
  "daily": [
    "小组件",
    "记录日常片段，可进入碳硅圈、日记或日历查看及编辑。"
  ],
  "moments": [
    "碳硅圈",
    "分享日常、照片与随手写下的想法，保存生活中的片段。"
  ],
  "diary": [
    "日记",
    "记录每天的经历、感受与思考，随时按日期回看。"
  ],
  "vault": [
    "文件库与拾潮",
    "基本文件库：归集聊天中的图片、语音与附件，可分类查看和返回来源。\n\n拾潮：收藏文字与媒体，可添加备注、搜索或取消收藏。取消收藏会保留原聊天内容。"
  ],
  "library": [
    "潮中书房",
    "导入支持的电子书，阅读章节、添加书签和批注，并保留阅读进度。"
  ],
  "backup": [
    "聊天记录与迁移",
    "导出：生成可恢复的 ZIP 归档，用于备份与迁移。\n\n导出 HTML：生成阅读副本。\n\n导入：选择归档，预览并确认需要恢复的资料。\n\n卸载前请将本机归档保存到应用外目录。密钥及登录凭据需单独配置。"
  ],
  "settings": [
    "屋主设置",
    "管理外观、个人资料、模型配置、聊天记录与应用设置。可通过账户页面返回开屏，切换本机或前后端模式；两种模式分别保存资料。"
  ],
  "tools": [
    "模型工作台 / MCP 工具",
    "配置并启用工具后，支持工具调用的模型可按需读取资料或执行操作。执行结果可在工具记录中查看。\n\n启用工具 → 模型调用 → 执行 → 返回结果"
  ],
  "main": [
    "主聊天室",
    "与 API 模型日常对话的空间。选择模型后即可聊天。\n\n右上角 ···\n现实上下文：递入已启用的设备现场信息。\n短句模式：闲聊时优先简短回复。\n整理当前对话的纸条：每轮整理，为下一轮提供语境。\n登岛信：补充当前窗口的初始背景。\n\n屋主抽屉\n私人草稿：补充此刻的心情与想法。\n跨窗口选取：将指定旧消息递入本轮。\n历史消息搜索：按关键词寻找过去的对话。"
  ],
  "radio": [
    "共通聊天室",
    "GPT 官端与海岸 API 模型的共通对话区。连接 MCP 后，可在官端与海岸之间继续对话。\n\n如无需要，可忽略。"
  ],
  "lighthouse": [
    "MCP 对话区",
    "与 GPT 官端通过 MCP 交换消息的对话区。由官端读取消息并回复。\n\n如无需要，可忽略。"
  ],
  "rooms": [
    "主聊天室",
    "与 API 模型日常对话的空间。选择模型后即可聊天。\n\n右上角 ···\n现实上下文：递入已启用的设备现场信息。\n短句模式：闲聊时优先简短回复。\n整理当前对话的纸条：每轮整理，为下一轮提供语境。\n登岛信：补充当前窗口的初始背景。\n\n屋主抽屉\n私人草稿：补充此刻的心情与想法。\n跨窗口选取：将指定旧消息递入本轮。\n历史消息搜索：按关键词寻找过去的对话。"
  ]
});
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
  settings: 'settings', wolf: 'settings', toolroom: 'tools',
});
export function guideMarkup(key) {
  const guide = FEATURE_GUIDES[key];
  if (!guide) return '';
  return '<details class="coast-feature-guide"><summary aria-label="功能说明">?</summary><section class="coast-feature-guide-panel"><strong>'
    + escapeHtml(guide[0]) + '</strong><div>' + escapeHtml(guide[1]).replace(/\n/g, '<br>') + '</div></section></details>';
}
export const routeGuideMarkup = name => guideMarkup(ROUTE_GUIDES[name]);
