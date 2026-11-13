import { escapeAttribute, escapeHtml, q } from '../../core/dom.js';
import { normalizeContextSettings } from '../chat-state.js';

const WEB_REALITY_FIELDS = Object.freeze([
  ['date', '日期', '今天是哪一天', true],
  ['time', '时间', '当前本地时间与时区', true],
  ['weather', '天气', '按手动城市读取当前天气', true],
  ['calendar', '未来 7 天日历', '读取当前日历中的重要日期', true],
  ['battery', '电量', '由 Native 读取设备电量', false],
  ['location', '位置', '由 Native 读取粗粒度城市 / 区域', false],
  ['recent_app', '最近使用 App', '由 Native 读取进入应用前的最近 App', false],
  ['app_usage', '今日 App 使用时间', '由 Native 读取今日使用最多的前 5 个 App', false],
  ['steps', '步数', '由 Native 读取轻量系统计步', false],
]);

function switchRow({ field = '', title, note, checked = false, enabled = true, action, extra = '' }) {
  const attrs = [
    'type="button"',
    'class="window-context-row"',
    action ? `data-action="${escapeAttribute(action)}"` : '',
    field ? `data-field="${escapeAttribute(field)}"` : '',
    `aria-pressed="${checked ? 'true' : 'false'}"`,
    enabled ? '' : 'disabled',
  ].filter(Boolean).join(' ');
  return `<button ${attrs}>
    <span class="window-context-copy">
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(note)}</small>
    </span>
    ${extra}
    <span class="window-context-switch ${checked ? 'is-on' : ''}" aria-hidden="true"><span></span></span>
  </button>`;
}

export function createChatWindowSettings({
  runtime,
  currentHistory,
  setHistory,
  saveHistory,
  renderConversationList,
  renderMessages,
  toast,
}) {
  let root = null;

  function activeConversation() {
    return runtime.conversations.find((item) => item.id === runtime.currentId) || null;
  }

  function isUnavailableConversation() {
    return activeConversation()?.source === 'rikkahub';
  }

  function render() {
    if (!root) return;
    const state = currentHistory();
    const settings = normalizeContextSettings(state.context_settings);
    const locked = isUnavailableConversation();
    const fields = new Set(settings.reality_fields);

    const rows = WEB_REALITY_FIELDS.map(([field, title, note, webEnabled]) => {
      const enabled = !locked && webEnabled;
      const effectiveNote = webEnabled ? note : `${note} · 仅 Native 可用`;
      const extra = webEnabled ? '' : '<span class="window-context-lock">Native</span>';
      return switchRow({
        field,
        title,
        note: effectiveNote,
        checked: fields.has(field),
        enabled,
        action: enabled ? 'chat:window-reality-field' : '',
        extra,
      });
    }).join('');

    root.innerHTML = `
      <button class="window-context-backdrop" type="button" data-action="chat:window-settings-close" aria-label="关闭窗口设置"></button>
      <section class="window-context-sheet" role="dialog" aria-modal="true" aria-labelledby="windowContextTitle">
        <header class="window-context-header">
          <div>
            <h2 id="windowContextTitle">这个窗口</h2>
            <p>只改变当前聊天窗口。屏幕显示的时间不等于模型自动知道时间。</p>
          </div>
          <button class="window-context-close" type="button" data-action="chat:window-settings-close" aria-label="关闭">×</button>
        </header>
        <div class="window-context-scroll">
          <section class="window-context-card">
            ${switchRow({
              title: '现实注入',
              note: settings.reality_enabled ? '当前窗口按下方选择读取现实信息' : '关闭时不自动递入现实信息',
              checked: settings.reality_enabled,
              enabled: !locked,
              action: !locked ? 'chat:window-reality-master' : '',
            })}
            <div class="window-context-fields ${settings.reality_enabled ? '' : 'is-muted'}">
              ${rows}
              <div class="window-weather-city ${fields.has('weather') ? '' : 'is-hidden'}">
                <label for="windowWeatherCity">天气城市</label>
                <div>
                  <input id="windowWeatherCity" type="text" maxlength="80" value="${escapeAttribute(settings.weather_city)}" placeholder="例如：太原">
                  <button type="button" data-action="chat:window-weather-save" ${locked ? 'disabled' : ''}>保存</button>
                </div>
                <small>只按这里的城市取天气，不按 VPN / IP 猜位置。</small>
              </div>
            </div>
          </section>

          <section class="window-context-card">
            ${switchRow({
              title: '短句模式',
              note: '独立于现实注入。普通闲聊优先简短接话，深话题仍可自然变长。',
              checked: settings.short_reply_mode,
              enabled: !locked,
              action: !locked ? 'chat:window-short-mode' : '',
            })}
            <button class="window-context-link" type="button" data-action="chat:window-soil-open" ${locked ? 'disabled' : ''}>
              <span><strong>整理当前对话的纸条</strong><small>打开当前窗口的总结与记忆候选。</small></span><span>›</span>
            </button>
          </section>

          <section class="window-context-card window-context-note">
            <strong>PWA 与 Native 的边界</strong>
            <p>日期、时间、天气和未来 7 天日历可在 PWA 直接设置。电量、位置、最近 App、App 使用时间与步数只由 Native 采集，所以这里固定显示但不能修改。</p>
          </section>

          <button class="window-context-letter" type="button" data-action="chat:window-letter-open">登岛信</button>
        </div>
      </section>`;
  }

  function open() {
    if (!root) root = q('#windowContextOverlay');
    if (!root) return;
    render();
    root.hidden = false;
  }

  function close() {
    if (root) root.hidden = true;
  }

  async function writeSettings(nextSettings) {
    if (!runtime.currentId || isUnavailableConversation()) return;
    const previous = currentHistory();
    const next = { ...previous, context_settings: normalizeContextSettings(nextSettings) };
    setHistory(runtime.currentId, next);
    renderConversationList();
    renderMessages(runtime.currentId);
    render();
    try {
      await saveHistory(runtime.currentId, next);
    } catch (error) {
      setHistory(runtime.currentId, previous);
      renderConversationList();
      renderMessages(runtime.currentId);
      render();
      toast(`窗口设置保存失败：${error.message}`);
    }
  }

  async function handleAction(name, target) {
    if (name === 'window-settings') return open();
    if (name === 'window-settings-close') return close();
    if (name === 'window-soil-open') {
      close();
      return runtime.memory?.handleAction?.('soil-open', { dataset: { conversationId: runtime.currentId } });
    }
    if (name === 'window-letter-open') {
      close();
      return runtime.letters?.handleAction?.('open');
    }

    const state = currentHistory();
    const settings = normalizeContextSettings(state.context_settings);

    if (name === 'window-reality-master') {
      return writeSettings({ ...settings, reality_enabled: !settings.reality_enabled });
    }
    if (name === 'window-short-mode') {
      return writeSettings({ ...settings, short_reply_mode: !settings.short_reply_mode });
    }
    if (name === 'window-reality-field') {
      const field = String(target.dataset.field || '');
      const allowed = WEB_REALITY_FIELDS.find(([key]) => key === field)?.[3] === true;
      if (!allowed) return;
      const fields = new Set(settings.reality_fields);
      if (fields.has(field)) fields.delete(field); else fields.add(field);
      return writeSettings({ ...settings, reality_fields: [...fields] });
    }
    if (name === 'window-weather-save') {
      const input = q('#windowWeatherCity');
      const weatherCity = String(input?.value || '').trim().slice(0, 80);
      return writeSettings({ ...settings, weather_city: weatherCity });
    }
  }

  return Object.freeze({ open, close, render, handleAction });
}
