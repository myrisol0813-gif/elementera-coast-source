import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

function installWindow(window) {
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.FormData = window.FormData;
  globalThis.Event = window.Event;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.requestAnimationFrame = (callback) => callback();
}

async function waitFor(predicate, label, timeout = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const entryWindow = new Window({ url: 'https://coast.test/login?mailbox=1' });
installWindow(entryWindow);
entryWindow.document.body.innerHTML = `
  <button id="mailboxEntryButton" type="button">访客信箱</button>
  <dialog id="mailboxEntryModal">
    <strong id="mailbox-entry-title">访客信箱</strong>
    <button id="mailboxEntryClose" type="button">关闭</button>
    <section id="mailboxEntryChoices">
      <button type="button" data-mailbox-choice="login">输入暗号</button>
      <button type="button" data-mailbox-choice="register">填记名册</button>
    </section>
    <form id="mailboxLoginForm" hidden>
      <input name="passphrase"><p data-mailbox-error></p>
      <button type="button" data-mailbox-back>返回</button><button type="submit">进入</button>
    </form>
    <form id="mailboxRegisterForm" hidden>
      <input name="display_name"><input name="passphrase"><input name="preferred_name">
      <input name="allow_memory" type="checkbox" checked><p data-mailbox-error></p>
      <button type="button" data-mailbox-back>返回</button><button type="submit">登记</button>
    </form>
  </dialog>`;
globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});
await import(`../elementera-mcp/deploy-pages/public/mailbox-entry.js?dom=${Date.now()}`);
assert.equal(entryWindow.document.querySelector('#mailboxEntryModal').open, true, 'mailbox=1 must deep-link into the canonical mailbox entry flow');
entryWindow.document.querySelector('#mailboxEntryModal').close();
entryWindow.document.querySelector('#mailboxEntryButton').click();
assert.equal(entryWindow.document.querySelector('#mailboxEntryModal').open, true);
assert.equal(entryWindow.document.querySelector('#mailboxEntryChoices').hidden, false);
assert.equal(entryWindow.document.querySelector('#mailboxLoginForm').hidden, true);
assert.equal(entryWindow.document.querySelector('#mailboxRegisterForm').hidden, true);
entryWindow.document.querySelector('[data-mailbox-choice="login"]').click();
assert.equal(entryWindow.document.querySelector('#mailboxEntryChoices').hidden, true);
assert.equal(entryWindow.document.querySelector('#mailboxLoginForm').hidden, false);
assert.equal(entryWindow.document.querySelector('#mailboxRegisterForm').hidden, true);
assert.equal(entryWindow.document.querySelector('#mailbox-entry-title').textContent, '输入暗号');
entryWindow.document.querySelector('[data-mailbox-back]').click();
assert.equal(entryWindow.document.querySelector('#mailboxEntryChoices').hidden, false);
entryWindow.document.querySelector('[data-mailbox-choice="register"]').click();
assert.equal(entryWindow.document.querySelector('#mailboxEntryChoices').hidden, true);
assert.equal(entryWindow.document.querySelector('#mailboxLoginForm').hidden, true);
assert.equal(entryWindow.document.querySelector('#mailboxRegisterForm').hidden, false);
assert.equal(entryWindow.document.querySelector('#mailbox-entry-title').textContent, '填记名册');

const mailboxWindow = new Window({ url: 'https://coast.test/mailbox' });
installWindow(mailboxWindow);
mailboxWindow.document.body.innerHTML = `
  <div id="mailboxApp">
    <a data-icon="back"></a>
    <div id="mailboxConversationMenuWrap">
      <button id="mailboxConversationMenu" type="button" aria-expanded="false">›</button>
      <span id="mailboxConversationBubble" hidden><button data-mailbox-action="delete-account">删除整个对话</button></span>
    </div>
    <span id="mailboxVisitorLabel"></span>
    <div class="mailbox-top-actions"><button data-panel="notebook">访客记事本</button></div>
    <div id="mailboxMessageScroller"><div id="mailboxMessages"></div></div>
    <section id="mailboxStatusBar"><strong id="mailboxStatusText"></strong><small id="mailboxStatusMeta"></small></section>
    <button id="mailboxRefreshButton"></button>
    <form id="mailboxComposer"><textarea id="mailboxPromptInput"></textarea><button id="mailboxSendButton" data-icon="send"></button></form>
    <dialog id="mailboxPanel"><strong id="mailboxPanelTitle"></strong><small id="mailboxPanelSubtitle"></small><button id="mailboxPanelClose" data-icon="close"></button><div id="mailboxPanelBody"></div></dialog>
    <div id="mailboxToast" hidden></div>
  </div>`;

let messages = [
  { id: 'v-1', visitor_id: 'visitor-a', role: 'visitor', content: '第一封信', status: 'replied', reply_batch_id: 'batch-1', created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-01T10:00:00.000Z' },
  { id: 'm-1', visitor_id: 'visitor-a', role: 'model_partner', content: '第一封回信', status: 'sent', reply_batch_id: 'batch-1', created_at: '2026-08-01T11:00:00.000Z', updated_at: '2026-08-01T11:00:00.000Z' },
];
const memory = {
  thought_soil: {
    visitor_id: 'visitor-a',
    current_text: '沿着第一封信继续谈创作。',
    hand_seeds: [{ name: '星光', life_core: '喜欢星星意象。', usage_hint: '聊创作时使用。', avoid_hint: '' }],
    do_not_repeat: '不再解释慢速回信。',
    pocket_candidates: [{ title: '蓝色颜料', life_core: '常用蓝色颜料。', content: '创作偏好候选。' }],
    revision: 2,
    model_label: 'GPT-5.6 Thinking',
    updated_at: '2026-08-01T11:00:00.000Z',
  },
  pending_pockets: [{
    id: 'pocket-1',
    title: '蓝色颜料',
    life_core: '常用蓝色颜料。',
    content: '创作偏好候选。',
    status: 'pending',
    created_at: '2026-08-01T11:00:00.000Z',
    updated_at: '2026-08-01T11:00:00.000Z',
  }],
  entries: [{
    id: 'memory-1',
    title: '星星意象',
    life_core: '喜欢在创作里使用星星意象。',
    content: '一张已经确认的轻量记忆。',
    usage_hint: '讨论创作时自然记得。',
    avoid_hint: '',
    created_at: '2026-08-01T11:10:00.000Z',
    updated_at: '2026-08-01T11:10:00.000Z',
  }],
};
const requestedPaths = [];
globalThis.fetch = async (input, options = {}) => {
  const path = String(input);
  const method = options.method || 'GET';
  requestedPaths.push([path, method]);
  let value;
  if (path === '/api/mailbox/me') {
    value = { ok: true, visitor_id: 'visitor-a', display_name: '星星', preferred_name: '小星', allow_memory: true };
  } else if (path === '/api/mailbox/messages' && method === 'GET') {
    value = { ok: true, messages: structuredClone(messages) };
  } else if (path === '/api/mailbox/status') {
    value = { ok: true, pending_count: messages.filter((message) => message.status === 'waiting_for_model_partner').length, last_model_partner_reply_at: '2026-08-01T11:00:00.000Z', queue_status: 'replied' };
  } else if (path === '/api/mailbox/memory' && method === 'GET') {
    value = { ok: true, memory: structuredClone(memory) };
  } else if (path === '/api/mailbox/send') {
    const body = JSON.parse(options.body);
    const message = { id: 'v-2', visitor_id: 'visitor-a', role: 'visitor', content: body.content, status: 'waiting_for_model_partner', created_at: '2026-08-01T12:00:00.000Z', updated_at: '2026-08-01T12:00:00.000Z' };
    messages.push(message);
    value = { ok: true, message };
  } else if (path === '/api/mailbox/messages/v-1' && method === 'PATCH') {
    messages[0] = { ...messages[0], content: JSON.parse(options.body).content, status: 'waiting_for_model_partner', reply_batch_id: null };
    value = { ok: true, message: structuredClone(messages[0]) };
  } else if (path.startsWith('/api/mailbox/messages/') && method === 'DELETE') {
    const id = decodeURIComponent(path.split('/').at(-1));
    messages = messages.filter((message) => message.id !== id);
    value = { ok: true, id, deleted: true };
  } else if (path === '/api/mailbox/memory/entries/memory-1' && method === 'DELETE') {
    memory.entries = [];
    value = { ok: true };
  } else if (path.match(/^\/api\/mailbox\/memory\/pockets\/[^/]+\/resolve$/) && method === 'POST') {
    const id = decodeURIComponent(path.split('/').at(-2));
    const pocket = memory.pending_pockets.find((item) => item.id === id);
    const action = JSON.parse(options.body).action;
    memory.pending_pockets = memory.pending_pockets.filter((item) => item.id !== id);
    if (action === 'remember' && pocket) {
      memory.entries.push({
        ...pocket,
        id: `memory-from-${id}`,
        created_at: '2026-08-01T12:10:00.000Z',
        updated_at: '2026-08-01T12:10:00.000Z',
      });
    }
    value = { ok: true, entry: action === 'remember' ? memory.entries.at(-1) : null };
  } else if (path === '/api/mailbox/account' && method === 'DELETE') {
    value = { ok: true, visitor_id: 'visitor-a', deleted: true };
  } else {
    value = { ok: true };
  }
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

await import(`../elementera-mcp/deploy-pages/public/mailbox.js?dom=${Date.now()}`);
await waitFor(() => mailboxWindow.document.querySelector('.thought-soil-entry'), 'thought soil entry');
assert.match(mailboxWindow.document.querySelector('#mailboxVisitorLabel').textContent, /小星/);
assert.match(mailboxWindow.document.querySelector('#mailboxMessages').textContent, /第一封信/);
assert.match(mailboxWindow.document.querySelector('#mailboxMessages').textContent, /第一封回信/);
assert.equal(mailboxWindow.document.querySelector('#mailboxStatusText').textContent, '回信已经抵达。');
assert.equal(mailboxWindow.document.querySelector('.mailbox-top-actions [data-panel="soil"]'), null, 'thought soil is not a topbar drawer');
const soilEntry = mailboxWindow.document.querySelector('.thought-soil-entry');
assert.match(soilEntry.textContent, /1 粒当前活跃线索/);
assert.ok(mailboxWindow.document.querySelector('.message.assistant').previousElementSibling.classList.contains('thought-soil-row'));
assert.equal(mailboxWindow.document.querySelector('.message.user [data-mailbox-action="edit"]') != null, true);
assert.equal(mailboxWindow.document.querySelector('.message.user [data-mailbox-action="delete"]') != null, true);
assert.equal(mailboxWindow.document.querySelector('.message.assistant [data-mailbox-action="copy"]') != null, true);
assert.equal(mailboxWindow.document.querySelector('.message.assistant [data-mailbox-action="delete"]') != null, true);
assert.equal(mailboxWindow.document.querySelector('.mailbox-model-partner-avatar').textContent, '');

soilEntry.click();
await waitFor(() => mailboxWindow.document.querySelector('#mailboxPanel').open, 'soil panel');
await waitFor(() => mailboxWindow.document.querySelector('#mailboxPanelBody').textContent.includes('沿着第一封信继续谈创作'), 'soil panel content');
assert.equal(mailboxWindow.document.querySelector('#mailboxPanelTitle').textContent, '整理当前对话的纸条');
assert.match(mailboxWindow.document.querySelector('#mailboxPanelBody').textContent, /沿着第一封信继续谈创作/);
assert.match(mailboxWindow.document.querySelector('#mailboxPanelBody').textContent, /当前活跃线索 · 1\/7/);
assert.match(mailboxWindow.document.querySelector('#mailboxPanelBody').textContent, /待确认区 · 1/);
assert.match(mailboxWindow.document.querySelector('#mailboxPanelBody').textContent, /GPT-5.6 Thinking/);
mailboxWindow.document.querySelector('#mailboxPanel').close();

mailboxWindow.document.querySelector('[data-panel="notebook"]').click();
await waitFor(() => mailboxWindow.document.querySelector('#mailboxPanelTitle').textContent === '访客记事本', 'notebook panel');
await waitFor(() => mailboxWindow.document.querySelector('#mailboxPanelBody').textContent.includes('星星意象'), 'notebook panel content');
assert.match(mailboxWindow.document.querySelector('#mailboxPanelBody').textContent, /星星意象/);
assert.match(mailboxWindow.document.querySelector('#mailboxPanelBody').textContent, /待确认区 · 1/);

mailboxWindow.document.querySelector('#mailboxPanelBody [data-panel="pockets"]').click();
await waitFor(() => mailboxWindow.document.querySelector('#mailboxPanelTitle').textContent === '待确认区', 'pending pocket panel');
await waitFor(() => mailboxWindow.document.querySelector('[data-pocket-id="pocket-1"]'), 'pending pocket controls');
assert.ok(mailboxWindow.document.querySelector('[data-pocket-id="pocket-1"] [data-pocket-action="remember"]'));
assert.ok(mailboxWindow.document.querySelector('[data-pocket-id="pocket-1"] [data-pocket-action="discard"]'));
mailboxWindow.document.querySelector('[data-pocket-id="pocket-1"] [data-pocket-action="remember"]').click();
await waitFor(() => mailboxWindow.document.querySelector('#mailboxPanelBody').textContent.includes('待确认区是空的'), 'remembered pending pocket');
assert.equal(memory.pending_pockets.length, 0);
assert.ok(memory.entries.some((entry) => entry.title === '蓝色颜料'));
assert.ok(requestedPaths.some(([path, method]) => path === '/api/mailbox/memory/pockets/pocket-1/resolve' && method === 'POST'));

memory.pending_pockets.push({
  id: 'pocket-2', title: '绿色颜料', life_core: '这一枚要丢弃。', content: '不会进入记事本。', status: 'pending',
});
mailboxWindow.document.querySelector('[data-panel="notebook"]').click();
await waitFor(() => mailboxWindow.document.querySelector('#mailboxPanelBody').textContent.includes('待确认区 · 1'), 'second pending pocket count');
mailboxWindow.document.querySelector('#mailboxPanelBody [data-panel="pockets"]').click();
await waitFor(() => mailboxWindow.document.querySelector('[data-pocket-id="pocket-2"]'), 'discard pocket controls');
mailboxWindow.document.querySelector('[data-pocket-id="pocket-2"] [data-pocket-action="discard"]').click();
await waitFor(() => mailboxWindow.document.querySelector('#mailboxPanelBody').textContent.includes('待确认区是空的'), 'discarded pending pocket');
assert.equal(memory.pending_pockets.length, 0);
assert.equal(memory.entries.some((entry) => entry.title === '绿色颜料'), false);

mailboxWindow.prompt = () => '编辑后的第一封信';
mailboxWindow.document.querySelector('.message.user [data-mailbox-action="edit"]').click();
await waitFor(() => mailboxWindow.document.querySelector('.message.user')?.textContent.includes('编辑后的第一封信'), 'edited mailbox message');
assert.ok(requestedPaths.some(([path, method]) => path === '/api/mailbox/messages/v-1' && method === 'PATCH'));
assert.equal(mailboxWindow.document.querySelector('#mailboxStatusText').textContent, '已送达，等待另一位屋主查看。');

mailboxWindow.document.querySelector('#mailboxConversationMenu').click();
assert.equal(mailboxWindow.document.querySelector('#mailboxConversationBubble').hidden, false);
mailboxWindow.document.querySelector('[data-mailbox-action="delete-account"]').click();
const accountDanger = await waitFor(() => mailboxWindow.document.querySelector('[data-danger-confirm]'), 'account delete confirmation');
assert.match(accountDanger.textContent, /暗号、全部来信与回信、整理当前对话的纸条、待确认区和访客记事本都会永久删除/);
accountDanger.querySelector('[data-danger-cancel]').click();
await waitFor(() => !mailboxWindow.document.querySelector('[data-danger-confirm]'), 'account delete cancellation');
assert.equal(requestedPaths.some(([path]) => path === '/api/mailbox/account'), false);

const input = mailboxWindow.document.querySelector('#mailboxPromptInput');
input.value = '第二封信';
mailboxWindow.document.querySelector('#mailboxComposer').dispatchEvent(new mailboxWindow.Event('submit', {
  bubbles: true,
  cancelable: true,
}));
await waitFor(() => requestedPaths.some(([path, method]) => path === '/api/mailbox/send' && method === 'POST'), 'mailbox send');
await waitFor(() => mailboxWindow.document.querySelector('#mailboxMessages').textContent.includes('第二封信'), 'sent mailbox message');
assert.match(mailboxWindow.document.querySelector('#mailboxMessages').textContent, /第二封信/);
assert.equal(mailboxWindow.document.querySelector('#mailboxMessages').textContent.includes('模型选择'), false);

console.log('mailbox-dom: ok');
