import { q } from './core/dom.js';
import { hydrateIconSlots } from './core/icons.js';
import { createEventSpine } from './core/event-spine.js';
import { createRouter } from './core/router.js';
import { createStorage } from './core/storage.js';
import { createChat } from './features/chat.js';
import { createDesk } from './features/desk.js';
import { createHumanThought } from './features/human-thought.js';
import { createMemory } from './features/memory.js';
import { createShell } from './features/shell.js';
import { createSourcePages } from './features/source-pages.js';
import { createToolroom } from './features/toolroom.js';
import { createDevHands } from './features/dev-hands.js';
import { createExternalEntry } from './features/external-entry.js';

const storage = createStorage();
let toastTimer = 0;
function toast(message, duration = 1800) {
  const root = q('#toastRoot');
  if (!root) return;
  root.textContent = String(message || '');
  root.hidden = !message;
  clearTimeout(toastTimer);
  if (message) toastTimer = setTimeout(() => { root.hidden = true; }, duration);
}
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch((error) => {
    console.warn('[service-worker]', error);
    return null;
  });
}
const overlayRoot = q('#overlayRoot');
const shell = createShell({ storage });
const router = createRouter(overlayRoot);
const sourcePages = createSourcePages({ router, storage, shell, toast });
const toolroom = createToolroom({ router, chat });
const devHands = createDevHands({ router, toast });
const externalEntry = createExternalEntry({ router, toast });
const humanThought = createHumanThought({ toast });
const chat = createChat({ storage, toast, humanThought });
const memory = createMemory({ chat, router, toast, storage });
const desk = createDesk({ chat, router, toast });
chat.setMemoryController(memory);
chat.setDeskController(desk);
const routerOwner = Object.freeze({
  id: 'router', priority: 100, mountOrder: 110,
  ownsEvent(_event, context) {
    return context.eventType === 'click' && context.route === 'router:back'
      ? { preventDefault: true } : false;
  },
  handleEvent() { return router.back(); },
  mount() {}, refresh() {}, destroy() {},
});
const eventSpine = createEventSpine({
  owners: Object.freeze([routerOwner, shell, chat, memory, desk, devHands, toolroom, externalEntry, sourcePages, humanThought]),
  onError(error, context) {
    console.error(`[${context.route || context.eventType || 'event-spine'}]`, error);
    toast(error?.message || '操作失败，请稍后重试。');
  },
});
async function boot() {
  hydrateIconSlots();
  await eventSpine.mount({ router, shell, overlayRoot });
  registerServiceWorker();
}
boot().catch((error) => {
  console.error('[bootstrap]', error);
  toast('应用载入失败，请刷新重试。');
});
