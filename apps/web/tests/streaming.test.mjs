import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createEventSpine } from '../elementera-mcp/deploy-pages/public/core/event-spine.js';
import { createChat, createCoastSseParser } from '../elementera-mcp/deploy-pages/public/features/chat.js';

const window = new Window({ url: 'http://coast.test/' });
window.document.body.innerHTML = `
  <div id="chatConversationList"></div>
  <div id="messageScroller"><div id="messages"></div></div>
  <form id="composer" data-submit="chat:composer">
    <textarea id="promptInput" data-input="chat:composer"></textarea>
    <button id="micButton" type="button"></button>
    <button id="composerActionButton" type="submit" data-action="chat:composer-primary"></button>
  </form>
  <div id="chatStatus" hidden></div>
  <div id="modelName"></div>
`;
for (const name of [
  'window', 'document', 'localStorage', 'navigator', 'HTMLElement', 'HTMLFormElement', 'HTMLInputElement',
  'HTMLTextAreaElement', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'Blob', 'FileReader',
]) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: window[name] || window });
globalThis.requestAnimationFrame = (callback) => callback(Date.now());
window.requestAnimationFrame = globalThis.requestAnimationFrame;
globalThis.confirm = () => true;
globalThis.prompt = (_message, fallback = '') => fallback;
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async () => undefined } });

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(test, label, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (test()) return;
    await tick();
  }
  throw new Error(`timeout:${label}`);
}

const parsed = [];
const parser = createCoastSseParser((event) => parsed.push(event));
parser.push('event: delta\ndata: {"content":"半');
assert.equal(parsed.length, 0, 'client SSE parser must not parse a half event');
parser.push('截"}\n\n');
assert.deepEqual(parsed, [{ event: 'delta', data: { content: '半截' } }]);

const state = {
  runControl: {
    recentTurns: 8,
    contextBudget: 6000,
    outputLength: 'auto',
    creativity: 'balanced',
    streamingEnabled: true,
    seedCooldownTurns: 2,
  },
};
const storage = {
  read: () => state,
  update(mutator) { mutator(state); return state; },
  migrationConversations: [],
  migrationProfile: null,
  migrationPending: false,
  getCurrentConversation: () => 'conv-stream',
  setCurrentConversation: () => undefined,
  completeMigration: () => undefined,
};

const now = () => new Date().toISOString();
let conversations = [{
  id: 'conv-stream', title: '新聊天', created_at: now(), updated_at: now(), deleted_at: null,
  title_manual: false, title_generated_at: null, title_model_id: null,
}];
let serverHistory = { version: 4, updated_at: now(), turns: [] };
let historyPutCount = 0;
const historyWrites = [];
let titleCount = 0;
let soilCount = 0;
let chatRequestCount = 0;
const chatBodies = [];
const toastMessages = [];
const encoder = new TextEncoder();
const streamScenarios = [];

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function coastStream(blocks, options, gate = null) {
  return new Response(new ReadableStream({
    start(controller) {
      const abort = () => controller.error(new DOMException('Aborted', 'AbortError'));
      options.signal?.addEventListener('abort', abort, { once: true });
      for (const block of blocks.before || []) controller.enqueue(encoder.encode(block));
      if (gate) {
        gate.release = () => {
          if (options.signal?.aborted) return;
          for (const block of blocks.after || []) controller.enqueue(encoder.encode(block));
          controller.close();
        };
      } else {
        for (const block of blocks.after || []) controller.enqueue(encoder.encode(block));
        controller.close();
      }
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input), 'http://coast.test');
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  if (url.pathname === '/api/chat/profile') {
    return json({
      ok: true,
      profile: {
        assistant_avatar_dataurl: '',
        current_chat_model: 'openai/gpt-5.5',
        current_image_model: '',
        model_box: { chat: ['openai/gpt-5.5'], free: [], image: [] },
      },
    });
  }
  if (url.pathname === '/api/chat/conversations') return json({ ok: true, conversations });
  if (url.pathname === '/api/chat/history') {
    if (method === 'PUT') {
      historyPutCount += 1;
      serverHistory = structuredClone(body);
      historyWrites.push(structuredClone(body));
    }
    return json({ ok: true, source: 'd1-json-v4', history: { ...serverHistory, conversation_id: 'conv-stream' } });
  }
  if (url.pathname === '/api/chat/title') {
    titleCount += 1;
    conversations[0] = {
      ...conversations[0], title: '流式标题', title_generated_at: now(), title_model_id: 'openai/gpt-4.1-nano',
    };
    return json({ ok: true, conversation: conversations[0] });
  }
  if (url.pathname === '/api/chat') {
    chatRequestCount += 1;
    chatBodies.push(body);
    if (body.stream === true) {
      const scenario = streamScenarios.shift();
      if (!scenario) throw new Error('missing stream scenario');
      return coastStream(scenario.blocks, options, scenario.gate);
    }
    return json({
      ok: true,
      model: body.model,
      message: { role: 'assistant', content: `json: ${body.messages.at(-1)?.content || ''}` },
      usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
      finish_reason: 'stop',
      memory: { selected_entry_ids: [], vector_enabled: false },
    });
  }
  throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
};

const memory = {
  renderSoilEntry: () => '',
  onConversationChanged: async () => undefined,
  onReplyCompleted: async () => {
    soilCount += 1;
    return { ok: true, soil: { current_text: 'ok', hand_seeds: [], do_not_repeat: '', pocket_candidates: [] } };
  },
};
const chat = createChat({ storage, toast: (message) => toastMessages.push(message) });
chat.setMemoryController(memory);
const chatSpine = createEventSpine({ root: document, owners: [chat] });
await chatSpine.mount();

const input = document.querySelector('#promptInput');
const send = (text) => {
  input.value = text;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('#composerActionButton').click();
};
const activeAssistant = () => serverHistory.turns.at(-1)?.assistant?.variantsByUserVariant?.['0']?.at(-1);

const successGate = {};
streamScenarios.push({
  gate: successGate,
  blocks: {
    before: [
      'event: meta\ndata: {"model":"openai/gpt-5.5","generation_id":"gen-success"}\n\n',
      'event: delta\ndata: {"content":"海"}\n\n',
    ],
    after: [
      'event: delta\ndata: {"content":"岸"}\n\n',
      'event: usage\ndata: {"prompt_tokens":21,"completion_tokens":2,"total_tokens":23}\n\n',
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ],
  },
});
send('第一轮');
await waitFor(() => document.querySelector('.assistant-text')?.textContent.includes('海'), 'first partial delta');
assert.equal(document.querySelectorAll('.message.assistant').length, 1, 'partial deltas must stay in one assistant message');
assert.equal(historyPutCount, 0, 'streaming must not write D1 per chunk or for the placeholder');
assert.equal(titleCount, 0, 'auto title must wait for stream completion');
assert.equal(soilCount, 0, 'thought soil must wait for stream completion');
successGate.release();
await waitFor(() => historyPutCount === 1 && titleCount === 1 && soilCount === 1, 'successful stream finalization');
const successVariant = activeAssistant();
assert.equal(successVariant.content, '海岸');
assert.equal(serverHistory.turns.at(-1).assistant.variantsByUserVariant['0'].length, 1, 'stream deltas must not create assistant variants');
assert.equal(successVariant.model_id, 'openai/gpt-5.5');
assert.deepEqual(successVariant.usage, { prompt_tokens: 21, completion_tokens: 2, total_tokens: 23 });
assert.equal(successVariant.finish_reason, 'stop');
assert.equal(successVariant.generation_source, 'chat');
const footprint = document.querySelector('.generation-footprint');
assert.equal(footprint.textContent, 'GPT-5.5 · 23 tok');
assert.match(footprint.getAttribute('title'), /^model_id: openai\/gpt-5\.5\nprompt_tokens: 21\ncompletion_tokens: 2\ntotal_tokens: 23\nfinish_reason: stop\ngeneration_source: chat$/);
assert.doesNotMatch(footprint.getAttribute('title'), /api[_ -]?key|secret|request body/i, 'generation detail must expose only provenance fields');
await chat.handleAction('generation-detail', footprint);
assert.match(toastMessages.at(-1), /generation_source: chat/);

const modelOnlySaves = historyPutCount;
const modelOnlyTitles = titleCount;
const modelOnlySoil = soilCount;
streamScenarios.push({
  blocks: {
    before: ['event: meta\ndata: {"model":"openai/gpt-5.5","generation_id":"gen-no-usage"}\n\nevent: delta\ndata: {"content":"没有 usage"}\n\n'],
    after: ['event: done\ndata: {"finish_reason":"stop"}\n\n'],
  },
});
send('第二轮');
await waitFor(() => historyPutCount === modelOnlySaves + 1 && soilCount === modelOnlySoil + 1, 'stream without usage');
assert.equal(titleCount, modelOnlyTitles, 'auto title must only run for the first completed reply');
const modelOnlyFootprint = [...document.querySelectorAll('.generation-footprint')].at(-1);
assert.equal(modelOnlyFootprint.textContent, 'GPT-5.5', 'missing provider usage must not display fake tokens');
assert.equal('usage' in activeAssistant(), false);

const cancelGate = {};
const cancelSaves = historyPutCount;
const cancelTitles = titleCount;
const cancelSoil = soilCount;
streamScenarios.push({
  gate: cancelGate,
  blocks: {
    before: ['event: meta\ndata: {"model":"openai/gpt-5.5","generation_id":"gen-cancel"}\n\nevent: delta\ndata: {"content":"半截保留"}\n\n'],
    after: [],
  },
});
send('取消这一轮');
await waitFor(() => [...document.querySelectorAll('.assistant-text')].at(-1)?.textContent.includes('半截保留'), 'cancel partial');
document.querySelector('#composerActionButton').click();
await waitFor(() => historyPutCount === cancelSaves + 1, 'cancel final save');
assert.equal(activeAssistant().content, '半截保留');
assert.equal(activeAssistant().finish_reason, 'cancelled');
assert.equal(titleCount, cancelTitles, 'cancelled stream must not auto title');
assert.equal(soilCount, cancelSoil, 'cancelled stream must not organize thought soil');
assert.equal(historyPutCount, cancelSaves + 1, 'cancelled stream must save its final partial state once');

const errorSaves = historyPutCount;
const errorTitles = titleCount;
const errorSoil = soilCount;
streamScenarios.push({
  blocks: {
    before: [
      'event: meta\ndata: {"model":"openai/gpt-5.5","generation_id":"gen-error"}\n\n',
      'event: delta\ndata: {"content":"残页"}\n\n',
      'event: error\ndata: {"type":"provider_unavailable","message":"上游模型暂时不可用。"}\n\n',
    ],
    after: [],
  },
});
send('错误这一轮');
await waitFor(() => historyPutCount === errorSaves + 1, 'provider error final save');
assert.equal(activeAssistant().content, '残页');
assert.equal(activeAssistant().finish_reason, 'error');
assert.match(activeAssistant().errorDetail, /^provider_unavailable: 上游模型暂时不可用。$/);
assert.equal(titleCount, errorTitles, 'errored stream must not auto title');
assert.equal(soilCount, errorSoil, 'errored stream must not organize thought soil');
assert.equal(historyPutCount, errorSaves + 1, 'errored stream must save partial state once');

state.runControl.streamingEnabled = false;
const jsonRequestIndex = chatBodies.length;
const jsonSaves = historyPutCount;
send('关闭流式');
await waitFor(() => [...document.querySelectorAll('.assistant-text')].at(-1)?.textContent.includes('json: 关闭流式'), 'non-streaming JSON reply');
assert.equal(chatBodies[jsonRequestIndex].stream, undefined, 'streamingEnabled=false must keep the ordinary JSON request path');
assert.ok(historyPutCount >= jsonSaves + 2, 'the existing JSON path keeps its placeholder and final persistence behavior');
assert.equal(activeAssistant().usage.total_tokens, 35);

await chat.importFlatMessages([{ role: 'user', content: 'old' }, { role: 'assistant', content: 'legacy reply' }]);
assert.equal(document.querySelector('.assistant-text').textContent.includes('legacy reply'), true);
assert.equal(document.querySelector('.generation-footprint'), null, 'legacy assistant messages without metadata must render without a footprint');

assert.ok(chatRequestCount >= 5);
assert.equal(historyWrites.filter((history) => history.turns?.at(-1)?.assistant?.variantsByUserVariant?.['0']?.at(-1)?.finish_reason === 'cancelled').length, 1);
assert.equal(historyWrites.filter((history) => history.turns?.at(-1)?.assistant?.variantsByUserVariant?.['0']?.at(-1)?.finish_reason === 'error').length, 1);

await chatSpine.unmount();
console.log('streaming: ok');
