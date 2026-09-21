import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createEventSpine } from '../elementera-mcp/deploy-pages/public/core/event-spine.js';
import { createChat } from '../elementera-mcp/deploy-pages/public/features/chat.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(rootDir, path), 'utf8');
const window = new Window({ url: 'https://coast.test/' });
const { document } = window;
globalThis.window = window;
globalThis.document = document;
globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };

document.body.innerHTML = `
  <div id="chatConversationList"></div>
  <section id="chatWindow">
    <section id="messageScroller"><div id="messages"></div></section>
    <div id="chatStatus" hidden></div>
    <span id="modelName"></span>
    <form id="composer" data-submit="chat:composer">
      <div id="mainDogtalkComposer"></div>
      <textarea id="promptInput" data-input="chat:composer"></textarea>
      <button id="micButton" type="button" data-action="chat:mic"></button>
      <button id="composerActionButton" type="submit" data-action="chat:composer-primary"></button>
    </form>
  </section>`;

const storageState = {
  runControl: { streamingEnabled: false, outputLength: 'normal', creativity: 'balanced', recentTurns: 8, seedCooldownTurns: 2 },
};
let currentConversation = '';
let migrationCompleted = false;
const storage = {
  read: () => storageState,
  migrationPending: false,
  migrationProfile: null,
  migrationConversations: [],
  getCurrentConversation: () => currentConversation,
  setCurrentConversation(value) { currentConversation = value; },
  completeMigration() { migrationCompleted = true; },
};

const dogtalk = {
  mountComposer() {},
  submission() { return null; },
};

const fetchCalls = [];
let blockNextChat = false;
let blockedSignal = null;
globalThis.fetch = async (url, options = {}) => {
  const path = String(url);
  fetchCalls.push({ path, method: options.method || 'GET', body: options.body || '', signal: options.signal || null });

  if (path === '/api/chat/profile') {
    return new Response(JSON.stringify({
      profile: {
        assistant_avatar_dataurl: '',
        current_chat_model: 'openai/gpt-4.1-nano',
        current_image_model: '',
        model_box: { chat: ['openai/gpt-4.1-nano'], free: [], image: [] },
      },
    }), { status: 200 });
  }
  if (path === '/api/chat/conversations' && (options.method || 'GET') === 'GET') {
    return new Response(JSON.stringify({
      conversations: [{ id: 'conversation-1', title: 'Test conversation', title_manual: true }],
    }), { status: 200 });
  }
  if (path.startsWith('/api/chat/history?')) {
    if ((options.method || 'GET') === 'PUT') return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ history: { turns: [] } }), { status: 200 });
  }
  if (path === '/api/chat' && options.method === 'POST') {
    if (blockNextChat) {
      blockNextChat = false;
      blockedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    return new Response(JSON.stringify({
      message: { content: 'assistant reply' },
      model: 'openai/gpt-4.1-nano',
      finish_reason: 'stop',
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      memory: { selected_entry_ids: [] },
    }), { status: 200 });
  }
  if (path === '/api/chat/title' && options.method === 'POST') {
    return new Response(JSON.stringify({ conversation: { id: 'conversation-1', title: 'Test conversation', title_manual: true } }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

const toastMessages = [];
const chat = createChat({ storage, dogtalk, toast(message) { toastMessages.push(message); } });
assert.equal(chat.id, 'chat');
assert.equal(chat.priority, 80);
assert.equal(chat.mountOrder, 70);
for (const method of ['mount', 'refresh', 'destroy', 'ownsEvent', 'handleEvent']) {
  assert.equal(typeof chat[method], 'function', `Chat native owner misses ${method}`);
}

const spine = createEventSpine({ root: document, owners: [chat] });
await spine.mount();
assert.equal(currentConversation, 'conversation-1');
assert.equal(migrationCompleted, true);

function syntheticEvent(type, target) {
  return {
    type,
    target,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
  };
}

const input = document.querySelector('#promptInput');
const composer = document.querySelector('#composer');
input.value = 'hello owner';
await spine.dispatch(syntheticEvent('input', input));
const submitEvent = syntheticEvent('submit', composer);
const submitOutcome = await spine.dispatch(submitEvent);
assert.equal(submitOutcome.ownerId, 'chat');
assert.equal(submitEvent.defaultPrevented, true);
const chatPost = fetchCalls.find((call) => call.path === '/api/chat' && call.method === 'POST');
assert.ok(chatPost, 'composer submit still reaches the original chat request path');
const chatPayload = JSON.parse(chatPost.body);
assert.equal(chatPayload.conversation_id, 'conversation-1');
assert.equal(chatPayload.model, 'openai/gpt-4.1-nano');
assert.equal(chatPayload.messages.at(-1)?.content, 'hello owner');
assert.equal(chat.getActiveMessages().at(-1)?.content, 'assistant reply');

const menuButton = document.querySelector('[data-action="chat:menu"]');
assert.ok(menuButton, 'conversation menu button rendered');
await spine.dispatch(syntheticEvent('click', menuButton));
const menu = document.querySelector('[data-conversation-menu]');
assert.equal(menu.hidden, false, 'message/conversation action menu opens through Chat owner');
await spine.dispatch(syntheticEvent('click', document.body));
assert.equal(menu.hidden, true, 'outside click closes the Chat menu through owner observation');

await spine.dispatch(syntheticEvent('click', menuButton));
assert.equal(menu.hidden, false);
const conversationBeforeRefresh = chat.getCurrentConversationId();
await chat.refresh({ navigation: { reason: 'open', current: { name: 'models' }, previous: null } });
assert.equal(menu.hidden, true, 'navigation refresh clears temporary Chat menu state');
assert.equal(chat.getCurrentConversationId(), conversationBeforeRefresh, 'navigation refresh must not discard conversation state');

input.value = 'please stop';
blockNextChat = true;
const pendingGeneration = spine.dispatch(syntheticEvent('submit', composer));
for (let attempt = 0; attempt < 20 && !blockedSignal; attempt += 1) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}
assert.ok(blockedSignal, 'generation reached the original request path before stop');
const primaryButton = document.querySelector('#composerActionButton');
const stopOutcome = await spine.dispatch(syntheticEvent('click', primaryButton));
assert.equal(stopOutcome.ownerId, 'chat');
assert.equal(blockedSignal.aborted, true, 'Chat primary button keeps the original stop/abort behavior');
await pendingGeneration;

await spine.unmount();

const chatSource = await read('elementera-mcp/deploy-pages/public/features/chat.js');
const chatModuleDir = resolve(rootDir, 'elementera-mcp/deploy-pages/public/features/chat');
const chatModuleFiles = (await readdir(chatModuleDir)).filter((file) => file.endsWith('.js')).sort();
const chatModuleSources = await Promise.all(chatModuleFiles.map((file) => read(`elementera-mcp/deploy-pages/public/features/chat/${file}`)));
const chatOwnerSource = [chatSource, ...chatModuleSources].join('\n');
assert.equal(chatOwnerSource.includes('document.addEventListener'), false, 'Chat owner cluster cannot add global document listeners');
assert.equal(chatOwnerSource.includes('window.addEventListener'), false, 'Chat owner cluster cannot add global window listeners');
assert.equal(chatOwnerSource.includes("ui.messages.addEventListener('touchstart'"), false, 'manual long-press pocket gesture is retired');
assert.equal(chatOwnerSource.includes("ui.messages.addEventListener('contextmenu'"), false, 'manual context-menu pocket gesture is retired');
assert.equal(chatOwnerSource.includes('getPocketSource'), false, 'raw message pocket source helper is retired');
assert.equal(chatOwnerSource.includes('TODO(chat-owner)'), false, 'Chat owner contract has no retired long-press debt');
assert.equal(chatOwnerSource.includes('TODO(event-spine)'), false, 'Chat no longer needs a long-press Event Spine exception');
assert.equal(chatOwnerSource.includes('dogtalk?.mount('), false, 'Chat cannot call the retired Dogtalk domain mount name');
assert.match(chatOwnerSource, /dogtalk\?\.mountComposer\(/);

console.log('chat-owner: ok');
