import { activeBranch, normalizeState } from '../chat-state.js';

function positiveInteger(value, fallback = 8) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.trunc(number);
}

export function contextMessages(history, turnId, settings = {}) {
  const messages = [];
  for (const turn of normalizeState(history).turns) {
    const branch = activeBranch(turn);
    if (branch.owner && (branch.owner.content || branch.owner.attachments?.length)) messages.push({
      role: 'user',
      content: branch.owner.message_source === 'official_mcp'
        ? `[来源：官端 ChatGPT / official_mcp]\n${branch.owner.content || '请查看本轮附件。'}`
        : (branch.owner.content || '请查看本轮附件。'),
      turn_id: turn.id,
    });
    if (turn.id === turnId) break;
    if (branch.modelPartner?.content) messages.push({ role: 'assistant', content: branch.modelPartner.content, turn_id: turn.id });
  }
  const count = Math.max(2, positiveInteger(settings.recentTurns) * 2);
  const recent = messages.slice(-count);
  while (recent[0]?.role === 'assistant') recent.shift();
  return recent;
}
