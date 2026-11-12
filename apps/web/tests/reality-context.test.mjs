import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { createConversation, normalizeState as normalizeServerState, writeConversationState } from '../functions/chat-store.js';
import { assembleCleanContext } from '../functions/context-assemble-clean.js';
import { createCalendarEntry } from '../functions/calendar-store.js';
import { normalizeState as normalizeClientState } from '../elementera-mcp/deploy-pages/public/features/chat-state.js';

const db = new D1Database();
const env = { COAST_CHAT_DB: db, COAST_SESSION_SECRET: 'source-reality-context-test-'.repeat(4) };
const conversation = await createConversation(db, 'Reality Context test');

const settings = {
  reality_enabled: true,
  reality_fields: ['date', 'time', 'battery', 'calendar', 'steps', 'app_usage'],
  short_reply_mode: true,
  weather_city: 'Taiyuan',
};
assert.deepEqual(normalizeServerState({ context_settings: settings, turns: [] }).context_settings, settings);
assert.deepEqual(normalizeClientState({ context_settings: settings, turns: [] }).context_settings, settings);

await writeConversationState(db, conversation.id, { context_settings: settings, turns: [] });
await createCalendarEntry(db, {
  day: '2026-11-16',
  title: 'Source test event',
  body: '',
  kind: 'event',
  recurrence: 'none',
}, { author: 'owner' });

const messages = [{ role: 'user', content: 'check context boundaries' }];
const assembled = await assembleCleanContext(env, {
  surface: 'main_chat',
  conversationId: conversation.id,
  messages,
  lastUser: messages[0],
  localDate: '2026-11-13',
  localDateTime: '2026-11-13 02:30',
  realityContext: {
    timezone: 'Asia/Shanghai',
    battery: { percent: 61, charging: false },
    steps: { count: 123, basis: '自本日首次读取后' },
    recent_app: { name: 'UNSELECTED_APP_MUST_NOT_LEAK' },
  },
  settings: { recentTurns: 8, contextBudget: 6000 },
  permission: 'owner',
  preview: true,
});

const system = assembled.modelMessages[0]?.content || '';
assert.match(system, /2026-11-13/);
assert.match(system, /02:30/);
assert.match(system, /Asia\/Shanghai/);
assert.match(system, /61%/);
assert.match(system, /123 步/);
assert.match(system, /Source test event/);
assert.match(system, /当前对话开启了短句模式/);
assert.doesNotMatch(system, /UNSELECTED_APP_MUST_NOT_LEAK/);

const slip = assembled.deskSlip();
assert.equal(slip.reality_context.enabled, true);
assert.equal(slip.reality_context.delivered, true);
assert.ok(slip.reality_context.missing.includes('今日 App 使用时间'));
assert.equal(slip.response_mode.short_reply_mode, true);
assert.equal(slip.response_mode.delivered, true);
assert.ok(slip.context_budget.sources_preserved.includes('现实上下文'));
assert.ok(slip.context_budget.sources_preserved.includes('短句模式'));

await writeConversationState(db, conversation.id, {
  context_settings: { ...settings, reality_enabled: false },
  turns: [],
});
const shortOnly = await assembleCleanContext(env, {
  surface: 'main_chat',
  conversationId: conversation.id,
  messages,
  lastUser: messages[0],
  localDate: '2026-11-13',
  localDateTime: '2026-11-13 02:30',
  realityContext: { battery: { percent: 99, charging: false } },
  settings: { recentTurns: 8, contextBudget: 6000 },
  permission: 'owner',
  preview: true,
});
const shortSystem = shortOnly.modelMessages[0]?.content || '';
assert.doesNotMatch(shortSystem, /99%/);
assert.match(shortSystem, /当前对话开启了短句模式/);
assert.equal(shortOnly.deskSlip().reality_context.enabled, false);
assert.equal(shortOnly.deskSlip().response_mode.delivered, true);

console.log('source-reality-context: ok');
