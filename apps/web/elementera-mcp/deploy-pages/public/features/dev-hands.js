import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml } from '../core/dom.js';

const ROUTES = new Set(['dev-hands-home', 'dev-hands-update', 'dev-hands-logs']);

function pretty(value) {
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value ?? ''); }
}
function stateNote(text) { return `<p class="dev-hand-note">${escapeHtml(text)}</p>`; }
function statusPill(label, value) {
  const on = value === true;
  const off = value === false;
  return `<span class="dev-status ${on ? 'is-ok' : off ? 'is-off' : 'is-neutral'}">${escapeHtml(label)} · ${on ? '可用' : off ? '不可用' : '未检查'}</span>`;
}
function card(title, subtitle, action) {
  return `<button class="dev-hand-card" type="button" data-action="${escapeAttribute(action)}"><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span><i>›</i></button>`;
}
function toolPacks(tools) {
  const groups = new Map();
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (tool.model_group !== 'devhand') continue;
    const pack = String(tool.tool_pack || '开发手');
    const list = groups.get(pack) || [];
    list.push(String(tool.model_name || tool.display_name || tool.tool_key || 'tool'));
    groups.set(pack, list);
  }
  return [...groups.entries()];
}
function logRows(logs) {
  if (!logs.length) return stateNote('还没有开发手调用记录。直接在聊天里让模型看仓库、改代码、查 CI 或写 Notion，脚印会出现在这里。');
  return logs.map((run) => `<details class="dev-log is-${escapeAttribute(run.status || 'unknown')}"><summary><span><strong>${escapeHtml(run.action_name || '开发手')}</strong><small>${escapeHtml(run.target_system || '开发手')} · ${escapeHtml(run.target_ref || '—')} · ${escapeHtml(run.created_at || '')}</small></span><i>${escapeHtml(run.status || 'unknown')}</i></summary><div><p><b>动作类型：</b>${escapeHtml(run.operation_type || '—')}</p>${run.output_summary ? `<pre>${escapeHtml(pretty(run.output_summary))}</pre>` : ''}${run.error_summary ? `<p class="dev-hand-error">${escapeHtml(run.error_summary)}</p>` : ''}</div></details>`).join('');
}

export function createDevHands({ router, toast, chat = null }) {
  const state = {
    tools: null,
    selfCheck: null,
    update: null,
    logs: null,
    loading: false,
    error: '',
  };
  let root = null;

  function ownsRoute(route) { return ROUTES.has(route?.name || ''); }
  function syncRoot(route) {
    root ||= globalThis.document?.querySelector?.('#overlayRoot') || null;
    if (!root) return;
    if (ownsRoute(route)) root.dataset.controllerOwner = 'devhands';
    else if (root.dataset.controllerOwner === 'devhands') delete root.dataset.controllerOwner;
  }
  function currentConversationId() { return chat?.getCurrentConversationId?.() || ''; }

  async function loadTools(force = false) {
    if (state.tools && !force) return state.tools;
    const data = await requestJson(`${API.workbenchTools}?surface=main_chat`);
    state.tools = Array.isArray(data.tools) ? data.tools : [];
    return state.tools;
  }
  async function loadSelfCheck(force = false) {
    if (state.selfCheck && !force) return state.selfCheck;
    const data = await requestJson(API.devSelfCheck);
    state.selfCheck = data;
    return data;
  }
  async function loadLogs(force = false) {
    if (state.logs && !force) return state.logs;
    const query = new URLSearchParams({ limit: '80' });
    const data = await requestJson(`${API.devLogs}?${query.toString()}`);
    state.logs = Array.isArray(data.runs) ? data.runs : [];
    return state.logs;
  }
  async function loadUpdate(force = false) {
    if (state.update && !force) return state.update;
    const data = await requestJson(API.devUpdate);
    state.update = data.update || {};
    return state.update;
  }
  async function refreshHome({ selfCheck = false } = {}) {
    state.loading = true;
    state.error = '';
    try {
      const tasks = [loadTools(true), loadLogs(true)];
      if (selfCheck) tasks.push(loadSelfCheck(true));
      await Promise.all(tasks);
    } catch (error) {
      state.error = error?.message || '开发手状态读取失败。';
    } finally {
      state.loading = false;
    }
  }

  async function homeView() {
    if (!state.tools || !state.logs) await refreshHome();
    const packs = toolPacks(state.tools || []);
    const devToolCount = packs.reduce((sum, [, tools]) => sum + tools.length, 0);
    const logs = state.logs || [];
    const success = logs.filter((run) => run.status === 'success').length;
    const failure = logs.filter((run) => run.status === 'error').length;
    const check = state.selfCheck;
    return {
      title: '海岸开发手',
      subtitle: '模型随身工具 · 观察窗',
      className: 'dev-hands-panel',
      headerAction: '<button class="feature-head-action" type="button" data-action="devhands:self-check">自检</button>',
      body: `<section class="dev-paper-card dev-hand-hero"><strong>开发手默认随身</strong><p>普通 owner 聊天会直接把 GitHub、Notion、CI、APK 与屋主设置工具交给当前模型。没有施工模式、工具包开关、pending、确认卡或危险锁柜。</p><p class="dev-hand-note">模型需要时自己调用；不需要时正常聊天。仓库 allowlist、Notion root 与 secret 脱敏仍由后端真实边界负责。</p></section>${check ? `<section class="dev-paper-card"><div class="dev-status-row">${statusPill('GitHub', check.github?.github_token_present && check.github?.repo_metadata_readable)}${statusPill('Notion', check.notion?.notion_token_present && check.notion?.root_page_readable)}</div><p>release：${escapeHtml(check.release || '—')} · 默认开发手：${check.model_tools_default === true ? '是' : '否'}</p></section>` : stateNote('需要时点右上角“自检”检查 GitHub / Notion 连接；它不是工具开关。')}<section class="dev-paper-card"><strong>模型当前可见</strong><p>${devToolCount} 个开发手 schema，直接随 owner 聊天递给模型。</p>${packs.map(([pack, tools]) => `<details class="dev-tool-pack"><summary>${escapeHtml(pack)} · ${tools.length}</summary><p class="dev-mono">${tools.map(escapeHtml).join(' · ')}</p></details>`).join('')}</section><section class="dev-paper-card"><strong>最近脚印</strong><p>最近 ${logs.length} 次开发手动作 · 成功 ${success} · 失败 ${failure}</p></section>${card('施工脚印', '查看模型真实调用、结果与失败原因', 'devhands:logs')}${card('版本与更新', 'PWA / Native / APK / SHA-256', 'devhands:update')}${state.error ? `<p class="dev-hand-error">${escapeHtml(state.error)}</p>` : ''}`,
    };
  }

  async function logsView() {
    await loadLogs();
    const logs = state.logs || [];
    const success = logs.filter((run) => run.status === 'success').length;
    const failure = logs.filter((run) => run.status === 'error').length;
    return {
      title: '施工脚印',
      subtitle: '真实开发手调用记录',
      className: 'dev-hands-panel',
      headerAction: '<button class="feature-head-action" type="button" data-action="devhands:refresh-logs">刷新</button>',
      body: `<section class="dev-paper-card"><strong>使用了 ${logs.length} 件工具</strong><p>成功 ${success} · 失败 ${failure}</p><p class="dev-hand-note">这里不显示 token、secret、cookie、env、authorization header 或 keystore。</p></section><section class="dev-log-list">${logRows(logs)}</section>${state.error ? `<p class="dev-hand-error">${escapeHtml(state.error)}</p>` : ''}`,
    };
  }

  async function updateView() {
    try { await loadUpdate(); }
    catch (error) { state.error = error?.message || '更新信息读取失败。'; }
    const update = state.update || {};
    const native = update.native || {};
    const available = update.available === true;
    return {
      title: '版本与更新',
      subtitle: '屋主设置 · 后端更新源',
      className: 'dev-hands-panel',
      headerAction: '<button class="feature-head-action" type="button" data-action="devhands:refresh-update">刷新</button>',
      body: `<section class="dev-update-card ${available ? '' : 'is-empty'}"><span class="dev-update-kicker">${escapeHtml(update.release || 'Elementera Coast')}</span><h2>${escapeHtml(native.version_name || '暂无可下载 Native Release')}</h2><div class="dev-update-facts"><p><b>PWA cache</b><span>${escapeHtml(update.pwa_cache_version || '未知')}</span></p><p><b>versionCode</b><span>${escapeHtml(native.version_code ?? '—')}</span></p><p><b>applicationId</b><span>${escapeHtml(native.application_id || '—')}</span></p><p><b>稳定签名</b><span>${native.stable_signing === true ? '是' : native.stable_signing === false ? '否' : '—'}</span></p><p><b>可覆盖安装</b><span>${native.overwrite_installable === true ? '是' : native.overwrite_installable === false ? '否' : '—'}</span></p><p><b>APK SHA-256</b><span class="dev-mono">${escapeHtml(native.apk_sha256 || '—')}</span></p><p><b>交付来源</b><span>Source build</span></p><p><b>Release</b><span>—</span></p><p><b>APK</b><span>${escapeHtml(native.apk_filename || '—')}</span></p><p><b>更新时间</b><span>${escapeHtml(native.update_time || native.release_published_at || '—')}</span></p></div>${native.update_notes ? `<p class="dev-update-notes">${escapeHtml(native.update_notes)}</p>` : ''}${native.known_risk ? `<p class="dev-update-risk">${escapeHtml(native.known_risk)}</p>` : ''}<p class="dev-hand-note">${escapeHtml(update.reason || state.error || 'Source build 不包含生产 APK updater。')}</p></section>`,
    };
  }

  router.register('dev-hands-home', homeView);
  router.register('dev-hands-logs', logsView);
  router.register('dev-hands-update', updateView);

  async function handleAction(name) {
    if (name === 'open') return router.open('dev-hands-home');
    if (name === 'logs') return router.open('dev-hands-logs');
    if (name === 'update') return router.open('dev-hands-update');
    if (name === 'self-check') {
      await refreshHome({ selfCheck: true });
      if (state.selfCheck) toast('开发手自检完成。');
      return router.refresh({ preserveScroll: true });
    }
    if (name === 'refresh-logs') {
      state.error = '';
      try { await loadLogs(true); }
      catch (error) { state.error = error?.message || '施工脚印读取失败。'; }
      return router.refresh({ preserveScroll: false });
    }
    if (name === 'refresh-update') {
      state.error = '';
      try { await loadUpdate(true); }
      catch (error) { state.error = error?.message || '更新信息读取失败。'; }
      return router.refresh({ preserveScroll: true });
    }
    return null;
  }

  function ownsEvent(_event, context) {
    if (context.eventType !== 'click' || context.namespace !== 'devhands') return false;
    return { preventDefault: true };
  }
  function handleEvent(_event, context) { return handleAction(context.name); }
  function mount(context = {}) { root = context.overlayRoot || globalThis.document?.querySelector?.('#overlayRoot') || null; syncRoot(router.current()); }
  function refresh(context = {}) { syncRoot(context.navigation?.current || router.current()); }
  function destroy() {
    if (root?.dataset.controllerOwner === 'devhands') delete root.dataset.controllerOwner;
    root = null;
  }

  return Object.freeze({
    id: 'devhands',
    priority: 58,
    mountOrder: 48,
    ownsRoute,
    ownsEvent,
    handleEvent,
    mount,
    refresh,
    destroy,
    handleAction,
    currentConversationId,
  });
}
