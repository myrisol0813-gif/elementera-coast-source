import { activeBranch, normalizeState } from '../chat-state.js';
import { selectedReplyGroup } from './chat-reply-sequence.js';

function positiveInteger(value, fallback = 8) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.trunc(number);
}

export function contextMessages(history, turnId, settings = {}) {
  const rounds = [];
  let grouped = false;
  for (const turn of normalizeState(history).turns) {
    const messages = [];
    const branch = activeBranch(turn);
    if (branch.user && (branch.user.content || branch.user.attachments?.length)) messages.push({
      role: 'user',
      content: branch.user.message_source === 'official_mcp'
        ? `[来源：官端 ChatGPT / official_mcp]\n${branch.user.content || '请查看本轮附件。'}`
        : (branch.user.content || '请查看本轮附件。'),
      turn_id: turn.id,
    });
    if (turn.id !== turnId) {
      const group = selectedReplyGroup(branch.assistants, branch.assistantIndex);
      if (group.length > 1) grouped = true;
      for (const assistant of group) {
        if (assistant.content) messages.push({ role: 'assistant', content: assistant.content, turn_id: turn.id });
      }
    }
    rounds.push(messages);
    if (turn.id === turnId) break;
  }
  const turns = positiveInteger(settings.recentTurns);
  // Once a real multi-message group exists, count complete interaction rounds,
  // not individual bubbles. Preserve legacy selection for ordinary histories.
  const recent = grouped ? rounds.slice(-turns).flat() : rounds.flat().slice(-Math.max(2, turns * 2));
  while (recent[0]?.role === 'assistant') recent.shift();
  return recent;
}
