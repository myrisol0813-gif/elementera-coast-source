import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml, q } from '../core/dom.js';

const DEFINITION = '人类思考链是屋主写给本轮对话的私人整理区。可以用来梳理思绪、暂放不好意思直接说出口的话、补充背景，或记录希望另一位屋主在回复前理解的状态。';
const READ_MODES = Object.freeze({
  keep_private: '只留给自己整理',
  read_now: '本轮递给另一位屋主',
});

function normalizedTarget(value = {}) {
  return {
    room_scope: value.room_scope === 'conversation' ? 'conversation' : 'conversation',
    conversation_id: String(value.conversation_id || ''),
  };
}

function targetKey(value) {
  const target = normalizedTarget(value);
  return `${target.room_scope}:${target.conversation_id}`;
}

function emptyHumanThought() {
  return {
    id: null,
    body: '',
    context_note: '',
    read_mode: 'keep_private',
    status: 'saved',
  };
}

function option(value, selected) {
  return `<option value="${escapeAttribute(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(READ_MODES[value])}</option>`;
}

function fields(container) {
  const value = (name) => q(`[name="${name}"]`, container)?.value || '';
  const readMode = value('read_mode');
  return {
    body: value('body'),
    context_note: value('context_note'),
    read_mode: READ_MODES[readMode] ? readMode : 'keep_private',
  };
}

function targetFrom(container) {
  return normalizedTarget({
    room_scope: container?.dataset.roomScope,
    conversation_id: container?.dataset.conversationId,
  });
}

export function createHumanThought({ toast }) {
  const records = new Map();

  function recordFor(target) {
    return records.get(targetKey(target)) || emptyHumanThought();
  }

  function render(container, targetValue, settings = {}) {
    if (!container) return;
    const target = normalizedTarget(targetValue);
    const note = recordFor(target);
    const summary = note.body || '本轮尚未填写人类思考链。';
    container.dataset.humanThoughtComposer = 'true';
    container.dataset.roomScope = target.room_scope;
    container.dataset.conversationId = target.conversation_id;
    container.innerHTML = `<details class="human-thought-composer" ${settings.open === true ? 'open' : ''}>
      <summary>
        <span><strong>屋主 · 人类思考链</strong><small>${escapeHtml(summary)}</small></span>
        <span class="human-thought-chevron">⌄</span>
      </summary>
      <div class="human-thought-fields">
        <p class="human-thought-intro">${DEFINITION}</p>
        <label>本轮整理<textarea name="body" rows="3" maxlength="6000" placeholder="写下本轮想先整理的内容。">${escapeHtml(note.body)}</textarea></label>
        <label>补充背景<textarea name="context_note" rows="2" maxlength="3000" placeholder="可选。补充另一位屋主回复前需要知道的背景。">${escapeHtml(note.context_note)}</textarea></label>
        <label>是否递给另一位屋主<select name="read_mode">${Object.keys(READ_MODES).map((value) => option(value, note.read_mode)).join('')}</select></label>
        <p class="human-thought-boundary">这一区域不会自动写入长期记忆、待确认区或当前活跃线索。</p>
        <div class="human-thought-actions"><button type="button" data-action="human-thought:save">保存</button></div>
      </div>
    </details>`;
  }

  async function fetchScope(targetValue) {
    const target = normalizedTarget(targetValue);
    if (!target.conversation_id) return null;
    const params = new URLSearchParams({ conversation_id: target.conversation_id });
    const data = await requestJson(`${API.humanThought}?${params}`);
    records.set(targetKey(target), data.human_thought || emptyHumanThought());
    return data.human_thought;
  }

  async function mountComposer(container, targetValue) {
    const target = normalizedTarget(targetValue);
    if (!container || !target.conversation_id) return;
    render(container, target);
    try {
      await fetchScope(target);
    } catch (error) {
      console.warn('[human-thought:load]', String(error?.message || error).slice(0, 160));
    }
    render(container, target);
  }

  function submission(targetValue, container) {
    const target = normalizedTarget(targetValue);
    const value = container ? fields(container) : recordFor(target);
    const body = String(value.body || '').trim();
    const contextNote = String(value.context_note || '').trim();
    if ((!body && !contextNote) || value.read_mode !== 'read_now') return null;
    return {
      ...target,
      body,
      context_note: contextNote,
      read_mode: 'read_now',
      snapshot_id: `human-thought-snapshot-${crypto.randomUUID()}`,
    };
  }

  function externalSubmission() {
    return null;
  }

  function resetCrossWindow() {}

  async function savePanel(container) {
    const target = targetFrom(container);
    if (!target.conversation_id) return null;
    const value = fields(container);
    const data = await requestJson(API.humanThought, {
      method: 'PUT',
      body: JSON.stringify({ ...target, ...value }),
    });
    records.set(targetKey(target), data.human_thought || emptyHumanThought());
    render(container, target, { open: true });
    toast?.('人类思考链已保存。');
    return data.human_thought;
  }

  function panelFrom(target) {
    return target.closest('[data-human-thought-composer]');
  }

  async function handleAction(name, target) {
    const container = panelFrom(target);
    if (!container) return;
    if (name === 'save') return savePanel(container);
  }

  function ownsEvent(_event, context) {
    return context.eventType === 'click' && context.namespace === 'human-thought'
      ? { preventDefault: true }
      : false;
  }

  function handleEvent(event, context) {
    return handleAction(context.name, context.target, event);
  }

  return Object.freeze({
    id: 'human-thought',
    priority: 60,
    mountOrder: 60,
    ownsEvent,
    handleEvent,
    mount() {},
    refresh() {},
    destroy() {},
    fetchScope,
    mountComposer,
    submission,
    externalSubmission,
    resetCrossWindow,
    handleAction,
  });
}
