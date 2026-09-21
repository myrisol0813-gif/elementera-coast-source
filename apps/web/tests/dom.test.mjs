import { bootstrapDomHarness } from './dom/dom-harness.mjs';
import { runChatPrelude, runChatTypedRooms } from './dom/dom-chat-flow.test.mjs';
import { runMemoryFlow } from './dom/dom-memory-flow.test.mjs';
import { runDeskFlow } from './dom/dom-desk-flow.test.mjs';
import { runDailyFlow } from './dom/dom-daily-flow.test.mjs';

await bootstrapDomHarness();
await runChatPrelude();
await runMemoryFlow();
await runDeskFlow();
await runDailyFlow();
await runChatTypedRooms();

console.log('dom: ok');
