import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createRouter } from '../elementera-mcp/deploy-pages/public/core/router.js';
import { createDaily } from '../elementera-mcp/deploy-pages/public/features/daily.js';
import { createDesk } from '../elementera-mcp/deploy-pages/public/features/desk.js';
import { createModels } from '../elementera-mcp/deploy-pages/public/features/models.js';
import { createShell } from '../elementera-mcp/deploy-pages/public/features/shell.js';
import { createToolroom } from '../elementera-mcp/deploy-pages/public/features/toolroom.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(rootDir, path), 'utf8');

const window = new Window({ url: 'https://coast.test/' });
const { document } = window;
globalThis.window = window;
globalThis.document = document;
globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
globalThis.FormData = window.FormData;

document.head.innerHTML = '<meta name="theme-color" content="#ffffff">';
document.body.innerHTML = `
  <button id="scrim" hidden></button>
  <aside id="sidebar"><button id="chatRoomButton" data-action="chat:open-type" data-kind="radio">radio</button><button data-action="daily:home">daily</button><div id="chatConversationList"></div></aside>
  <span id="themeLabel"></span><b id="orbitDays"></b><b id="sampleMilestoneDays"></b><b id="projectDateDays"></b>
  <button id="modelButton" data-action="models:quick" aria-expanded="false"></button><span id="modelName"></span><div id="modelQuickPicker" hidden></div>
  <section id="chatWindow"></section>
  <div id="chatTopbarActions"></div>
  <div id="deskStatus" hidden></div>`;

const overlayRoot = document.createElement('div');
document.body.append(overlayRoot);

const router = createRouter(overlayRoot);
router.register('daily-home', () => ({ title: '日报', body: '<p>daily</p>' }));
router.register('outside-view', () => ({ title: '外部页', body: '<p>outside</p>' }));
const navigation = [];
const unsubscribe = router.subscribe((event) => { navigation.push(event); });
await router.open('daily-home');
await router.open('outside-view');
await router.back();
assert.deepEqual(navigation.map((event) => event.reason), ['open', 'open', 'back']);
assert.equal(navigation[1].previous.name, 'daily-home');
assert.equal(navigation[1].current.name, 'outside-view');
unsubscribe();

const shellStorageState = { preferences: { theme: 'light', userBubble: '', accent: '' } };
const shell = createShell({
  storage: {
    read: () => shellStorageState,
    update(mutator) { mutator(shellStorageState); },
  },
});
shell.mount({ router: { current: () => null } });
shell.openSidebar();
assert.equal(document.body.classList.contains('sidebar-open'), true);
const chatRoomButton = document.querySelector('#chatRoomButton');
shell.observeEvent({ type: 'click' }, {
  route: 'chat:open-type',
  namespace: 'chat',
  target: chatRoomButton,
});
assert.equal(document.body.classList.contains('sidebar-open'), false, 'Shell owns sidebar cleanup after a typed-chat action');

let profile = {
  current_chat_model: 'openai/gpt-4.1-nano',
  current_image_model: '',
  model_box: {
    chat: ['openai/gpt-4.1-nano', 'openai/gpt-5.2'],
    free: [],
    image: [],
  },
};
const profileListeners = new Set();
const modelRouterRenderers = new Map();
const modelRouter = {
  register(name, renderer) { modelRouterRenderers.set(name, renderer); },
  async open() {},
  async refresh() {},
};
const modelChat = {
  getProfile: () => profile,
  onProfile(listener) {
    profileListeners.add(listener);
    return () => profileListeners.delete(listener);
  },
  async updateProfile(patch) {
    profile = { ...profile, ...patch };
    for (const listener of profileListeners) listener(profile);
    return profile;
  },
};

globalThis.fetch = async (url) => {
  const path = String(url);
  if (path.startsWith('/api/models')) {
    return new Response(JSON.stringify({
      groups: {
        openai_chat: [
          { id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 Nano', available: true, supported_parameters: [], pricing: {} },
          { id: 'openai/gpt-5.2', name: 'GPT-5.2', available: true, supported_parameters: [], pricing: {} },
        ],
        openai_image: [],
        free_test: [],
      },
      defaults: { chat: 'openai/gpt-4.1-nano', image: '' },
      updated_at: 'test',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (path.includes('/desk/settings')) {
    return new Response(JSON.stringify({ settings: {} }), { status: 200 });
  }
  return new Response(JSON.stringify({}), { status: 200 });
};

const models = createModels({ chat: modelChat, router: modelRouter, toast() {} });
assert.equal(models.id, 'models');
assert.equal(models.priority, 80);
assert.equal(typeof models.ownsEvent, 'function');
assert.equal(typeof models.handleEvent, 'function');
assert.equal(typeof models.mount, 'function');
assert.equal(typeof models.refresh, 'function');
assert.equal(typeof models.destroy, 'function');
assert.ok(modelRouterRenderers.has('models'));
await models.mount();
const modelButton = document.querySelector('#modelButton');
await models.handleEvent({ type: 'click' }, {
  eventType: 'click',
  namespace: 'models',
  name: 'quick',
  target: modelButton,
});
assert.equal(document.querySelector('#modelQuickPicker').hidden, false, 'model picker opens through its native owner');
const secondModel = document.querySelector('[data-action="models:quick-select"][data-id="openai/gpt-5.2"]');
assert.ok(secondModel, 'second model option rendered');
await models.handleEvent({ type: 'click' }, {
  eventType: 'click',
  namespace: 'models',
  name: 'quick-select',
  target: secondModel,
});
assert.equal(profile.current_chat_model, 'openai/gpt-5.2');
assert.equal(document.querySelector('#modelQuickPicker').hidden, true, 'model selection closes the picker');
await models.handleEvent({ type: 'click' }, {
  eventType: 'click',
  namespace: 'models',
  name: 'quick',
  target: modelButton,
});
models.observeEvent({ type: 'click', target: document.body });
assert.equal(document.querySelector('#modelQuickPicker').hidden, true, 'outside click closes the picker without a document listener');
models.destroy();
assert.equal(profileListeners.size, 0, 'Models destroy releases its profile subscription');

const deskRenderers = new Map();
const deskRouter = {
  register(name, renderer) { deskRenderers.set(name, renderer); },
  async open() {},
  async refresh() {},
};
const desk = createDesk({
  chat: { getCurrentConversationId: () => 'conversation-1' },
  router: deskRouter,
  toast() {},
});
assert.equal(desk.id, 'desk');
assert.equal(desk.ownsRoute({ name: 'desk-worldbook' }), true);
assert.equal(desk.ownsRoute({ name: 'daily-home' }), false);
assert.equal(typeof desk.ownsEvent, 'function');
assert.equal(typeof desk.handleEvent, 'function');
await desk.mount();
desk.refresh();
desk.destroy();
assert.deepEqual([...deskRenderers.keys()], ['desk-slip', 'desk-worldbook', 'desk-worldbook-editor']);

let currentRoute = { name: 'outside' };
const dailyRenderers = new Map();
const ownerRouter = {
  current: () => currentRoute,
  register(name, renderer) { dailyRenderers.set(name, renderer); },
  async open(name, params = {}) { currentRoute = { name, ...params }; },
  async refresh() {},
};
const dailyStorageState = {
  preferences: { ownerAvatar: '', modelPartnerAvatar: '' },
  daily: { cache: { moments: [], diaries: [] }, momentCover: '' },
};
const daily = createDaily({
  storage: { read: () => dailyStorageState, update(mutator) { mutator(dailyStorageState); } },
  router: ownerRouter,
  toast() {},
  chat: { getProfile: () => ({ current_chat_model: '' }) },
});
assert.equal(daily.id, 'daily');
assert.equal(daily.priority, 70);
assert.equal(daily.mountOrder, 65);
assert.equal(typeof daily.ownsEvent, 'function');
assert.equal(typeof daily.handleEvent, 'function');
assert.equal(typeof daily.mount, 'function');
assert.equal(typeof daily.refresh, 'function');
assert.equal(typeof daily.destroy, 'function');
assert.equal(daily.ownsRoute({ name: 'daily-home' }), true);
assert.equal(daily.ownsRoute({ name: 'outside-view' }), false);
await daily.mount({ overlayRoot });
assert.equal(overlayRoot.dataset.controllerOwner, undefined);
currentRoute = { name: 'daily-home' };
await daily.refresh({ navigation: { current: currentRoute, previous: { name: 'outside' } } });
assert.equal(overlayRoot.dataset.controllerOwner, 'daily');
await daily.startLoad();
await daily.refresh({ navigation: { current: { name: 'outside-view' }, previous: currentRoute } });
assert.equal(overlayRoot.dataset.controllerOwner, undefined, 'Daily releases the overlay when navigation leaves Daily routes');
await daily.destroy();


const registered = new Map();
currentRoute = null;
const toolroomRouter = {
  register(name, renderer) { registered.set(name, renderer); },
  current: () => currentRoute,
  open() {},
  refresh() {},
};
const toolroom = createToolroom({
  chat: { getCurrentConversationId: () => 'conversation-1' },
  router: toolroomRouter,
});
assert.ok(registered.has('toolroom'));
await toolroom.mount({ overlayRoot });
currentRoute = { name: 'toolroom' };
await toolroom.refresh({ navigation: { current: currentRoute } });
assert.equal(toolroom.ownsRoute(currentRoute), true);
assert.equal(overlayRoot.dataset.controllerOwner, 'toolroom');
await toolroom.destroy();
assert.equal(overlayRoot.dataset.controllerOwner, undefined);

const app = await read('elementera-mcp/deploy-pages/public/app.js');
const spine = await read('elementera-mcp/deploy-pages/public/core/event-spine.js');
const routerSource = await read('elementera-mcp/deploy-pages/public/core/router.js');
const shellSource = await read('elementera-mcp/deploy-pages/public/features/shell.js');
const chatSource = await read('elementera-mcp/deploy-pages/public/features/chat.js');
const modelsSource = await read('elementera-mcp/deploy-pages/public/features/models.js');
const deskSource = await read('elementera-mcp/deploy-pages/public/features/desk.js');
const dailySource = await read('elementera-mcp/deploy-pages/public/features/daily.js');
const toolroomSource = await read('elementera-mcp/deploy-pages/public/features/toolroom.js');
const memorySource = await read('elementera-mcp/deploy-pages/public/features/memory.js');
const dogtalkSource = await read('elementera-mcp/deploy-pages/public/features/dogtalk.js');
const toolsSource = await read('elementera-mcp/deploy-pages/public/features/tools.js');
const lettersSource = await read('elementera-mcp/deploy-pages/public/features/letters.js');
const mailbox = await read('elementera-mcp/deploy-pages/public/mailbox.js');
const danger = await read('elementera-mcp/deploy-pages/public/core/danger.js');
const serviceWorker = await read('elementera-mcp/deploy-pages/service-worker.js');

assert.equal(/\.start\s*\(/.test(app), false, 'bootstrap cannot directly start feature controllers');
assert.equal(app.includes('afterHandle'), false, 'app bootstrap cannot contain feature post-dispatch cleanup');
assert.equal(spine.includes('afterHandle'), false, 'Event Spine cannot provide a feature cleanup hook');
assert.equal(spine.includes('useLegacyStart'), false, 'Event Spine cannot provide a legacy start escape hatch');
assert.match(app, /\n  chat,\n/);
assert.match(app, /\n  models,\n/);
assert.equal(app.includes('createRooms'), false, 'retired rooms controller is not registered');
assert.match(app, /\n  desk,\n/);
assert.match(app, /\n  daily,\n/);
assert.match(app, /\n  shell,\n/);
assert.match(app, /\n  memory,\n/);
assert.match(app, /\n  dogtalk,\n/);
assert.match(app, /\n  tools,\n/);
assert.match(app, /\n  toolroom,\n/);
assert.match(app, /\n  letters,\n/);
assert.equal(/querySelector(?:All)?\s*\(|classList\.|setAttribute\s*\(|removeAttribute\s*\(/.test(app), false, 'app bootstrap cannot sweep or polish feature DOM');
assert.match(app, /await eventSpine\.mount\(\{ router, shell, overlayRoot \}\)/);

assert.match(spine, /event_spine_lifecycle_contract_invalid/);
assert.match(spine, /refreshForNavigation/);
assert.match(spine, /owner\.ownsRoute/);
assert.match(spine, /await owner\.destroy/);
for (const forbiddenFeature of ['daily', 'chat', 'models', 'desk']) {
  assert.equal(spine.includes(`'${forbiddenFeature}'`), false, `Event Spine contains feature-specific name: ${forbiddenFeature}`);
}
for (const forbiddenFeature of ['daily', 'chat', 'models', 'desk']) {
  assert.equal(new RegExp(`\\b${forbiddenFeature}\\b`, 'i').test(routerSource), false, `Router knows feature name: ${forbiddenFeature}`);
}

for (const [name, source] of [
  ['chat', chatSource],
  ['models', modelsSource],
  ['desk', deskSource],
  ['daily', dailySource],
  ['shell', shellSource],
  ['memory', memorySource],
  ['dogtalk', dogtalkSource],
  ['tools', toolsSource],
  ['toolroom', toolroomSource],
  ['letters', lettersSource],
]) {
  assert.match(source, new RegExp(`id:\\s*'${name}'`), `${name} is not a direct owner`);
  assert.match(source, /\bownsEvent\s*[,\(]/, `${name} misses ownsEvent`);
  assert.match(source, /\bhandleEvent\s*[,\(]/, `${name} misses handleEvent`);
  assert.match(source, /\bmount\s*[,\(]/, `${name} misses mount`);
  assert.match(source, /\brefresh\s*[,\(]/, `${name} misses refresh`);
  assert.match(source, /\bdestroy\s*[,\(]/, `${name} misses destroy`);
  assert.equal(/\bfunction\s+start\s*\(/.test(source), false, `${name} still exposes legacy start`);
}
assert.equal(modelsSource.includes('document.addEventListener'), false);
assert.equal(modelsSource.includes('handleDocumentClick'), false);
assert.match(deskSource, /function ownsRoute/);

assert.match(shellSource, /refreshOnNavigation:\s*true/);
assert.match(dailySource, /function ownsRoute/);
assert.match(toolroomSource, /function ownsRoute/);

assert.equal(chatSource.includes('TODO(chat-owner)'), false, 'Chat owner cleanup is a permanent contract, not a TODO');
assert.equal(chatSource.includes('TODO(event-spine)'), false, 'Chat has no Event Spine TODO');
assert.equal(danger.includes('TODO(event-spine)'), false, 'Danger modal exception is permanent and documented without TODO debt');
assert.match(danger, /addEventListener\('popstate', onPopState\)/);
assert.match(danger, /removeEventListener\?\.\('popstate', onPopState\)/);

assert.equal(mailbox.includes('document.addEventListener'), false, 'mailbox delegation must stay local');
assert.match(mailbox, /q\('#mailboxApp'\)\?\.addEventListener\('click'/);
assert.match(serviceWorker, /const CACHE_NAME = 'elementera-coast-source-app-[0-9]+';/);

console.log('controller-lifecycle: ok');
