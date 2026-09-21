import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createEventSpine } from '../elementera-mcp/deploy-pages/public/core/event-spine.js';
import { createChat } from '../elementera-mcp/deploy-pages/public/features/chat.js';
import { createShell } from '../elementera-mcp/deploy-pages/public/features/shell.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(rootDir, path), 'utf8');
const window = new Window({ url: 'https://coast.test/' });
const { document } = window;
globalThis.window = window;
globalThis.document = document;
globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
globalThis.prompt = () => 'Renamed conversation';
Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });

let viewportResize = null;
Object.defineProperty(window, 'visualViewport', {
  configurable: true,
  value: {
    height: 640,
    addEventListener(type, listener) { if (type === 'resize') viewportResize = listener; },
    removeEventListener(type, listener) { if (type === 'resize' && viewportResize === listener) viewportResize = null; },
  },
});

document.body.innerHTML = `
  <div id="app" class="app-shell">
    <button id="scrim" type="button" hidden></button>
    <aside id="sidebar"><div id="chatConversationList"></div></aside>
    <span id="themeLabel"></span><span id="orbitDays"></span><span id="sampleMilestoneDays"></span><span id="projectDateDays"></span>
    <section id="chatWindow">
      <section id="messageScroller"><div id="messages"></div></section>
      <div id="chatStatus" hidden></div>
      <span id="modelName"></span>
      <div id="mainDogtalkComposer" class="dogtalk-composer-slot dogtalk-composer-slot--chat-shell">
        <div class="dogtalk-composer-placeholder">loading</div>
      </div>
      <form id="composer" data-submit="chat:composer" aria-busy="true">
        <div id="composerAttachmentTray" hidden></div>
        <div class="composer-attachment-anchor">
          <button id="attachmentButton" type="button" data-action="chat:attachments-menu" aria-expanded="false" disabled></button>
          <div id="attachmentMenu" hidden>
            <button type="button" data-action="chat:attachment-image">图片</button>
            <button type="button" data-action="chat:attachment-file">文件</button>
          </div>
          <input id="attachmentImageInput" type="file" data-change="chat:attachment-image-input" hidden>
          <input id="attachmentFileInput" type="file" data-change="chat:attachment-file-input" hidden>
        </div>
        <textarea id="promptInput" data-input="chat:composer" disabled></textarea>
        <button id="micButton" type="button" data-action="chat:mic" disabled></button>
        <button id="composerActionButton" type="submit" data-action="chat:composer-primary" disabled></button>
      </form>
    </section>
  </div>`;

const state = {
  preferences: { theme: 'light', userBubble: '', accent: '' },
  runControl: { streamingEnabled: false, outputLength: 'normal', creativity: 'balanced', recentTurns: 8, seedCooldownTurns: 2 },
};
let currentConversation = '';
const storage = {
  read: () => state,
  update(mutator) { mutator(state); },
  migrationPending: false,
  migrationProfile: null,
  migrationConversations: [],
  getCurrentConversation: () => currentConversation,
  setCurrentConversation(value) { currentConversation = value; },
  completeMigration() {},
};
const dogtalk = { mountComposer() {}, submission() { return null; } };

let releaseProfile;
let profileRequested = false;
const profileGate = new Promise((resolvePromise) => { releaseProfile = resolvePromise; });
const fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const path = String(url);
  const method = options.method || 'GET';
  fetchCalls.push({ path, method, body: options.body || '' });
  if (path === '/api/chat/profile') {
    profileRequested = true;
    await profileGate;
    return new Response(JSON.stringify({ profile: {
      assistant_avatar_dataurl: '',
      current_chat_model: 'openai/gpt-4.1-nano',
      current_image_model: '',
      model_box: { chat: ['openai/gpt-4.1-nano'], free: [], image: [] },
    } }), { status: 200 });
  }
  if (path === '/api/chat/conversations' && method === 'GET') {
    return new Response(JSON.stringify({ conversations: [
      { id: 'conversation-1', title: 'First', title_manual: true },
      { id: 'conversation-2', title: 'Second', title_manual: true },
    ] }), { status: 200 });
  }
  if (path.startsWith('/api/chat/history?')) {
    return new Response(JSON.stringify({ history: { turns: [] } }), { status: 200 });
  }
  if (path === '/api/chat/conversations/conversation-1' && method === 'PATCH') {
    return new Response(JSON.stringify({ conversation: { id: 'conversation-1', title: 'Renamed conversation', title_manual: true } }), { status: 200 });
  }
  if (path.startsWith('/api/chat/conversations/') && method === 'DELETE') {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

const shell = createShell({ storage });
const chat = createChat({ storage, dogtalk, toast() {} });
const spine = createEventSpine({ root: document, owners: [shell, chat] });

const mountPromise = spine.mount();
for (let attempt = 0; attempt < 20 && !profileRequested; attempt += 1) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}
assert.equal(profileRequested, true, 'slow bootstrap reached profile request');
const composer = document.querySelector('#composer');
const input = document.querySelector('#promptInput');
assert.ok(composer, 'composer shell exists during cold start');
assert.equal(composer.hidden, false, 'composer shell is never removed while data loads');
assert.equal(composer.getAttribute('aria-busy'), 'true', 'composer advertises loading instead of disappearing');
assert.equal(input.disabled, true, 'slow bootstrap keeps the visible composer disabled');
assert.equal(document.documentElement.style.getPropertyValue('--app-viewport-height'), '640px', 'shell owns the current visual viewport height');
assert.ok(viewportResize, 'shell listens for visual viewport resize');

releaseProfile();
await mountPromise;
assert.equal(composer.getAttribute('aria-busy'), 'false');
assert.equal(input.disabled, false, 'composer transitions from disabled to enabled after chat data is ready');
const attachmentButton = document.querySelector('#attachmentButton');
const attachmentMenu = document.querySelector('#attachmentMenu');
assert.equal(attachmentButton.disabled, false, 'unified plus attachment entrance becomes available with the composer');
await spine.dispatch(event('click', attachmentButton));
assert.equal(attachmentMenu.hidden, false, 'plus opens one lightweight attachment menu');
assert.ok(attachmentMenu.querySelector('[data-action="chat:attachment-image"]'));
assert.ok(attachmentMenu.querySelector('[data-action="chat:attachment-file"]'));
await spine.dispatch(event('click', document.body));
assert.equal(attachmentMenu.hidden, true, 'outside click closes the attachment menu');

function event(type, target) {
  return {
    type,
    target,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
  };
}

shell.openSidebar();
const firstMenuButton = document.querySelector('[data-conversation-id="conversation-1"] [data-action="chat:menu"]');
const beforeMenuConversation = chat.getCurrentConversationId();
await spine.dispatch(event('click', firstMenuButton));
assert.equal(document.body.classList.contains('sidebar-open'), true, 'kebab does not close the mobile drawer');
assert.equal(chat.getCurrentConversationId(), beforeMenuConversation, 'kebab does not select/switch the conversation row');
let menu = document.querySelector('[data-conversation-id="conversation-1"] [data-conversation-menu]');
assert.equal(menu.hidden, false, 'kebab opens rename/delete menu');
assert.ok(menu.querySelector('[data-action="chat:rename"]'));
assert.ok(menu.querySelector('[data-action="chat:delete-conversation"]'));

await spine.dispatch(event('click', menu.querySelector('[data-action="chat:rename"]')));
assert.equal(document.body.classList.contains('sidebar-open'), true, 'rename is owned locally instead of being pre-closed by Shell');
assert.ok(fetchCalls.some((call) => call.path === '/api/chat/conversations/conversation-1' && call.method === 'PATCH'));
assert.match(document.querySelector('[data-conversation-id="conversation-1"]').textContent, /Renamed conversation/);

shell.openSidebar();
await spine.dispatch(event('click', document.querySelector('[data-conversation-id="conversation-1"] [data-action="chat:menu"]')));
menu = document.querySelector('[data-conversation-id="conversation-1"] [data-conversation-menu]');
assert.equal(menu.hidden, false);
await spine.dispatch(event('click', document.body));
assert.equal(menu.hidden, true, 'outside click closes the menu');

shell.openSidebar();
const secondTitle = document.querySelector('[data-conversation-id="conversation-2"] [data-action="chat:open"]');
await spine.dispatch(event('click', secondTitle));
assert.equal(chat.getCurrentConversationId(), 'conversation-2', 'conversation title still switches chat');
assert.equal(document.body.classList.contains('sidebar-open'), false, 'conversation navigation still closes mobile drawer');

shell.openSidebar();
await spine.dispatch(event('click', document.querySelector('[data-conversation-id="conversation-1"] [data-action="chat:menu"]')));
menu = document.querySelector('[data-conversation-id="conversation-1"] [data-conversation-menu]');
await spine.dispatch(event('click', menu.querySelector('[data-action="chat:delete-conversation"]')));
assert.ok(fetchCalls.some((call) => call.path === '/api/chat/conversations/conversation-1' && call.method === 'DELETE'));
assert.equal(document.querySelector('[data-conversation-id="conversation-1"]'), null, 'delete flow removes the requested row');

const indexSource = await read('elementera-mcp/deploy-pages/index.html');
const dogtalkIndex = indexSource.indexOf('id="mainDogtalkComposer"');
const composerIndex = indexSource.indexOf('<form id="composer"');
assert.ok(dogtalkIndex >= 0 && composerIndex > dogtalkIndex, 'Dogtalk occupies its own row above the persistent composer shell');
assert.match(indexSource, /id="promptInput"[^>]*disabled/);
assert.match(indexSource, /id="attachmentButton"[^>]*data-action="chat:attachments-menu"/);
assert.match(indexSource, /data-action="chat:attachment-image"/);
assert.match(indexSource, /data-action="chat:attachment-file"/);
assert.doesNotMatch(indexSource, /data-action="chat:image"/);
assert.match(indexSource, /interactive-widget=resizes-content/);
const shellCssSource = await read('elementera-mcp/deploy-pages/public/styles/shell.css');
assert.match(shellCssSource, /height:\s*var\(--app-viewport-height, 100svh\)/);
assert.match(shellCssSource, /#chatWindow\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto auto auto auto;/s);
const chatCssSource = await read('elementera-mcp/deploy-pages/public/styles/chat.css');
assert.match(chatCssSource, /@media \(max-width: 979px\)[\s\S]*?\.conversation-menu[\s\S]*?position:\s*static/);

await spine.unmount();
assert.equal(viewportResize, null, 'Shell removes visualViewport listener when unmounted');
assert.equal(document.documentElement.style.getPropertyValue('--app-viewport-height'), '');

console.log('pwa-chat-menu-composer: ok');
