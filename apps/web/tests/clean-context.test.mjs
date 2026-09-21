import assert from 'node:assert/strict';
import { createConversation } from '../functions/chat-store.js';
import { assembleCleanContext } from '../functions/context-assemble-clean.js';
import { trimContextToComfortRange } from '../functions/context-comfort-range.js';
import { createEntry, writeSoil } from '../functions/memory-store.js';
import { createWorldbookEntry } from '../functions/worldbook.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
const conversation = await createConversation(db, '干净纸条测试');
await writeSoil(db, conversation.id, {
  current_text: '正在承接潮蓝苹果和干净上下文。',
  hand_seeds: [{ name: '潮蓝苹果', life_core: '用一枚具体的蓝色果实承接这轮。', usage_hint: '不应输出', avoid_hint: '不应输出' }],
  do_not_repeat: '不要说成后端说明书。',
});
await createEntry(db, {
  entry_type: 'memory', scope: 'conversation', conversation_id: conversation.id,
  title: '潮蓝苹果', life_core: '屋主喜欢这枚作为当下承接的小意象。', content: '只在相关时轻轻使用。', status: 'active',
});
const messages = [
  { role: 'user', content: '我们刚才在整理一张纸。' },
  { role: 'assistant', content: '嗯，我还沿着那张纸。' },
  { role: 'user', content: '请从记忆里找回潮蓝苹果，再说说整理当前对话的纸条。' },
];
await createWorldbookEntry(db, { title: '整理当前对话的纸条', content: '这是一条测试中手动写入、而不是系统预置的海岸词条。', keywords: ['整理当前对话的纸条'], scope: 'owner', priority: 100 });
const assembled = await assembleCleanContext({ COAST_CHAT_DB: db }, {
  surface: 'main_chat', conversationId: conversation.id, messages, lastUser: messages.at(-1), localDate: '2026-01-10',
  settings: { contextBudget: 6000, recentTurns: 6, soilBudget: 1800 }, permission: 'owner', preview: true, initialFurniture: ['收好一张人类思考链纸条'],
});
assert.deepEqual(assembled.modelMessages.at(-1), messages.at(-1));
assert.equal(assembled.modelMessages[0].role, 'system');
const modelText = assembled.modelMessages.map((message) => message.content).join('\n');
assert.match(modelText, /【当前消息】/);
assert.match(modelText, /【整理当前对话的纸条】/);
assert.match(modelText, /【相关记忆】/);
assert.match(modelText, /【世界书】/);
assert.match(modelText, /潮蓝苹果/);
assert.doesNotMatch(modelText, /【今日海岸】/);
assert.doesNotMatch(assembled.paper_slips, /【今日海岸】/);
assert.doesNotMatch(modelText, /暂无相关记忆|暂无触角/);
for (const retired of ['【上下文目录】', 'Context Manifest', 'Surface Profile', '【海岸环境】', '当前情境', '当前模型', 'conversation_id', 'priority=', 'freshness=', 'confidence=', 'use_hint', 'avoid_hint', 'trim_reason', 'block_order', 'tool_registry:intersection']) assert.equal(modelText.includes(retired), false, `model context still contains ${retired}`);
assert.equal(modelText.includes('不应输出'), false);
const functionTools = assembled.tools.filter((tool) => tool.type === 'function');
assert.equal(functionTools.some((tool) => tool.function.name.startsWith('calendar_')), false);
assert.ok(functionTools.some((tool) => tool.function.name === 'memory_search'));
assert.equal(functionTools.some((tool) => tool.function.name === 'worldbook_test_match'), false);
assert.ok(assembled.tools.some((tool) => tool.type === 'openrouter:web_search'), 'owner main chat exposes on-demand web search');
assert.equal(Object.hasOwn(assembled, 'manifest'), false);
assert.equal(Object.hasOwn(assembled, 'debug'), false);
assert.equal(Object.hasOwn(assembled, 'blocks'), false);
const slip = assembled.deskSlip();
assert.equal(slip.current_message.content, messages.at(-1).content);
assert.equal(slip.thinking_soil.delivered, true);
assert.match(slip.thinking_soil.current_text, /潮蓝苹果/);
assert.ok(slip.related_memory.count >= 1);
assert.ok(slip.worldbook.delivered_titles.includes('整理当前对话的纸条'));
assert.deepEqual(slip.workbench.furniture, ['收好一张人类思考链纸条']);
assert.equal(slip.workbench.labels.model_visible_tools, '模型可见工具');
assert.equal(slip.workbench.labels.backend_tools, '后端可用工具');
assert.ok(slip.workbench.model_visible_tools.some((tool) => tool.name === 'memory_search'));
assert.equal(Object.hasOwn(slip.workbench, 'model_tools'), false);
assert.equal(Object.hasOwn(slip, 'touch'), false);
assert.equal(Object.hasOwn(slip, 'cross_window_touch'), false);

const current = '这是当前用户输入，必须保留。';
const comfort = trimContextToComfortRange({
  basePrompt: 'You are the Elementera Coast demo assistant。', soilText: `【整理当前对话的纸条】\n${'当前的纸条。'.repeat(600)}`,
  memoryItems: Array.from({ length: 14 }, (_, index) => `低相关旧记忆 ${index} ${'潮声'.repeat(80)}`),
  worldbookItems: Array.from({ length: 10 }, (_, index) => `低相关词条 ${index}：${'海风'.repeat(80)}`),
  messages: [
    { role: 'user', content: '最近第一轮' }, { role: 'assistant', content: '第一轮回应' },
    { role: 'user', content: '最近第二轮' }, { role: 'assistant', content: '第二轮回应' },
    { role: 'user', content: '最近第三轮' }, { role: 'assistant', content: '第三轮回应' }, { role: 'user', content: current },
  ], maxTokens: 1800, recentTurns: 8,
});
assert.deepEqual(comfort.modelMessages.at(-1), { role: 'user', content: current });
assert.match(comfort.modelMessages[0].content, /【当前消息】/);
assert.equal(comfort.keptMessages.at(-1).content, current);
assert.equal(comfort.currentUserPreserved, true);
assert.ok(comfort.modelMessages.filter((message) => message.role !== 'system').length >= 4);
assert.ok(comfort.trimmedCount > 0);
assert.ok(comfort.kept.memory < 14 || comfort.kept.worldbook < 10);
assert.equal(Object.hasOwn(comfort.kept, 'touch'), false);

console.log('clean-context: ok');
