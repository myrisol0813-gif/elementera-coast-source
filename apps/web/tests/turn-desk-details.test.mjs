import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConversation } from '../functions/chat-store.js';
import { assembleCleanContext } from '../functions/context-assemble-clean.js';
import { saveMysticDogtalk } from '../functions/dogtalk-store.js';
import { registerMailboxVisitor } from '../functions/mailbox-service.js';
import { createEntry, writeCustomInstructions, writeSoil } from '../functions/memory-store.js';
import { createWorldbookEntry } from '../functions/worldbook.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
const env = { COAST_CHAT_DB: db, COAST_SESSION_SECRET: 'turn-desk-details-'.repeat(4) };
const conversation = await createConversation(db, '本轮上下文预览全文验收');
const customContent = `【自定义指令全文】\n${'自定义原文不应被本轮上下文预览截断。'.repeat(42)}`;
const soilCurrent = `整理当前对话的纸条全文：${'潮声沿着纸页继续向前，不在七百字处消失。'.repeat(36)}`;
const seedCore = `当前活跃线索全文：${'只显示实际递给模型的当前活跃线索。'.repeat(8)}`;
const memoryCore = `记忆核心全文：${'这一段故意超过旧的五百二十字裁剪限制。'.repeat(42)}`;
const memoryContent = `记忆 content 全文：${'这是被选中记录的完整 content，不应用短 preview 替代。'.repeat(36)}`;
const usageHint = `使用时机全文：${'只有谈到透明桌面与记忆收据时使用。'.repeat(12)}`;
const avoidHint = `勿误用全文：${'不要把 seed 或候选当成强事实。'.repeat(12)}`;
const worldbookContent = `世界书全文：${'只有“桌面透明词典”命中时才进入本轮上下文。'.repeat(38)}`;
const dogtalkBody = `私人草稿全文：${'这一轮请把真正递给模型的私人草稿原样放进透明收据。'.repeat(32)}`;
const pendingSecret = 'PENDING_DETAIL_MUST_NOT_APPEAR';

await writeCustomInstructions(db, { content: customContent });
await writeSoil(db, conversation.id, {
  current_text: soilCurrent,
  hand_seeds: [{ name: '透明当前活跃线索', life_core: seedCore }],
  pocket_candidates: [{ candidate_id: 'candidate_turn_desk_full_details', title: '待确认候选', life_core: pendingSecret, content: pendingSecret }],
});
await createEntry(db, {
  entry_type: 'memory', scope: 'global', conversation_id: null, title: '全量透明记忆', life_core: memoryCore, usage_hint: usageHint, avoid_hint: avoidHint,
  content: memoryContent, tag: '工程技术', source_model: 'openai/gpt-5.5-thinking', source_window: '本轮上下文预览全文验收', source_time: '2026-08-31T20:00:00+08:00', status: 'active',
});
await createWorldbookEntry(db, { title: '桌面透明词典', content: worldbookContent, keywords: ['桌面透明词典'], scope: 'owner', priority: 100 });
await saveMysticDogtalk(db, { room_scope: 'conversation', conversation_id: conversation.id, body: dogtalkBody, true_core: '只在这次 read_now 里递给。', weather: '透明', read_mode: 'read_now' });

const messages = [
  { role: 'user', content: '最旧的一轮，最近两轮不该再带它。' }, { role: 'assistant', content: '最旧回应。' },
  { role: 'user', content: '最近第二轮用户消息。' }, { role: 'assistant', content: '最近第二轮助手消息。' },
  { role: 'user', content: '最近第三轮用户消息。' }, { role: 'assistant', content: '最近第三轮助手消息。' },
  { role: 'user', content: '请看全量透明记忆、桌面透明词典和这次私人草稿，并告诉我本轮上下文预览详情。' },
];
const assembled = await assembleCleanContext(env, {
  surface: 'main_chat', conversationId: conversation.id, messages, lastUser: messages.at(-1),
  settings: { recentTurns: 2, contextBudget: 14000, soilBudget: 1800, memoryLimit: 8, worldbookLimit: 6 }, permission: 'owner', preview: true,
});
const system = assembled.modelMessages[0]?.content || '';
const slip = assembled.deskSlip();

assert.equal(slip.custom_instructions.delivered, true);
assert.equal(slip.custom_instructions.content, customContent);
assert.equal(slip.custom_instructions.length, customContent.length);
assert.equal(Object.hasOwn(slip.custom_instructions, 'preview'), false);
assert.ok(customContent.length > 360);
assert.equal(slip.thinking_soil.delivered, true);
assert.ok(slip.thinking_soil.current_text.length > 700);
assert.equal(slip.thinking_soil.context.includes(slip.thinking_soil.current_text), true);
assert.equal(system.includes(slip.thinking_soil.context), true);
assert.equal(slip.thinking_soil.hand_seeds.length, 1);
assert.ok(slip.thinking_soil.hand_seeds[0].includes('透明当前活跃线索'));
assert.equal(slip.thinking_soil.pocket_candidates_count, 1);
assert.equal(slip.thinking_soil.pocket_candidates_delivered, false);
assert.equal(system.includes(pendingSecret), false);

const memory = slip.related_memory.items.find((item) => item.title === '全量透明记忆');
assert.ok(memory);
assert.equal(memory.entry_type, 'memory');
assert.equal(memory.tag, '工程技术');
assert.equal(memory.source_window, '本轮上下文预览全文验收');
assert.equal(memory.life_core, memoryCore);
assert.equal(memory.usage_hint, usageHint);
assert.equal(memory.avoid_hint, avoidHint);
assert.equal(memory.content, memoryContent);
assert.ok(memory.life_core.length > 520);
assert.ok(memory.content.length > 900);
for (const deliveredField of [memoryCore, usageHint, avoidHint, memoryContent]) {
  assert.equal(memory.delivered_text.includes(deliveredField), true);
  assert.equal(system.includes(deliveredField), true);
}
const word = slip.worldbook.entries.find((item) => item.title === '桌面透明词典');
assert.ok(word);
assert.equal(word.content, worldbookContent);
assert.equal(word.scope, 'owner');
assert.equal(word.matched_by, 'user_input');
assert.equal(word.delivered, true);
assert.equal(system.includes(word.delivered_text), true);
assert.equal(slip.dogtalk.delivered, true);
assert.ok(slip.dogtalk.context.includes(dogtalkBody));
assert.equal(system.includes(slip.dogtalk.context), true);
assert.equal(slip.current_message.content, messages.at(-1).content);
assert.equal(slip.recent_context.turns, 2);
assert.deepEqual(slip.recent_context.messages, messages.slice(2, 6));

assert.equal(slip.workbench.labels.model_visible_tools, '模型可见工具');
assert.equal(slip.workbench.labels.backend_tools, '后端可用工具');
assert.ok(Array.isArray(slip.workbench.model_visible_tools));
assert.ok(Array.isArray(slip.workbench.backend_tools));
assert.ok(Array.isArray(slip.workbench.core_tools));
assert.ok(Array.isArray(slip.workbench.side_tools));
assert.ok(slip.workbench.model_visible_tools.length > 0);
assert.ok(slip.workbench.backend_tools.length >= slip.workbench.model_visible_tools.length);
assert.equal(Object.hasOwn(slip.workbench, 'model_tools'), false);
assert.equal(Object.hasOwn(slip.workbench, 'exposed_tools'), false);
assert.equal(typeof slip.workbench.prompt_delivered, 'boolean');
assert.ok(Array.isArray(slip.workbench.tool_results));

const visitor = await registerMailboxVisitor(db, env, { display_name: '全文桌面访客', preferred_name: '访客', passphrase: 'turn-desk-visitor-09', allow_memory: true });
const visitorContext = await assembleCleanContext(env, {
  surface: 'mailbox_visitor', visitorId: visitor.id, messages: [{ role: 'user', content: '访客只说一句普通的话。' }], lastUser: { role: 'user', content: '访客只说一句普通的话。' }, permission: 'visitor', preview: true, exposeTools: false,
});
const visitorSlip = visitorContext.deskSlip();
assert.equal(visitorSlip.custom_instructions.content, '');
assert.deepEqual(visitorSlip.related_memory.items, []);
assert.deepEqual(visitorSlip.worldbook.entries, []);
assert.equal(visitorSlip.dogtalk.context, '');
assert.deepEqual(visitorSlip.recent_context.messages, []);
assert.equal(visitorSlip.current_message.content, '');
assert.deepEqual(visitorSlip.workbench.tool_results, []);

const deskSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/desk.js', import.meta.url), 'utf8');
assert.equal(deskSource.includes('custom.preview'), false);
for (const token of ['custom.content', 'recent.messages', 'worldbook.entries', 'dogtalk.context', 'workbench.tool_results', 'workbench.model_visible_tools']) assert.ok(deskSource.includes(token));
for (const token of ['requested_turns', 'loaded_turns', 'delivered_to_model_turns', 'attempted_delivered_turns', 'attempted_chars', 'attempted_estimated_tokens', 'provider_error_type', 'provider_error_message']) assert.ok(deskSource.includes(token), `cross-window desk UI must expose ${token}`);
for (const label of ['用户消息', '模型伙伴回复', '核心', '使用时机', '勿误用', '当前整理', '当前活跃线索', '待确认候选', '工具结果 JSON', '本轮总计', '尝试递送字符', 'Provider 错误类型', 'Provider 错误摘要']) assert.ok(deskSource.includes(label));
assert.equal(deskSource.includes('source.delivered_turns'), false, 'PWA desk must not read retired cross-window source fields');
for (const retired of ['今日海岸', 'today_coast', 'calendar.', '/api/calendar']) assert.equal(deskSource.includes(retired), false);

console.log('turn-desk-details: ok');