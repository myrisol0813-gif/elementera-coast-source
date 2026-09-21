import assert from 'node:assert/strict';
import {
  activeBranch,
  appendAssistantVariant,
  appendTurn,
  createState,
  deleteActiveAssistantVariant,
  deleteActiveUserVariant,
  editUserVariant,
  switchVariant,
  toggleAssistantReaction,
  normalizeState,
  updateAssistantVariant,
} from '../elementera-mcp/deploy-pages/public/features/chat-state.js';

let state = createState();
let result = appendTurn(state, 'a1', {
  dogtalk_snapshot_id: 'dogtalk-snapshot-turn-a1',
});
state = result.state;
const turnId = result.turn.id;
assert.equal(
  activeBranch(state.turns[0]).user.dogtalk_snapshot_id,
  'dogtalk-snapshot-turn-a1',
);
assert.deepEqual(
  activeBranch(state.turns[0]).user.attachments || [],
  [],
  'ordinary text turns do not invent attachments',
);

const attachmentState = appendTurn(createState(), '', {
  attachments: [{
    id: 'att-1',
    type: 'image',
    name: 'coast.png',
    mime: 'image/png',
    size: 321,
    storage_key: 'chat-attachment:att-1',
    created_at: '2026-09-15T12:00:00.000Z',
  }],
  message_source: 'owner_web',
  display_author: '屋主',
});
assert.equal(activeBranch(attachmentState.state.turns[0]).user.content, '');
assert.deepEqual(activeBranch(attachmentState.state.turns[0]).user.attachments, [{
  id: 'att-1',
  type: 'image',
  name: 'coast.png',
  mime: 'image/png',
  size: 321,
  storage_key: 'chat-attachment:att-1',
  created_at: '2026-09-15T12:00:00.000Z',
}]);

state = appendAssistantVariant(state, turnId, { content: 'answer-a1-1' }).state;
state = appendAssistantVariant(state, turnId, { content: 'answer-a1-2' }).state;
assert.equal(activeBranch(state.turns[0]).assistant.content, 'answer-a1-2');

state = switchVariant(state, turnId, 'assistant', 'previous');
assert.equal(activeBranch(state.turns[0]).assistant.content, 'answer-a1-1');
state = toggleAssistantReaction(state, turnId, 'liked');
state = toggleAssistantReaction(state, turnId, 'favorite');
assert.equal(activeBranch(state.turns[0]).assistant.liked, true);
assert.equal(activeBranch(state.turns[0]).assistant.favorite, true);

result = editUserVariant(state, turnId, 'a1 edited');
state = result.state;
state = appendAssistantVariant(state, turnId, { content: 'answer-edited' }).state;
assert.equal(state.turns[0].user.variants.length, 2);
assert.equal(activeBranch(state.turns[0]).assistant.content, 'answer-edited');

state = switchVariant(state, turnId, 'user', 'previous');
assert.equal(activeBranch(state.turns[0]).user.content, 'a1');
assert.equal(activeBranch(state.turns[0]).assistants.length, 2);

state = deleteActiveAssistantVariant(state, turnId);
assert.equal(activeBranch(state.turns[0]).assistants.length, 1);
assert.equal(activeBranch(state.turns[0]).assistant.content, 'answer-a1-2');

state = deleteActiveUserVariant(state, turnId);
assert.equal(state.turns[0].user.variants.length, 1);
assert.equal(activeBranch(state.turns[0]).user.content, 'a1 edited');
assert.equal(activeBranch(state.turns[0]).assistant.content, 'answer-edited');

state = deleteActiveUserVariant(state, turnId);
assert.equal(state.turns.length, 0);

const landing = normalizeState({
  turns: [{
    id: 'landing-turn',
    turn_type: 'landing',
    model_id: 'openai/gpt-4.1-nano',
    user: { active: 0, variants: [{ id: 'landing-user', content: 'hidden letter', hidden: true, input_type: 'landing_letter' }] },
    assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: { 0: [{
      id: 'landing-assistant',
      content: 'I read it.',
      model_id: 'openai/gpt-4.1-nano',
      usage: { prompt_tokens: 700, completion_tokens: 12, total_tokens: 712 },
      finish_reason: 'length',
      generation_source: 'landing',
    }] } },
  }],
});
assert.equal(landing.turns[0].turn_type, 'landing');
assert.equal(activeBranch(landing.turns[0]).user.hidden, true);
assert.equal(activeBranch(landing.turns[0]).user.input_type, 'landing_letter');
assert.equal(activeBranch(landing.turns[0]).assistant.content, 'I read it.');
assert.equal(activeBranch(landing.turns[0]).assistant.model_id, 'openai/gpt-4.1-nano');
assert.deepEqual(activeBranch(landing.turns[0]).assistant.usage, { prompt_tokens: 700, completion_tokens: 12, total_tokens: 712 });
assert.equal(activeBranch(landing.turns[0]).assistant.finish_reason, 'length');
assert.equal(activeBranch(landing.turns[0]).assistant.generation_source, 'landing');

const legacy = normalizeState({
  turns: [{
    id: 'legacy-turn',
    user: { active: 0, variants: [{ id: 'legacy-user', content: 'old' }] },
    assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: { 0: [{ id: 'legacy-assistant', content: 'old reply' }] } },
  }],
});
const legacyAssistant = activeBranch(legacy.turns[0]).assistant;
assert.equal(legacyAssistant.content, 'old reply');
assert.equal('model_id' in legacyAssistant, false, 'legacy messages must not be backfilled with model metadata');
assert.equal('usage' in legacyAssistant, false, 'legacy messages must not get estimated usage');

const incompleteUsage = normalizeState({
  turns: [{
    id: 'usage-turn',
    user: { active: 0, variants: [{ id: 'usage-user', content: 'usage' }] },
    assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: { 0: [{
      id: 'usage-assistant',
      content: 'reply',
      model_id: 'openai/gpt-5.5',
      usage: { total_tokens: 999 },
      finish_reason: 'stop',
      generation_source: 'chat',
    }] } },
  }],
});
assert.equal('usage' in activeBranch(incompleteUsage.turns[0]).assistant, false, 'partial usage must not masquerade as real token metadata');

let streaming = appendTurn(createState(), 'stream this');
const streamingTurnId = streaming.turn.id;
const appended = appendAssistantVariant(streaming.state, streamingTurnId, { content: '正在连接当前模型……' });
streaming = appended.state;
const beforeVariants = activeBranch(streaming.turns[0]).assistants.length;
streaming = updateAssistantVariant(streaming, streamingTurnId, appended.userIndex, appended.assistantIndex, {
  content: '海', model_id: 'openai/gpt-5.5', generation_source: 'chat',
});
streaming = updateAssistantVariant(streaming, streamingTurnId, appended.userIndex, appended.assistantIndex, {
  content: '海岸', usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }, finish_reason: 'stop',
});
assert.equal(activeBranch(streaming.turns[0]).assistants.length, beforeVariants, 'stream deltas must update one assistant variant');
assert.equal(activeBranch(streaming.turns[0]).assistant.content, '海岸');
assert.equal(activeBranch(streaming.turns[0]).assistant.usage.total_tokens, 12);

const longReply = '很长的自然回复。'.repeat(3000);
let longState = appendTurn(createState(), '请按自己的判断回答。');
longState = appendAssistantVariant(longState.state, longState.turn.id, { content: longReply }).state;
assert.equal(activeBranch(longState.turns[0]).assistant.content, longReply, 'long replies must not be sliced while entering client state');

console.log('chat-state: ok');
