import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createDogtalk } from '../elementera-mcp/deploy-pages/public/features/dogtalk.js';

const window = new Window({ url: 'https://coast.test/' });
globalThis.window = window;
globalThis.document = window.document;

const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const method = options.method || 'GET';
  requests.push({ href, method, body: options.body || '' });
  if (method === 'PUT') {
    const value = JSON.parse(options.body || '{}');
    return new Response(JSON.stringify({
      ok: true,
      dogtalk: {
        id: value.id || 'dogtalk-test',
        room_scope: value.room_scope,
        ...(value.conversation_id ? { conversation_id: value.conversation_id } : {}),
        body: value.body,
        true_core: value.true_core,
        weather: value.weather,
        read_mode: value.read_mode,
        status: 'saved',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  const params = new URL(href, 'https://coast.test/').searchParams;
  const roomScope = params.get('room_scope') || 'conversation';
  const conversationId = params.get('conversation_id') || '';
  return new Response(JSON.stringify({
    ok: true,
    dogtalk: {
      id: null,
      room_scope: roomScope,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      body: '',
      true_core: '',
      weather: '放松',
      read_mode: 'keep_private',
      status: 'saved',
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const toasts = [];
const dogtalk = createDogtalk({ toast: (message) => toasts.push(message) });

function container(id) {
  const node = document.createElement('div');
  node.id = id;
  document.body.appendChild(node);
  return node;
}

const conversation = container('conversationDogtalk');
const radio = container('radioDogtalk');
const lighthouse = container('lighthouseDogtalk');
await dogtalk.mountComposer(conversation, { room_scope: 'conversation', conversation_id: 'conversation-1' });
await dogtalk.mountComposer(radio, { room_scope: 'radio' });
await dogtalk.mountComposer(lighthouse, { room_scope: 'lighthouse' });

for (const node of [conversation, radio, lighthouse]) {
  const controls = [...node.querySelectorAll('textarea[name], input[name], select[name]')];
  assert.deepEqual(controls.map((item) => item.getAttribute('name')), [
    'body', 'true_core', 'weather', 'read_mode',
  ]);
  const saveButtons = [...node.querySelectorAll('button[data-action="dogtalk:save"]')];
  assert.equal(saveButtons.length, 1, 'Dogtalk keeps exactly one save action');
  assert.equal(saveButtons[0].textContent.trim(), '保存');
  assert.deepEqual(
    [...node.querySelectorAll('button[data-action="dogtalk:tab"]')].map((item) => item.dataset.tab),
    ['dogtalk', 'cross', 'keyword'],
    'Dogtalk card exposes dogtalk, old-letter fetch, and local keyword recall tabs',
  );
  assert.match(node.textContent, /跨窗关键词漫游/);
  assert.match(node.textContent, /不会搜索互联网/);
  assert.deepEqual(
    [...node.querySelectorAll('button[data-action="dogtalk:cross-mode"]')].map((item) => item.dataset.mode),
    ['off', 'manual', 'model_decides'],
    'Cross-window controls expose the three per-turn modes',
  );
  for (const retired of ['self_note', 'myri_hint', 'not_to_misunderstand']) {
    assert.equal(node.innerHTML.includes(retired), false);
  }
  for (const retiredCopy of ['保存草稿', '把这句人类思考链轻轻展开', '让 Model Partner 读一下', '隐藏 / 归档', '清空本条草稿']) {
    assert.equal(node.textContent.includes(retiredCopy), false);
  }
  assert.match(node.textContent, /本条不会发送给模型，只留在人类思考链小抽屉里/);
  assert.deepEqual(
    [...node.querySelectorAll('select[name="read_mode"] option')].map((item) => item.value),
    ['keep_private', 'when_confused', 'read_now'],
  );
  assert.equal(node.textContent.includes('当前窗口可以看一点'), false);
}

const body = conversation.querySelector('[name="body"]');
const core = conversation.querySelector('[name="true_core"]');
const weather = conversation.querySelector('[name="weather"]');
const readMode = conversation.querySelector('[name="read_mode"]');
body.value = '一小团人类思考链。';
core.value = '想被轻轻看见。';
weather.value = '困';

readMode.value = 'keep_private';
assert.equal(dogtalk.submission({ room_scope: 'conversation', conversation_id: 'conversation-1' }, conversation), null);
readMode.value = 'when_confused';
assert.equal(dogtalk.submission({ room_scope: 'conversation', conversation_id: 'conversation-1' }, conversation), null);
readMode.value = 'current_room';
assert.equal(
  dogtalk.submission({ room_scope: 'conversation', conversation_id: 'conversation-1' }, conversation),
  null,
  'a retired current_room value cannot produce a frontend snapshot',
);
readMode.value = 'read_now';
const readNow = dogtalk.submission({ room_scope: 'conversation', conversation_id: 'conversation-1' }, conversation);
assert.equal(readNow.body, '一小团人类思考链。');
assert.equal(readNow.true_core, '想被轻轻看见。');
assert.equal(readNow.weather, '困');
assert.equal(readNow.read_mode, 'read_now');
assert.equal(readNow.room_scope, 'conversation');
assert.equal(readNow.conversation_id, 'conversation-1');
assert.match(readNow.snapshot_id, /^dogtalk-snapshot-/);
for (const retired of ['self_note', 'myri_hint', 'not_to_misunderstand', 'status']) {
  assert.equal(retired in readNow, false);
}
body.value = '';
assert.equal(dogtalk.submission({ room_scope: 'conversation', conversation_id: 'conversation-1' }, conversation), null);

body.value = '只留在抽屉里的这一条。';
readMode.value = 'keep_private';
await dogtalk.handleAction('save', conversation.querySelector('[data-action="dogtalk:save"]'));
const put = [...requests].reverse().find((item) => item.method === 'PUT');
assert.ok(put);
const saved = JSON.parse(put.body);
assert.deepEqual(Object.keys(saved).sort(), [
  'body', 'conversation_id', 'read_mode', 'room_scope', 'status', 'true_core', 'weather',
].sort());
assert.equal(saved.read_mode, 'keep_private');
assert.equal(saved.status, 'saved');
assert.match(toasts.at(-1), /只留在小抽屉里/);

globalThis.fetch = originalFetch;
console.log('dogtalk-dom: ok');