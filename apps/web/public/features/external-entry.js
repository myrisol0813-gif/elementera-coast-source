import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml } from '../core/dom.js';

const CHANNEL_LABELS = Object.freeze({
  external: '外部入口消息',
  api_common_room: '官端 MCP 与 API 共通聊天室',
  official_mcp: '与官端 MCP 对话区',
});

function channelOptions(selected = '') {
  return Object.entries(CHANNEL_LABELS).map(([id, label]) =>
    `<option value="${escapeAttribute(id)}" ${selected === id ? 'selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

function renderContractTools(contract) {
  const tools = Array.isArray(contract?.tools) ? contract.tools : [];
  if (!tools.length) return '<p class="feature-empty">当前没有可展示的 MCP contract。</p>';
  return tools.map((tool) =>
    `<div class="feature-row static"><span><strong>${escapeHtml(tool.name)}</strong><small>${escapeHtml(tool.description || '')}</small></span></div>`
  ).join('');
}

function renderMessages(items) {
  if (!items.length) return '<p class="feature-empty">当前没有外部入口消息。</p>';
  return items.map((item) => `<article>
    <header><strong>${escapeHtml(CHANNEL_LABELS[item.channel] || item.channel)}</strong><small>${escapeHtml(item.created_at || '')}</small></header>
    <p>${escapeHtml(item.content)}</p>
    <footer>${escapeHtml(item.author || '未标注来源')}${item.conversation_id ? ` · ${escapeHtml(item.conversation_id)}` : ''}</footer>
  </article>`).join('');
}

export function createExternalEntry({ router, toast }) {
  const state = { messages: [], status: null, contract: null, channel: '' };

  async function load() {
    const suffix = state.channel
      ? `?channel=${encodeURIComponent(state.channel)}&limit=100`
      : '?limit=100';
    const [messages, status, contract] = await Promise.all([
      requestJson(`${API.externalMessages}${suffix}`),
      requestJson(API.externalStatus),
      requestJson(API.externalMcpContract),
    ]);
    state.messages = Array.isArray(messages.messages) ? messages.messages : [];
    state.status = status;
    state.contract = contract.contract || null;
  }

  async function view() {
    await load();
    return {
      title: '外部入口消息',
      subtitle: '外部入口同步 / 取信 · source-safe',
      className: 'external-entry-panel',
      headerAction: '<button class="feature-head-action" type="button" data-action="external:refresh">刷新</button>',
      body: `
        <section class="feature-group">
          <h2>入口状态</h2>
          <div class="feature-card">
            <div class="feature-row static"><span><strong>source ingress contract</strong><small>默认仅已登录屋主可用；不包含生产认证、远端地址或历史数据。</small></span></div>
          </div>
        </section>
        <section class="feature-group">
          <h2>MCP source contract</h2>
          <div class="feature-card">
            <div class="feature-row static"><span><strong>${escapeHtml(state.contract?.authentication || 'bring_your_own_adapter')}</strong><small>transport · ${escapeHtml(state.contract?.transport || 'adapter_defined')}</small></span></div>
            ${renderContractTools(state.contract)}
          </div>
        </section>
        <section class="feature-group">
          <h2>手动 ingress 测试</h2>
          <form class="feature-card external-send-form" data-submit="external:send">
            <label>入口<select name="channel">${channelOptions('external')}</select></label>
            <label>来源名<input name="author" maxlength="120" placeholder="Source adapter"></label>
            <label>消息<textarea name="content" rows="4" maxlength="12000" required></textarea></label>
            <label class="external-checkbox"><input type="checkbox" name="deliver_to_room" checked> 同步到对应聊天房间</label>
            <button class="primary-wide" type="submit">写入 source ingress</button>
          </form>
        </section>
        <section class="external-filter">
          <label>来源<select data-input="external:channel"><option value="">全部入口</option>${channelOptions(state.channel)}</select></label>
        </section>
        <section class="external-message-list">${renderMessages(state.messages)}</section>
      `,
    };
  }

  router.register('external-entry', view);

  function handleAction(name) {
    if (name === 'open') return router.open('external-entry');
    if (name === 'refresh') {
      toast('外部入口状态已刷新');
      return router.refresh({ preserveScroll: true });
    }
  }

  function handleInput(name, target) {
    if (name !== 'channel') return;
    state.channel = target.value || '';
    return router.refresh({ preserveScroll: false });
  }

  async function handleSubmit(name, target) {
    if (name !== 'send') return;
    const data = new FormData(target);
    await requestJson(API.externalMessages, {
      method: 'POST',
      body: JSON.stringify({
        channel: String(data.get('channel') || 'external'),
        author: String(data.get('author') || ''),
        content: String(data.get('content') || ''),
        deliver_to_room: data.get('deliver_to_room') === 'on',
      }),
    });
    target.reset();
    toast('source ingress 已写入');
    return router.refresh({ preserveScroll: false });
  }

  return Object.freeze({
    id: 'external',
    priority: 53,
    mountOrder: 53,
    ownsRoute: (route) => route?.name === 'external-entry',
    ownsEvent(_event, context) {
      if (context.namespace !== 'external') return false;
      if (context.eventType === 'click' || context.eventType === 'submit') return { preventDefault: true };
      if (context.eventType === 'input') return true;
      return false;
    },
    handleEvent(_event, context) {
      if (context.eventType === 'click') return handleAction(context.name);
      if (context.eventType === 'submit') return handleSubmit(context.name, context.target);
      return handleInput(context.name, context.target);
    },
    handleAction,
    mount() {},
    refresh() {},
    destroy() {},
  });
}
