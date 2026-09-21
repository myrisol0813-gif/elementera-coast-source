import { q } from './core/dom.js';
import { confirmDanger, dangerConfirmationFor } from './core/danger.js';
import { hydrateIconSlots } from './core/icons.js';
import { createActionEventOwner, createEventSpine } from './core/event-spine.js';
import { createRouter } from './core/router.js';
import { createStorage } from './core/storage.js';
import { createChat } from './features/chat.js';
import { createDaily } from './features/daily.js';
import { createDevHands } from './features/dev-hands.js';
import { createDogtalk } from './features/dogtalk.js';
import { createLetters } from './features/letters.js';
import { createMemory } from './features/memory.js';
import { createModels } from './features/models.js';
import { createSettings } from './features/settings.js';
import { createShell } from './features/shell.js';
import { createTools } from './features/tools.js';
import { createDesk } from './features/desk.js';
import { createToolroom } from './features/toolroom.js';

const storage = createStorage();
let toastTimer = 0;
let serviceWorkerReloading = false;

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
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (serviceWorkerReloading) return;
    serviceWorkerReloading = true;
    globalThis.location.reload();
  });
  return navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then(async (registration) => {
    await registration.update().catch((error) => console.warn('[service-worker:update]', error));
    return registration;
  }).catch((error) => {
    console.warn('[service-worker]', error);
    return null;
  });
}

const overlayRoot = q('#overlayRoot');
const shell = createShell({ storage });
const router = createRouter(overlayRoot);
const dogtalk = createDogtalk({ toast });
const chat = createChat({ storage, toast, dogtalk });
const memory = createMemory({ chat, router, toast, storage });
const models = createModels({ chat, router, toast });
const tools = createTools({ storage, router, toast, memory });
const settings = createSettings({ storage, shell, chat, router, toast });
const daily = createDaily({ storage, router, toast, chat });
const letters = createLetters({ storage, chat, models, router, toast });
const desk = createDesk({ chat, router, toast });
const toolroom = createToolroom({ chat, router });
const devHands = createDevHands({ router, toast, chat });

chat.setRunSettingsProvider(tools.getSettings);
chat.setMemoryController(memory);
chat.setDeskController(desk);

const eventOwners = Object.freeze([
  Object.freeze({
    id: 'router',
    priority: 100,
    mountOrder: 110,
    ownsEvent(_event, context) {
      return context.eventType === 'click' && context.route === 'router:back'
        ? { preventDefault: true }
        : false;
    },
    handleEvent() {
      return router.back();
    },
    mount() {},
    refresh() {},
    destroy() {},
  }),
  shell,
  chat,
  models,
  daily,
  memory,
  desk,
  createActionEventOwner({ id: 'settings', priority: 60, controller: settings }),
  devHands,
  dogtalk,
  tools,
  toolroom,
  letters,
]);

const eventSpine = createEventSpine({
  owners: eventOwners,
  beforeHandle(_event, context) {
    if (context.eventType !== 'click') return true;
    const danger = dangerConfirmationFor(context.route);
    return !danger || confirmDanger(danger);
  },
  onError(error, context) {
    console.error(`[${context.route || context.eventType || 'event-spine'}]`, error);
    toast(error?.message || '操作失败，请稍后重试。');
  },
});

async function boot() {
  const serviceWorkerReady = registerServiceWorker();
  hydrateIconSlots();
  await eventSpine.mount({ router, shell, overlayRoot });
  await serviceWorkerReady;
}

boot().catch((error) => {
  console.error('[bootstrap]', error);
  toast('海岸载入失败，请刷新重试。');
});
