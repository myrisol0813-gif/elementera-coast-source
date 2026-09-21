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
    if (branch.user && (branch.user.content || branch.user.attachments?.length)) messages.push({
      role: 'user',
      content: branch.user.message_source === 'official_mcp'
        ? `[来源：官端 ChatGPT / official_mcp]\n${branch.user.content || '请查看本轮附件。'}`
        : (branch.user.content || '请查看本轮附件。'),
      turn_id: turn.id,
    });
    if (turn.id === turnId) break;
    if (branch.assistant?.content) messages.push({ role: 'assistant', content: branch.assistant.content, turn_id: turn.id });
  }
  const count = Math.max(2, positiveInteger(settings.recentTurns) * 2);
  const recent = messages.slice(-count);
  while (recent[0]?.role === 'assistant') recent.shift();
  return recent;
}
