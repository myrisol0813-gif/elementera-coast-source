import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml, q, qa } from '../core/dom.js';

const DEFAULT_TEXT = '屋主这轮很放松，因此偷懒中。';
const NO_PRESSURE = '不写也可以。私人草稿是助力，不是打卡。';
const BOUNDARY = '它只是此刻的低权重天气，不是指令或偏好；不进入整理当前对话的纸条、落袋、种子、记忆或自动总结。';
const PRIVATE_NOTE = '选择“不需要，放着就好”时，本条不会发送给模型，只留在私人草稿小抽屉里。';
const CROSS_DESCRIPTION = '这是本轮从其他对话窗口取来的近期聊天记录，用来帮你回想自己在别处说过的话；要不要提起，由你按当前对话决定。';
const READ_MODES = Object.freeze({
  keep_private: '不需要，放着就好',
  when_confused: '模型伙伴困惑时可以看一点',
  read_now: '这次希望模型伙伴直接读一下',
});
const CROSS_MODES = Object.freeze({ off: '关闭', manual: '手动选择窗口', model_decides: '让模型决定' });
const CHAT_VISIBLE_MODES = new Set(['read_now']);

let crossWindowStylesInstalled = false;
function ensureCrossWindowStyles() {
  if (crossWindowStylesInstalled || document.querySelector('link[data-cross-window-styles]')) { crossWindowStylesInstalled = true; return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/public/styles/cross-window.css';
  link.dataset.crossWindowStyles = 'true';
  document.head.append(link);
  crossWindowStylesInstalled = true;
}

function normalizedTarget(value = {}) {
  const roomScope = ['conversation', 'radio', 'lighthouse'].includes(value.room_scope)
    ? value.room_scope
    : 'conversation';
  return {
    room_scope: roomScope,
    conversation_id: roomScope === 'conversation' ? String(value.conversation_id || '') : '',
  };
}

function targetKey(value) {
  const target = normalizedTarget(value);
  return target.room_scope === 'conversation'
    ? `conversation:${target.conversation_id}`
    : `${target.room_scope}:main`;
}

function query(value) {
  const target = normalizedTarget(value);
  const params = new URLSearchParams({ room_scope: target.room_scope });
  if (target.conversation_id) params.set('conversation_id', target.conversation_id);
  return params.toString();
}

function emptyDogtalk() {
  return {
    id: null,
    body: '',
    true_core: '',
    weather: '放松',
    read_mode: 'keep_private',
    status: 'saved',
  };
}

function emptyCrossWindow() {
  return {
    tab: 'dogtalk',
    mode: 'off',
    sources: [],
    selections: {},
    expandedSources: {},
    expandedTurns: {},
    limits: null,
    loading: false,
    error: '',
  };
}

function option(value, selected) {
  return `<option value="${escapeAttribute(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(READ_MODES[value])}</option>`;
}

function targetFrom(container) {
  return normalizedTarget({
    room_scope: container?.dataset.roomScope,
    conversation_id: container?.dataset.conversationId,
  });
}

function fields(container) {
  const value = (name) => q(`[name="${name}"]`, container)?.value || '';
  return {
    body: value('body'),
    true_core: value('true_core'),
    weather: value('weather'),
    read_mode: READ_MODES[value('read_mode')] ? value('read_mode') : 'keep_private',
  };
}

function panelFrom(target) {
  return target.closest('[data-dogtalk-composer]');
}

function sourceLabel(source) {
  if (source.source === 'rikkahub') return `【Rikka】${source.title}`;
  if (source.room_type === 'radio' || source.room_type === 'lighthouse') return source.title;
  return `主聊天｜${source.title}`;
}

function readableTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function crossModeButton(mode, selected) {
  return `<button type="button" class="cross-window-mode ${selected === mode ? 'is-active' : ''}" data-action="dogtalk:cross-mode" data-mode="${mode}">${CROSS_MODES[mode]}</button>`;
}

function messageSelectionKey(conversationId, messageId) {
  return `${conversationId}::${messageId}`;
}

function turnExpansionKey(conversationId, turnId) {
  return `${conversationId}::${turnId}`;
}

function sourceRows(state) {
  if (state.loading) return '<p class="cross-window-empty">正在整理跨窗口历史索引……</p>';
  if (state.error) return `<p class="cross-window-empty">${escapeHtml(state.error)}</p>`;
  if (!state.limits) return '<p class="cross-window-empty">正在读取可用窗口……</p>';
  if (!state.sources.length) return '<p class="cross-window-empty">现在没有其他可读取窗口。</p>';
  return state.sources.map((source) => {
    const conversationId = source.conversation_id;
    const sourceOpen = state.expandedSources[conversationId] === true;
    if (!source.readable) return `<section class="cross-window-source is-disabled">
      <div class="cross-window-source-toggle"><span><strong>${escapeHtml(sourceLabel(source))}</strong><small>${escapeHtml(source.disabled_reason || '不可读取')}</small></span></div>
    </section>`;
    const turns = sourceOpen ? (Array.isArray(source.turns) ? source.turns : []).map((turn) => {
      const turnKey = turnExpansionKey(conversationId, turn.turn_id);
      const turnOpen = state.expandedTurns[turnKey] === true;
      const messages = turnOpen ? (Array.isArray(turn.messages) ? turn.messages : []).map((message) => {
        const key = messageSelectionKey(conversationId, message.message_id);
        const checked = state.selections[key] === true;
        const role = String(message.role || 'message');
        const author = message.display_author || (role === 'assistant' ? '模型伙伴' : role === 'user' ? 'user' : role);
        return `<label class="cross-window-message">
          <input type="checkbox" name="cross_message" data-conversation-id="${escapeAttribute(conversationId)}" value="${escapeAttribute(message.message_id)}" ${checked ? 'checked' : ''}>
          <span><strong>${escapeHtml(role)} · ${escapeHtml(author)}</strong><small>${escapeHtml(readableTime(message.created_at))}${message.length ? ` · ${Number(message.length)} 字符` : ''}</small><em>${escapeHtml(message.preview || '（空）')}</em></span>
        </label>`;
      }).join('') : '';
      return `<section class="cross-window-turn">
        <button type="button" class="cross-window-turn-toggle" data-action="dogtalk:cross-turn-toggle" data-conversation-id="${escapeAttribute(conversationId)}" data-turn-id="${escapeAttribute(turn.turn_id || '')}">
          <span>轮次 ${Number(turn.turn_number) || 0}</span><small>${Number(turn.messages?.length || 0)} 条消息</small><b>${turnOpen ? '⌃' : '⌄'}</b>
        </button>
        ${turnOpen ? `<div class="cross-window-message-list">${messages}</div>` : ''}
      </section>`;
    }).join('') : '';
    return `<section class="cross-window-source">
      <button type="button" class="cross-window-source-toggle" data-action="dogtalk:cross-source-toggle" data-conversation-id="${escapeAttribute(conversationId)}">
        <span><strong>${escapeHtml(sourceLabel(source))}</strong><small>${escapeHtml(readableTime(source.updated_at))} · ${Number(source.turn_count) || 0} 轮</small></span><b>${sourceOpen ? '⌃' : '⌄'}</b>
      </button>
      ${sourceOpen ? `<div class="cross-window-turn-list">${turns}</div>` : ''}
    </section>`;
  }).join('');
}

export function createDogtalk({ toast }) {
  const records = new Map();
  const crossWindows = new Map();

  function recordFor(target) {
    return records.get(targetKey(target)) || emptyDogtalk();
  }

  function crossFor(target) {
    const key = targetKey(target);
    if (!crossWindows.has(key)) crossWindows.set(key, emptyCrossWindow());
    return crossWindows.get(key);
  }

  function render(container, targetValue, settings = {}) {
    if (!container) return;
    const target = normalizedTarget(targetValue);
    const dogtalk = recordFor(target);
    const cross = crossFor(target);
    const open = settings.open === true;
    const summary = dogtalk.body || DEFAULT_TEXT;
    const crossVisible = cross.tab === 'cross';
    const keywordVisible = cross.tab === 'keyword';
    const limitsText = '手动选择只在本轮有效；窗口默认收起，展开到单条消息后可分别勾选。';
    container.dataset.dogtalkComposer = 'true';
    container.dataset.roomScope = target.room_scope;
    container.dataset.conversationId = target.conversation_id;
    container.innerHTML = `<details class="dogtalk-composer" ${open ? 'open' : ''}>
      <summary>
        <span><strong>屋主 · 私人草稿 / 跨窗口</strong><small>${escapeHtml(summary)}</small></span>
        <span class="dogtalk-chevron">⌄</span>
      </summary>
      <div class="dogtalk-fields">
        <div class="dogtalk-tabs" role="tablist">
          <button type="button" class="dogtalk-tab ${!crossVisible && !keywordVisible ? 'is-active' : ''}" data-action="dogtalk:tab" data-tab="dogtalk">私人草稿</button>
          <button type="button" class="dogtalk-tab ${crossVisible ? 'is-active' : ''}" data-action="dogtalk:tab" data-tab="cross">跨窗口读取</button>
          <button type="button" class="dogtalk-tab ${keywordVisible ? 'is-active' : ''}" data-action="dogtalk:tab" data-tab="keyword">跨窗关键词漫游</button>
        </div>
        <section class="dogtalk-pane" ${crossVisible || keywordVisible ? 'hidden' : ''} data-dogtalk-pane>
          <p class="dogtalk-intro">${NO_PRESSURE}</p>
          <label>私人草稿本体<textarea name="body" rows="2" maxlength="6000" placeholder="允许混乱、不完整、临时想法和未整理片段……">${escapeHtml(dogtalk.body)}</textarea></label>
          <label>真心核<textarea name="true_core" rows="2" maxlength="2000" placeholder="这句私人草稿下面真正递出去的东西">${escapeHtml(dogtalk.true_core)}</textarea></label>
          <div class="dogtalk-grid">
            <label>当前天气<input name="weather" maxlength="80" value="${escapeAttribute(dogtalk.weather)}" placeholder="放松、困、忙、犹豫、未整理……"></label>
            <label>模型伙伴是否需要看<select name="read_mode">${Object.keys(READ_MODES).map((value) => option(value, dogtalk.read_mode)).join('')}</select></label>
          </div>
          <p class="dogtalk-boundary">${BOUNDARY}</p>
          <p class="dogtalk-boundary dogtalk-private-note">${PRIVATE_NOTE}</p>
          <div class="dogtalk-actions"><button type="button" data-action="dogtalk:save">保存</button></div>
        </section>
        <section class="cross-window-pane" ${crossVisible ? '' : 'hidden'} data-cross-window-pane>
          <p class="dogtalk-intro">${CROSS_DESCRIPTION}</p>
          <div class="cross-window-modes">${Object.keys(CROSS_MODES).map((mode) => crossModeButton(mode, cross.mode)).join('')}</div>
          <div class="cross-window-limits">${escapeHtml(limitsText)}</div>
          ${cross.mode === 'manual' ? `<div class="cross-window-sources">${sourceRows(cross)}</div>` : ''}
          ${cross.mode === 'model_decides' ? '<p class="cross-window-note">本轮只把取信工具递给模型，不提前塞入其他窗口正文。模型没有调用时，不会读取。</p>' : ''}
          ${cross.mode === 'off' ? '<p class="cross-window-note">本轮关闭，不读取其他窗口。</p>' : ''}
        </section>
        <section class="cross-window-pane cross-window-keyword-pane" ${keywordVisible ? '' : 'hidden'} data-cross-window-keyword-pane>
          <p class="dogtalk-intro"><strong>本地跨窗关键词漫游</strong> · 只检索跨窗口历史，不会搜索互联网。</p>
          <p class="cross-window-note">模型会先拿到最多约 10 条短摘录和定位，再自行挑 1–3 条完整历史消息阅读；不会把全部命中一次塞进上下文。</p>
          <button type="button" class="cross-window-keyword-toggle ${cross.mode === 'keyword' ? 'is-active' : ''}" data-action="dogtalk:keyword-toggle">
            ${cross.mode === 'keyword' ? '本轮已允许模型检索本地历史' : '本轮允许模型检索本地历史'}
          </button>
          <p class="cross-window-note">如果本地历史没有命中，工具会明确返回“本地历史无命中”；这里的关键词工具与 web search 是两条不同路径。</p>
        </section>
      </div>
    </details>`;
  }

  async function fetchScope(targetValue) {
    const target = normalizedTarget(targetValue);
    if (target.room_scope === 'conversation' && !target.conversation_id) return null;
    const data = await requestJson(`${API.dogtalk}?${query(target)}`);
    records.set(targetKey(target), data.dogtalk || emptyDogtalk());
    return data.dogtalk;
  }

  async function fetchCrossSources(container) {
    const target = targetFrom(container);
    if (!target.conversation_id) return;
    const state = crossFor(target);
    state.loading = true;
    state.error = '';
    render(container, target, { open: true });
    try {
      const params = new URLSearchParams({ current_conversation_id: target.conversation_id });
      const data = await requestJson(`${API.crossWindowMessages}?${params}`);
      if (!data.limits || typeof data.limits !== 'object') throw new Error('前端没有返回跨窗口设置。');
      state.sources = Array.isArray(data.sources) ? data.sources : [];
      state.limits = data.limits;
      const next = {};
      for (const source of state.sources) {
        for (const turn of Array.isArray(source.turns) ? source.turns : []) {
          for (const message of Array.isArray(turn.messages) ? turn.messages : []) {
            const key = messageSelectionKey(source.conversation_id, message.message_id);
            next[key] = state.selections[key] === true;
          }
        }
      }
      state.selections = next;
    } catch (error) {
      state.error = String(error?.message || '跨窗口列表读取失败。').slice(0, 160);
    } finally {
      state.loading = false;
      render(container, target, { open: true });
    }
  }

  async function mountComposer(container, targetValue) {
    ensureCrossWindowStyles();
    const target = normalizedTarget(targetValue);
    if (!container || (target.room_scope === 'conversation' && !target.conversation_id)) return;
    render(container, target);
    try {
      await fetchScope(target);
      render(container, target);
    } catch (error) {
      console.warn('[dogtalk:load]', String(error?.message || error).slice(0, 160));
      render(container, target);
    }
  }

  function submission(targetValue, container) {
    const target = normalizedTarget(targetValue);
    const values = container ? fields(container) : { ...recordFor(target) };
    if (!String(values.body || '').trim()) return null;
    if (!CHAT_VISIBLE_MODES.has(values.read_mode)) return null;
    return {
      ...target,
      body: values.body,
      true_core: values.true_core,
      weather: values.weather,
      read_mode: values.read_mode,
      snapshot_id: `dogtalk-snapshot-${crypto.randomUUID()}`,
    };
  }

  function syncCrossSelections(container, state) {
    if (!state.limits) return;
    const next = { ...state.selections };
    for (const checkbox of qa('input[name="cross_message"]', container)) {
      const conversationId = checkbox.dataset.conversationId || '';
      const key = messageSelectionKey(conversationId, checkbox.value);
      next[key] = checkbox.checked && !checkbox.disabled;
    }
    state.selections = next;
  }

  function crossWindowSubmission(targetValue, container) {
    const target = normalizedTarget(targetValue);
    const state = crossFor(target);
    if (container) syncCrossSelections(container, state);
    if (state.mode === 'model_decides') return { mode: 'model_decides', sources: [], messages: [] };
    if (state.mode === 'keyword') return { mode: 'keyword', sources: [], messages: [] };
    if (state.mode !== 'manual') return { mode: 'off', sources: [], messages: [] };
    const messages = [];
    for (const source of state.sources) {
      for (const turn of Array.isArray(source.turns) ? source.turns : []) {
        for (const message of Array.isArray(turn.messages) ? turn.messages : []) {
          const key = messageSelectionKey(source.conversation_id, message.message_id);
          if (state.selections[key] === true) messages.push({ conversation_id: source.conversation_id, message_id: message.message_id });
        }
      }
    }
    return { mode: 'manual', sources: [], messages };
  }

  function resetCrossWindow(targetValue) {
    const target = normalizedTarget(targetValue);
    const old = crossFor(target);
    crossWindows.set(targetKey(target), { ...emptyCrossWindow(), sources: old.sources, limits: old.limits });
  }

  async function savePanel(container) {
    const target = targetFrom(container);
    const current = recordFor(target);
    const values = fields(container);
    if (!values.body.trim()) {
      toast('不写也完全可以；写一点私人草稿后再保存就好。');
      return null;
    }
    const data = await requestJson(API.dogtalk, {
      method: 'PUT',
      body: JSON.stringify({
        ...target,
        ...values,
        id: current.id || undefined,
        status: 'saved',
      }),
    });
    records.set(targetKey(target), data.dogtalk || emptyDogtalk());
    render(container, target, { open: true });
    toast(values.read_mode === 'keep_private'
      ? '私人草稿收好了，只留在小抽屉里。'
      : '私人草稿已经放进小抽屉。');
    return data.dogtalk;
  }

  async function handleAction(name, target) {
    const container = panelFrom(target);
    if (!container) return;
    const scope = targetFrom(container);
    const cross = crossFor(scope);
    if (name === 'save') return savePanel(container);
    if (name === 'tab') {
      syncCrossSelections(container, cross);
      cross.tab = ['cross', 'keyword'].includes(target.dataset.tab) ? target.dataset.tab : 'dogtalk';
      render(container, scope, { open: true });
      if (cross.tab === 'cross') return fetchCrossSources(container);
      return;
    }
    if (name === 'cross-mode') {
      syncCrossSelections(container, cross);
      cross.mode = CROSS_MODES[target.dataset.mode] ? target.dataset.mode : 'off';
      render(container, scope, { open: true });
      if (cross.mode === 'manual') return fetchCrossSources(container);
    }
    if (name === 'cross-source-toggle') {
      syncCrossSelections(container, cross);
      const id = String(target.dataset.conversationId || '');
      cross.expandedSources = { ...cross.expandedSources, [id]: cross.expandedSources[id] !== true };
      render(container, scope, { open: true });
      return;
    }
    if (name === 'cross-turn-toggle') {
      syncCrossSelections(container, cross);
      const key = turnExpansionKey(String(target.dataset.conversationId || ''), String(target.dataset.turnId || ''));
      cross.expandedTurns = { ...cross.expandedTurns, [key]: cross.expandedTurns[key] !== true };
      render(container, scope, { open: true });
      return;
    }
    if (name === 'keyword-toggle') {
      syncCrossSelections(container, cross);
      cross.mode = cross.mode === 'keyword' ? 'off' : 'keyword';
      render(container, scope, { open: true });
      return;
    }
  }

  function ownsEvent(_event, context) {
    return context.eventType === 'click' && context.namespace === 'dogtalk'
      ? { preventDefault: true }
      : false;
  }

  function handleEvent(event, context) {
    return handleAction(context.name, context.target, event);
  }

  function mount() {}
  function refresh() {}
  function destroy() {}

  return Object.freeze({
    id: 'dogtalk',
    priority: 60,
    mountOrder: 60,
    ownsEvent,
    handleEvent,
    mount,
    refresh,
    destroy,
    fetchScope,
    fetchCrossSources,
    mountComposer,
    submission,
    crossWindowSubmission,
    resetCrossWindow,
    handleAction,
  });
}
