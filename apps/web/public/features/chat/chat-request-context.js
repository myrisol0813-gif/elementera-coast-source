import { replyTokenBudget } from './chat-profile.js';

export const RUN_SETTING_KEYS = Object.freeze([
  'recentTurns',
  'contextBudget',
  'outputLength',
  'maxOutputTokens',
  'creativity',
  'streamingEnabled',
  'soilBudget',
  'seedCooldownTurns',
  'worldbookEnabled',
  'worldbookLimit',
  'memoryLimit',
]);

export function pickRunSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(RUN_SETTING_KEYS
    .filter((key) => source[key] !== undefined)
    .map((key) => [key, source[key]]));
}

export function chatRequestContext(runSettings, recallHistory, conversationId) {
  const current = pickRunSettings(runSettings() || {});
  const maxTokens = replyTokenBudget(current.outputLength);
  const temperature = ['stable','precise'].includes(current.creativity) ? 0.3 : current.creativity === 'expansive' ? 1 : 0.7;
  const cooldown = Math.min(8, Math.max(0, Number(current.seedCooldownTurns ?? 2)));
  return {
    settings: { ...current, max_tokens: maxTokens, temperature },
    recentEntryIds: cooldown
      ? (recallHistory.get(conversationId) || []).slice(-cooldown).flat()
      : [],
  };
}
