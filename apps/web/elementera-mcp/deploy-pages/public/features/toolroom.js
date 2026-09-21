import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml } from '../core/dom.js';

function option(value, label, current) {
  return `<option value="${escapeAttribute(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function safeSummary(value) {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return '—'; }
}

function localApiUrl(path) {
  return new URL(path, globalThis.location?.origin || 'https://elementera.invalid');
}

export function createToolroom({ chat, router }) {
  const state = { tools: [], runs: [], filters: { status: '', toolKey: '', conversationId: '', runIds: [] } };
  let root = null;

  function ownsRoute(route) {
    return route?.name === 'toolroom';
  }

  function syncRoot(route) {
    root ||= globalThis.document?.querySelector?.('#overlayRoot') || null;
    if (!root) return;
    if (ownsRoute(route)) root.dataset.controllerOwner = 'toolroom';
    else if (root.dataset.controllerOwner === 'toolroom') delete root.dataset.controllerOwner;
  }

  function applyParams(params = {}) {
    state.filters = {
      status: String(params.status || state.filters.status || ''),
      toolKey: String(params.toolKey || state.filters.toolKey || ''),
      conversationId: String(params.conversationId ?? state.filters.conversationId ?? ''),
      runIds: Array.isArray(params.runIds)
        ? params.runIds.map(String).filter(Boolean).slice(0, 32)
        : state.filters.runIds,
    };
  }

  async function load(params = {}) {
    applyParams(params);
    const conversation = state.filters.conversationId || chat.getCurrentConversationId() || '';
    const toolsUrl = localApiUrl(API.workbenchTools);
    toolsUrl.searchParams.set('conversation_id', conversation);
    toolsUrl.searchParams.set('surface', 'main_chat');
    const runsUrl = localApiUrl(API.workbenchRuns);
    runsUrl.searchParams.set('limit', '100');
    if (state.filters.status) runsUrl.searchParams.set('status', state.filters.status);
    if (state.filters.toolKey) runsUrl.searchParams.set('tool_key', state.filters.toolKey);
    if (state.filters.conversationId) runsUrl.searchParams.set('conversation_id', state.filters.conversationId);
    if (state.filters.runIds.length) runsUrl.searchParams.set('ids', state.filters.runIds.join(','));
    const [tools, runs] = await Promise.all([
      requestJson(`${toolsUrl.pathname}${toolsUrl.search}`),
      requestJson(`${runsUrl.pathname}${runsUrl.search}`),
    ]);
    state.tools = tools.tools || [];
    state.runs = runs.runs || [];
  }

  function runRow(run) {
    const furniture = state.tools.find((tool) => tool.tool_key === run.tool_key)?.display_name || run.tool_key;
    const room = [run.room_scope, run.conversation_id].filter(Boolean).join(' · ') || '—';
    return `<details class="tool-run is-${escapeAttribute(run.status)}">
      <summary><span><strong>${escapeHtml(furniture)}</strong><small>${escapeHtml(room)} · ${escapeHtml(new Date(run.created_at).toLocaleString())}</small></span><i>${escapeHtml(run.status)}</i></summary>
      <div class="tool-run-detail">
        <dl>
          <div><dt>tool_key</dt><dd>${escapeHtml(run.tool_key)}</dd></div>
          <div><dt>状态</dt><dd>${escapeHtml(run.status)}</dd></div>
          <div><dt>房间 / room_scope</dt><dd>${escapeHtml(run.room_scope || '—')}</dd></div>
          <div><dt>conversation_id</dt><dd>${escapeHtml(run.conversation_id || '—')}</dd></div>
          <div><dt>创建时间</dt><dd>${escapeHtml(run.created_at || '—')}</dd></div>
          <div><dt>完成时间</dt><dd>${escapeHtml(run.finished_at || '—')}</dd></div>
        </dl>
        <section><h3>脱敏 input 摘要</h3><pre>${escapeHtml(safeSummary(run.input_summary))}</pre></section>
        <section><h3>脱敏 output 摘要</h3><pre>${escapeHtml(safeSummary(run.output_summary))}</pre></section>
        ${run.error_message ? `<section><h3>错误信息</h3><pre>${escapeHtml(run.error_message)}</pre></section>` : ''}
      </div>
    </details>`;
  }

  async function view(params = {}) {
    await load(params);
    const toolOptions = state.tools.map((tool) => option(tool.tool_key, tool.display_name, state.filters.toolKey)).join('');
    const focused = state.filters.runIds.length
      ? `<p class="feature-note">来自本轮工具 · ${state.filters.runIds.length} 个 run id</p><button class="feature-row" type="button" data-action="toolroom:clear-focus"><span><strong>查看全部行动</strong><small>清除本轮 run id 过滤</small></span></button>`
      : '';
    return {
      title: '工具调用记录',
      subtitle: '模型工作台 · 工具透明层',
      className: 'toolroom-panel',
      headerAction: '<button class="feature-head-action" type="button" data-action="toolroom:refresh">刷新</button>',
      body: `<section class="toolroom-filters"><h2>筛选</h2><div class="toolroom-filter-grid">
          <label>状态<select data-input="toolroom:status">${option('', '全部状态', state.filters.status)}${option('success', 'success', state.filters.status)}${option('error', 'error', state.filters.status)}${option('running', 'running', state.filters.status)}</select></label>
          <label>家具<select data-input="toolroom:tool">${option('', '全部家具', state.filters.toolKey)}${toolOptions}</select></label>
        </div>${state.filters.conversationId ? `<p class="feature-note">conversation · ${escapeHtml(state.filters.conversationId)}</p>` : ''}${focused}</section>
        <section class="tool-run-list"><h2>行动日志</h2>${state.runs.length ? state.runs.map(runRow).join('') : '<p class="feature-note">当前筛选下还没有家具运行记录。</p>'}</section>`,
    };
  }

  router.register('toolroom', view);

  function handleAction(name, target) {
    if (name === 'open') {
      const runIds = String(target?.dataset?.runIds || '').split(',').map((item) => item.trim()).filter(Boolean);
      const conversationId = String(target?.dataset?.conversationId || '');
      return router.open('toolroom', { runIds, conversationId });
    }
    if (name === 'refresh') return router.refresh({ preserveScroll: false });
    if (name === 'clear-focus') {
      state.filters.runIds = [];
      return router.open('toolroom', { ...state.filters, runIds: [] }, { replace: true });
    }
  }

  function handleInput(name, target) {
    if (name === 'status') state.filters.status = target.value || '';
    else if (name === 'tool') state.filters.toolKey = target.value || '';
    else return;
    return router.open('toolroom', { ...state.filters }, { replace: true });
  }

  function mount(context = {}) {
    root = context.overlayRoot || globalThis.document?.querySelector?.('#overlayRoot') || null;
    syncRoot(router.current());
  }

  function refresh(context = {}) {
    syncRoot(context.navigation?.current || router.current());
  }

  function destroy() {
    if (root?.dataset.controllerOwner === 'toolroom') delete root.dataset.controllerOwner;
    root = null;
  }

  function ownsEvent(_event, context) {
    if (context.namespace !== 'toolroom') return false;
    if (context.eventType === 'click') return { preventDefault: true };
    if (context.eventType === 'input') return true;
    return false;
  }

  function handleEvent(event, context) {
    if (context.eventType === 'click') return handleAction(context.name, context.target, event);
    if (context.eventType === 'input') return handleInput(context.name, context.target, event);
  }

  return Object.freeze({
    id: 'toolroom',
    priority: 45,
    mountOrder: 40,
    ownsRoute,
    ownsEvent,
    handleEvent,
    mount,
    refresh,
    destroy,
    handleAction,
  });
}
