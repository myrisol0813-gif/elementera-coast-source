import assert from 'node:assert/strict';
import { createConversation } from '../functions/chat-store.js';
import { assembleCleanContext } from '../functions/context-assemble-clean.js';
import {
  confirmGlobalExcerptCandidate,
  confirmUserPortraitCandidate,
  createGlobalExcerptCandidate,
  createUserPortraitCandidate,
  readGlobalExcerpt,
  readUserPortrait,
  setGlobalExcerptWriteEnabled,
  setUserPortraitWriteEnabled,
} from '../functions/memory-store.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
const conversation = await createConversation(db, 'portrait flow contract');

const userCandidate = await createUserPortraitCandidate(db, {
  proposed_body: '【用户画像正文】这个用户习惯先把问题拆成可验证的小步骤。',
  reason: '形成了可长期辨认的交流方式。',
  source_conversation_id: conversation.id,
  source_message_id: 'turn-user-portrait',
  source_model: 'test-model',
});
await confirmUserPortraitCandidate(db, userCandidate.id, { operator: 'user' });

const selfCandidate = await createGlobalExcerptCandidate(db, {
  proposed_body: '【自我画像正文】我倾向于把不确定之处显式说清，再继续行动。',
  reason: '形成了稳定的自我认识。',
  source_conversation_id: conversation.id,
  source_message_id: 'turn-self-portrait',
  source_model: 'test-model',
});
await confirmGlobalExcerptCandidate(db, selfCandidate.id, { operator: 'user' });

const messages = [{ role: 'user', content: '这一轮只是普通问候。' }];
const first = await assembleCleanContext({ COAST_CHAT_DB: db }, {
  surface: 'main_chat',
  conversationId: conversation.id,
  messages,
  lastUser: messages[0],
  permission: 'owner',
  preview: true,
});
const firstSystem = first.modelMessages[0]?.content || '';
assert.ok(firstSystem.includes('【用户画像】'));
assert.ok(firstSystem.includes('【用户画像正文】'));
assert.ok(firstSystem.includes('【自我画像】'));
assert.ok(firstSystem.includes('【自我画像正文】'));

const firstSlip = first.deskSlip();
assert.equal(firstSlip.user_portrait.delivered, true);
assert.equal(firstSlip.user_portrait.status, '完整注入');
assert.equal(firstSlip.global_excerpt.delivered, true);
assert.equal(firstSlip.global_excerpt.label, '自我画像');
assert.ok(firstSlip.context_budget.sources_preserved.includes('用户画像'));
assert.ok(firstSlip.context_budget.sources_preserved.includes('自我画像'));

await setUserPortraitWriteEnabled(db, false);
await setGlobalExcerptWriteEnabled(db, false);
assert.equal((await readUserPortrait(db)).write_enabled, false);
assert.equal((await readGlobalExcerpt(db)).write_enabled, false);

const second = await assembleCleanContext({ COAST_CHAT_DB: db }, {
  surface: 'main_chat',
  conversationId: conversation.id,
  messages,
  lastUser: messages[0],
  permission: 'owner',
  preview: true,
});
const secondSystem = second.modelMessages[0]?.content || '';
assert.ok(secondSystem.includes('【用户画像正文】'), 'auto-organize off must not remove user portrait from context');
assert.ok(secondSystem.includes('【自我画像正文】'), 'auto-organize off must not remove self portrait from context');
assert.equal(second.deskSlip().user_portrait.delivered, true);
assert.equal(second.deskSlip().global_excerpt.delivered, true);

console.log('portrait-flow: ok');
