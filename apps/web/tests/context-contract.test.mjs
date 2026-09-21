import assert from 'node:assert/strict';
import { createConversation } from '../functions/chat-store.js';
import { assembleCleanContext } from '../functions/context-assemble-clean.js';
import { registerMailboxVisitor } from '../functions/mailbox-service.js';
import { GLOBAL_EXCERPT_INITIAL_TEXT, confirmGlobalExcerptCandidate, createEntry, createGlobalExcerptCandidate, createPocket, writeCustomInstructions, writeSoil } from '../functions/memory-store.js';
import { createWorldbookEntry } from '../functions/worldbook.js';
import { D1Database } from './d1-helper.mjs';

const THIN_SHELL = '遵循本轮提供的上下文与屋主保存的自定义指令回应。工具调用必须如实；没有执行成功的动作不能说成已经完成。';
const OLD_OWNER_IDENTITY = 'You are the Elementera Coast demo assistant，在 Elementera Coast 里和屋主继续这段真实对话。';
const OWNER_CUSTOM = '【屋主原文】先回应眼前这句话。\n\n不要把这份自定义指令改写成摘要。';
const PENDING_SECRET = 'PENDING_POCKET_SECRET_713';
const SOIL_CANDIDATE_SECRET = 'SOIL_CANDIDATE_SECRET_713';
const CONSTANT_SECRET = 'CONSTANT_WORLDBOOK_SECRET_713';
const SOURCE_GLOBAL_EXCERPT = '这是 source 测试用的合成全局摘录正文。';
const DELIVERED_SOURCE_LABELS = [
  '【当前消息】', '【最近上下文】', '【核心自定义】', '【全局摘录】', '【整理当前对话的纸条】', '【相关记忆】',
  '【世界书】', '【工作台 / 工具回执】', '【外部入口消息】',
];

const db = new D1Database();
const env = { COAST_CHAT_DB: db, COAST_SESSION_SECRET: 'context-contract-mailbox-secret-'.repeat(3) };
const conversation = await createConversation(db, 'Context Contract v1');
await writeCustomInstructions(db, { content: OWNER_CUSTOM });
const sourceExcerptCandidate = await createGlobalExcerptCandidate(db, { proposed_body: SOURCE_GLOBAL_EXCERPT, reason: 'source contract fixture' });
await confirmGlobalExcerptCandidate(db, sourceExcerptCandidate.id, { operator: 'test' });
await writeSoil(db, conversation.id, {
  current_text: '当前整理当前对话的纸条只承接透明上下文。', hand_seeds: [{ name: '透明纸条', life_core: '只看本轮真正递给模型的内容。' }],
  pocket_candidates: [{ candidate_id: 'candidate_context_contract', title: '不该直递的候选', life_core: SOIL_CANDIDATE_SECRET, content: SOIL_CANDIDATE_SECRET }],
});
await createEntry(db, { entry_type: 'memory', scope: 'conversation', conversation_id: conversation.id, title: '透明记忆', life_core: '只有召回命中时才递进本轮。', tag: '工程技术', source_window: 'Context Contract v1', status: 'active' });
await createPocket(db, { conversation_id: conversation.id, source_type: 'soil', source_ref: { conversation_id: conversation.id, candidate_id: 'pending_context_contract' }, source_text: PENDING_SECRET, title: '待确认秘密', life_core: PENDING_SECRET });
await createWorldbookEntry(db, { title: '透明词典', content: '只有关键词命中时才成为本轮世界书纸条。', keywords: ['透明词典'], scope: 'owner', priority: 100 });
await createWorldbookEntry(db, { title: '无关键词常驻旧件', content: CONSTANT_SECRET, keywords: [], constant_active: true, scope: 'owner', priority: 200 });

const messages = [
  { role: 'user', content: '历史第一轮，不该占最近两轮。' }, { role: 'assistant', content: '历史第一轮回应。' },
  { role: 'user', content: '历史第二轮。' }, { role: 'assistant', content: '历史第二轮回应。' },
  { role: 'user', content: '历史第三轮。' }, { role: 'assistant', content: '历史第三轮回应。' },
  { role: 'user', content: '请看看透明记忆和透明词典，然后告诉我这轮桌面有什么。' },
];
const owner = await assembleCleanContext(env, {
  surface: 'main_chat', conversationId: conversation.id, messages, lastUser: messages.at(-1),
  settings: { recentTurns: 2, contextBudget: 6000, memoryLimit: 8, worldbookLimit: 6 }, permission: 'owner', preview: true,
  baseSystemPrompt: 'HIDDEN_OWNER_PERSONA_SHOULD_NOT_WIN',
});
const system = owner.modelMessages[0]?.content || '';
const visiblePrompt = owner.modelMessages.map((message) => message.content).join('\n\n');
assert.equal(owner.modelMessages[0]?.role, 'system');
assert.match(system, new RegExp(THIN_SHELL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.ok(system.includes('【核心自定义】'));
assert.ok(system.includes(OWNER_CUSTOM));
assert.ok(system.includes('【全局摘录】'));
assert.ok(system.includes(SOURCE_GLOBAL_EXCERPT));
assert.ok(system.indexOf('【核心自定义】') < system.indexOf('【全局摘录】'), 'global excerpt follows custom instructions');
assert.equal(owner.paper_slips.includes(OWNER_CUSTOM), true);
assert.equal(system.includes(OLD_OWNER_IDENTITY), false);
assert.equal(system.includes('HIDDEN_OWNER_PERSONA_SHOULD_NOT_WIN'), false);
for (const label of DELIVERED_SOURCE_LABELS) assert.ok(visiblePrompt.includes(label), `missing delivered source label ${label}`);
assert.equal(visiblePrompt.includes('【人类思考链】'), false, 'empty dogtalk must not be injected just to display a label');
assert.ok(system.includes('本轮没有递入外部材料。'));
assert.ok(system.includes('透明记忆'));
assert.ok(system.includes('透明词典'));
assert.equal(system.includes(PENDING_SECRET), false);
assert.equal(system.includes(SOIL_CANDIDATE_SECRET), false);
assert.equal(system.includes(CONSTANT_SECRET), false);
assert.doesNotMatch(visiblePrompt, /按优先级从前到后遵循|以下分区按优先级/u);
assert.doesNotMatch(system, /【今日海岸】/);

const deliveredMessages = owner.modelMessages.filter((message) => message.role !== 'system');
assert.deepEqual(deliveredMessages.at(-1), messages.at(-1));
assert.equal(deliveredMessages.filter((message) => message.role === 'user').length - 1, 2);
assert.equal(deliveredMessages.some((message) => message.content.includes('历史第一轮')), false);
assert.equal(deliveredMessages.some((message) => message.content.includes('历史第二轮')), true);
assert.equal(deliveredMessages.some((message) => message.content.includes('历史第三轮')), true);

const slip = owner.deskSlip();
for (const key of ['current_message', 'recent_context', 'custom_instructions', 'global_excerpt', 'thinking_soil', 'related_memory', 'worldbook', 'dogtalk', 'workbench', 'external_tide', 'context_budget']) assert.ok(Object.hasOwn(slip, key));
assert.equal(Object.hasOwn(slip, 'touch'), false);
assert.equal(Object.hasOwn(slip, 'cross_window_touch'), false);
assert.equal(slip.summary, '本轮递给模型');
assert.equal(slip.current_message.label, '当前消息');
assert.equal(slip.current_message.content, messages.at(-1).content);
assert.equal(slip.recent_context.label, '最近上下文');
assert.equal(slip.recent_context.status, '已递给');
assert.equal(slip.recent_context.status_detail, '2 轮');
assert.equal(slip.custom_instructions.label, '核心自定义');
assert.equal(slip.custom_instructions.status, '已递给');
assert.equal(slip.custom_instructions.content, OWNER_CUSTOM);
assert.equal(slip.global_excerpt.status, '完整注入');
assert.equal(slip.global_excerpt.content, SOURCE_GLOBAL_EXCERPT);
assert.equal(slip.context_budget.global_excerpt, 'complete');
assert.ok(slip.context_budget.sources_preserved.includes('全局摘录'));
assert.equal(slip.thinking_soil.current_text, '当前整理当前对话的纸条只承接透明上下文。');
assert.equal(slip.thinking_soil.hand_seeds_count, 1);
assert.equal(slip.thinking_soil.pocket_candidates_count, 1);
assert.equal(slip.thinking_soil.pocket_candidates_status, '待确认');
assert.ok(slip.related_memory.items.some((item) => item.title === '透明记忆'));
assert.equal(slip.related_memory.status, '已递给');
assert.equal(slip.related_memory.confirmation_status, '已确认');
assert.equal(slip.worldbook.status, '已递给');
assert.deepEqual(slip.worldbook.delivered_titles, ['透明词典']);
assert.equal(slip.dogtalk.status, '未递给');
assert.equal(slip.workbench.status, '已递给');
assert.equal(slip.workbench.prompt_delivered, true);
assert.equal(slip.workbench.label, '工作台 / 工具回执');
assert.equal(slip.workbench.labels.model_visible_tools, '模型可见工具');
assert.equal(slip.workbench.labels.backend_tools, '后端可用工具');
assert.ok(slip.workbench.model_visible_tools.length > 0);
assert.ok(slip.workbench.backend_tools.length >= slip.workbench.model_visible_tools.length);
assert.ok(slip.workbench.model_visible_tools.some((tool) => tool.name === 'memory_search' && tool.display_name === '搜索已确认记忆'));
assert.equal(Object.hasOwn(slip.workbench, 'model_tools'), false);
assert.equal(slip.external_tide.label, '外部入口消息');
assert.equal(slip.external_tide.status, '未递给');
assert.equal(slip.external_tide.content, '本轮没有递入外部材料。');

const emptyDb = new D1Database();
const emptyConversation = await createConversation(emptyDb, '空上下文');
await writeCustomInstructions(emptyDb, { content: '' });
const emptyMessages = [{ role: 'user', content: '普通的一轮，不提任何词条。' }];
const empty = await assembleCleanContext({ COAST_CHAT_DB: emptyDb }, {
  surface: 'main_chat', conversationId: emptyConversation.id, messages: emptyMessages, lastUser: emptyMessages.at(-1), permission: 'owner', preview: true,
});
const emptySystem = empty.modelMessages[0]?.content || '';
assert.ok(emptySystem.includes(THIN_SHELL));
assert.equal(emptySystem.includes(OLD_OWNER_IDENTITY), false);
assert.equal(emptySystem.includes('【核心自定义】'), false, 'empty custom instructions must not be injected into model context');
assert.equal(emptySystem.includes('【全局摘录】'), false, 'empty source baseline excerpt must not inject an empty section');
assert.ok(emptySystem.includes('【外部入口消息】'));
assert.ok(emptySystem.includes('本轮没有递入外部材料。'));
assert.ok(emptySystem.includes('【当前消息】'));
assert.deepEqual(empty.modelMessages.at(-1), emptyMessages.at(-1));
const emptySlip = empty.deskSlip();
assert.equal(emptySlip.custom_instructions.status, '未递给');
assert.equal(emptySlip.related_memory.status, '未命中');
assert.equal(emptySlip.worldbook.status, '未命中');
assert.equal(emptySlip.thinking_soil.status, '未递给');
assert.equal(emptySlip.external_tide.content, '本轮没有递入外部材料。');

await writeCustomInstructions(db, { content: 'OWNER_PRIVATE_CUSTOM_INSTRUCTION_713' });
const visitor = await registerMailboxVisitor(db, env, { display_name: '上下文访客', preferred_name: '小访客', passphrase: '透明海岸-713', allow_memory: true });
const visitorMessages = [{ role: 'user', content: '这里只是访客信箱的一句话。' }];
const visitorContext = await assembleCleanContext(env, {
  surface: 'mailbox_visitor', visitorId: visitor.id, messages: visitorMessages, lastUser: visitorMessages.at(-1), permission: 'visitor', preview: true, exposeTools: false,
});
const visitorSystem = visitorContext.modelMessages[0]?.content || '';
assert.equal(visitorSystem.includes('OWNER_PRIVATE_CUSTOM_INSTRUCTION_713'), false);
assert.equal(visitorSystem.includes(THIN_SHELL), false);

console.log('context-contract: ok');
