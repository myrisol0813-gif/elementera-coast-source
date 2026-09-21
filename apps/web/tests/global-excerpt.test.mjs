import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import {
  GLOBAL_EXCERPT_INITIAL_TEXT,
  GLOBAL_EXCERPT_WRITE_GUIDANCE,
  confirmGlobalExcerptCandidate,
  createGlobalExcerptCandidate,
  discardGlobalExcerptCandidate,
  listGlobalExcerptCandidates,
  listGlobalExcerptRevisions,
  readGlobalExcerpt,
  setGlobalExcerptWriteEnabled,
} from '../functions/memory-store.js';
import { trimContextToComfortRange } from '../functions/context-comfort-range.js';
import { resolveToolSelection } from '../functions/tool-registry.js';

const db = new D1Database();

const initial = await readGlobalExcerpt(db);
assert.equal(initial.body, GLOBAL_EXCERPT_INITIAL_TEXT);
assert.equal(initial.write_guidance, GLOBAL_EXCERPT_WRITE_GUIDANCE);
assert.equal(initial.body, '', 'source baseline must not ship a private initial excerpt');
assert.equal(initial.write_enabled, true);
assert.equal(initial.revision, 1);

await setGlobalExcerptWriteEnabled(db, false);
const readonly = await readGlobalExcerpt(db);
assert.equal(readonly.write_enabled, false);
assert.equal(readonly.body, GLOBAL_EXCERPT_INITIAL_TEXT, 'closing writes must not hide or change the formal body');
await assert.rejects(
  () => createGlobalExcerptCandidate(db, { proposed_body: `${GLOBAL_EXCERPT_INITIAL_TEXT}\n\n不该写进去。`, reason: '测试关闭态' }),
  (error) => error?.type === 'global_excerpt_read_only' && error?.status === 409,
);
const toolsOff = resolveToolSelection({
  permission: 'owner',
  surface: 'main_chat',
  cross_window_mode: 'off',
  global_excerpt_write_enabled: false,
});
assert.equal(toolsOff.modelVisibleTools.some((tool) => tool.function?.name === 'global_excerpt_propose'), false);

await setGlobalExcerptWriteEnabled(db, true);
const toolsOn = resolveToolSelection({
  permission: 'owner',
  surface: 'main_chat',
  cross_window_mode: 'off',
  global_excerpt_write_enabled: true,
});
assert.equal(toolsOn.modelVisibleTools.some((tool) => tool.function?.name === 'global_excerpt_propose'), true);

const candidate = await createGlobalExcerptCandidate(db, {
  proposed_body: '这是 source 测试用的合成全局摘录正文，用于验证候选确认与修订链。',
  change_kind: 'refine',
  reason: '测试一条真正进入待确认区的高价值修改。',
  source_conversation_id: 'conversation-1',
  source_message_id: 'message-1',
  source_model: 'test-model',
});
assert.equal((await listGlobalExcerptCandidates(db)).length, 1);
assert.equal((await readGlobalExcerpt(db)).revision, 1, 'candidate must not directly mutate the formal body');

const editedBody = `${candidate.proposed_body}\n\n确认并不抹去来处，它让变化拥有可追踪的时间。`;
const confirmed = await confirmGlobalExcerptCandidate(db, candidate.id, { edited_body: editedBody, operator: 'user' });
assert.equal(confirmed.body, editedBody);
assert.equal(confirmed.revision, 2);
assert.equal((await listGlobalExcerptCandidates(db)).length, 0);
const revisions = await listGlobalExcerptRevisions(db);
assert.equal(revisions.length, 1);
assert.equal(revisions[0].before_body, GLOBAL_EXCERPT_INITIAL_TEXT);
assert.equal(revisions[0].after_body, editedBody);
assert.equal(revisions[0].confirmation_mode, 'edited_confirm');
assert.equal(revisions[0].source_conversation_id, 'conversation-1');
assert.equal(revisions[0].source_message_id, 'message-1');
assert.equal(revisions[0].model_reason, '测试一条真正进入待确认区的高价值修改。');

const discarded = await createGlobalExcerptCandidate(db, {
  proposed_body: `${editedBody}\n\n这段最后会被驳回。`,
  reason: 'discard test',
});
await discardGlobalExcerptCandidate(db, discarded.id);
assert.equal((await listGlobalExcerptCandidates(db)).length, 0);
assert.equal((await listGlobalExcerptRevisions(db)).length, 1, 'rejected candidates must not leave revision history');
assert.equal((await readGlobalExcerpt(db)).body, editedBody);

const custom = '核心自定义测试正文';
const excerpt = '全局摘录测试正文';
const comfort = trimContextToComfortRange({
  basePrompt: 'base',
  customInstructionsText: custom,
  globalExcerptText: excerpt,
  memoryItems: ['记忆测试正文'],
  worldbookItems: ['世界书测试正文'],
  messages: [{ role: 'user', content: '当前消息' }],
  maxTokens: 6000,
});
const system = comfort.modelMessages[0].content;
assert.ok(system.indexOf('【核心自定义】') < system.indexOf('【全局摘录】'));
assert.ok(system.indexOf('【全局摘录】') < system.indexOf('【相关记忆】'));
assert.equal(comfort.keptGlobalExcerptText, excerpt);
assert.equal(comfort.globalExcerptStatus, 'complete');

const oversizedExcerpt = '潮'.repeat(2400);
const overBudget = trimContextToComfortRange({
  basePrompt: 'base',
  customInstructionsText: custom,
  globalExcerptText: oversizedExcerpt,
  memoryItems: Array.from({ length: 10 }, (_, index) => `旧记忆 ${index} ${'海'.repeat(100)}`),
  messages: [{ role: 'user', content: '当前消息必须保留' }],
  maxTokens: 1800,
});
assert.equal(overBudget.keptGlobalExcerptText, oversizedExcerpt, 'global excerpt must never be silently clipped');
assert.equal(overBudget.globalExcerptStatus, 'over_budget');
assert.equal(overBudget.exceedsComfortCeiling, true);
assert.equal(overBudget.currentUserPreserved, true);

console.log('global-excerpt: ok');
