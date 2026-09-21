import { API, ApiError, requestJson } from './core/api.js';
import { confirmDanger } from './core/danger.js';
import { escapeAttribute, escapeHtml, formatRichText, q } from './core/dom.js';
import { hydrateIconSlots, icon } from './core/icons.js';

function emptyThoughtSoil(visitorId = '') {
  return {
    visitor_id: visitorId,
    current_text: '',
    hand_seeds: [],
    do_not_repeat: '',
    pocket_candidates: [],
    revision: 1,
    model_label: null,
    model_nickname: null,
    updated_at: null,
  };
}

function emptyMemory(visitorId = '') {
  return {
    thought_soil: emptyThoughtSoil(visitorId),
    pending_pockets: [],
    entries: [],
  };
}

const state = {
  visitor: null,
  messages: [],
  status: null,
  memory: emptyMemory(),
  loading: false,
  activePanel: null,
};

let toastTimer = 0;

function toast(message, duration = 2200) {
  const root = q('#mailboxToast');
  if (!root) return;
  root.textContent = message;
  root.hidden = !message;
  clearTimeout(toastTimer);
  if (message) toastTimer = setTimeout(() => { root.hidden = true; }, duration);
}

function timeLabel(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function actionButton(action, title) {
  const iconName = {
    copy: 'copy',
    edit: 'edit',
    delete: 'trash',
  }[action];
  return `<button class="action-button" type="button" data-mailbox-action="${escapeAttribute(action)}" title="${escapeAttribute(title)}" aria-label="${escapeAttribute(title)}">${icon(iconName)}</button>`;
}

function visitorMessage(message) {
  const statusLabel = message.status === 'waiting_for_myri'
    ? '已送达 · 等待巡灯'
    : message.status === 'replied'
      ? '已回信'
      : '已送达';
  return `<article class="message user" data-message-id="${escapeAttribute(message.id)}">
    <div class="content">
      <div class="user-bubble">${escapeHtml(message.content)}</div>
      <small class="mailbox-message-meta">${escapeHtml(timeLabel(message.created_at))} · ${escapeHtml(statusLabel)}</small>
      <div class="message-actions">
        ${actionButton('edit', '编辑')}${actionButton('delete', '删除')}
      </div>
    </div>
  </article>`;
}

function myriMessage(message) {
  return `<article class="message assistant mailbox-myri-message" data-message-id="${escapeAttribute(message.id)}">
    <div class="avatar mailbox-myri-avatar" aria-hidden="true"></div>
    <div class="content">
      <div class="assistant-text">${formatRichText(message.content)}</div>
      <small class="mailbox-message-meta">Model Partner · ${escapeHtml(timeLabel(message.created_at))}</small>
      <div class="message-actions">
        ${actionButton('copy', '复制')}${actionButton('delete', '删除')}
      </div>
    </div>
  </article>`;
}

function systemMessage(message) {
  return `<article class="mailbox-system-message" data-message-id="${escapeAttribute(message.id)}">
    ${escapeHtml(message.content)}
  </article>`;
}

function thoughtSoilEntry() {
  const soil = state.memory.thought_soil || emptyThoughtSoil(state.visitor?.visitor_id);
  const handSeeds = Array.isArray(soil.hand_seeds) ? soil.hand_seeds : [];
  return `<div class="thought-soil-row"><button class="thought-soil-entry" type="button" data-panel="soil">整理当前对话的纸条 · ${Math.min(handSeeds.length, 7)} 粒当前活跃线索 <span aria-hidden="true">›</span></button></div>`;
}

function renderMessages() {
  const root = q('#mailboxMessages');
  if (!root) return;
  if (!state.messages.length) {
    root.innerHTML = '<div class="empty-state">这里还没有来信。你可以把第一封信投进海岸。</div>';
    return;
  }
  const latestModelPartnerMessage = [...state.messages].reverse().find((message) => message.role === 'myri');
  root.innerHTML = state.messages.map((message) => {
    const body = message.role === 'visitor'
      ? visitorMessage(message)
      : message.role === 'myri'
        ? myriMessage(message)
        : systemMessage(message);
    return message.id === latestModelPartnerMessage?.id ? thoughtSoilEntry() + body : body;
  }).join('');
  requestAnimationFrame(() => {
    const scroller = q('#mailboxMessageScroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
}

function renderStatus() {
  const status = state.status || {};
  const textNode = q('#mailboxStatusText');
  const metaNode = q('#mailboxStatusMeta');
  if (!textNode || !metaNode) return;
  if (Number(status.pending_count || 0) > 0) {
    textNode.textContent = '已送达灯塔，等待另一位屋主查看。';
    metaNode.textContent = `${status.pending_count} 封来信正在等待 · 现在是慢速回信模式，不是实时聊天。`;
    return;
  }
  if (status.last_myri_reply_at) {
    textNode.textContent = '回信已经抵达。';
    metaNode.textContent = `最近回信：${timeLabel(status.last_myri_reply_at)} · 你可以继续写下一封。`;
    return;
  }
  textNode.textContent = '现在是慢速回信模式，不是实时聊天。';
  metaNode.textContent = '屋主知道谁来过，但默认不知道你具体写了什么。';
}

function showLoadingStatus(message) {
  const textNode = q('#mailboxStatusText');
  const metaNode = q('#mailboxStatusMeta');
  if (textNode) textNode.textContent = message;
  if (metaNode) metaNode.textContent = '信箱会诚实地显示送达与等待状态。';
}

function handleSessionError(error) {
  if (error instanceof ApiError && error.status === 401) {
    window.location.replace('/login');
    return true;
  }
  return false;
}

function normalizeMemory(value) {
  return {
    thought_soil: value?.thought_soil || emptyThoughtSoil(state.visitor?.visitor_id),
    pending_pockets: Array.isArray(value?.pending_pockets) ? value.pending_pockets : [],
    entries: Array.isArray(value?.entries) ? value.entries : [],
  };
}

async function fetchMemory() {
  const data = await requestJson(API.mailboxMemory);
  state.memory = normalizeMemory(data.memory);
  return state.memory;
}

async function refreshMailbox({ announce = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const refreshButton = q('#mailboxRefreshButton');
  if (refreshButton) refreshButton.disabled = true;
  if (announce) showLoadingStatus('正在沿灯塔查看回信…');
  try {
    const [messages, status, memory] = await Promise.all([
      requestJson(API.mailboxMessages),
      requestJson(API.mailboxStatus),
      requestJson(API.mailboxMemory),
    ]);
    state.messages = messages.messages || [];
    state.status = status;
    state.memory = normalizeMemory(memory.memory);
    renderMessages();
    renderStatus();
    if (announce) toast('信箱已经刷新。');
  } catch (error) {
    if (!handleSessionError(error)) showLoadingStatus(error.message || '信箱暂时没有同步。');
  } finally {
    state.loading = false;
    if (refreshButton) refreshButton.disabled = false;
  }
}

async function sendMessage() {
  const input = q('#mailboxPromptInput');
  const sendButton = q('#mailboxSendButton');
  const content = String(input?.value || '').trim();
  if (!content || state.loading) return;
  state.loading = true;
  if (sendButton) sendButton.disabled = true;
  showLoadingStatus('信正在送往灯塔…');
  try {
    const result = await requestJson(API.mailboxSend, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    input.value = '';
    input.style.height = '';
    state.messages.push(result.message);
    state.status = {
      ...(state.status || {}),
      pending_count: Number(state.status?.pending_count || 0) + 1,
      last_visitor_message_at: result.message.created_at,
      queue_status: 'pending',
    };
    renderMessages();
    renderStatus();
    toast('信已经投入访客信箱。等待另一位屋主下一次查看。', 3000);
  } catch (error) {
    if (!handleSessionError(error)) {
      renderStatus();
      toast(error.message || '这封信暂时没有送达。', 3000);
    }
  } finally {
    state.loading = false;
    if (sendButton) sendButton.disabled = false;
  }
}

function textBlock(value, empty = '还没有内容。') {
  const content = String(value || '').trim();
  return `<p>${escapeHtml(content || empty).replace(/\n/g, '<br>')}</p>`;
}

function section(title, body) {
  return `<section class="feature-group"><h2>${escapeHtml(title)}</h2><div class="feature-card feature-prose">${body}</div></section>`;
}

function thoughtSoilBody() {
  const soil = state.memory.thought_soil || emptyThoughtSoil(state.visitor?.visitor_id);
  const seeds = Array.isArray(soil.hand_seeds) ? soil.hand_seeds.slice(0, 7) : [];
  const candidates = Array.isArray(soil.pocket_candidates) ? soil.pocket_candidates : [];
  const seedBody = seeds.length
    ? seeds.map((seed) => `<div class="feature-row static"><span><strong>${escapeHtml(seed.name || seed.life_core)}</strong><small>${escapeHtml(seed.life_core || '')}${seed.usage_hint ? `<br>使用：${escapeHtml(seed.usage_hint)}` : ''}${seed.avoid_hint ? `<br>避免：${escapeHtml(seed.avoid_hint)}` : ''}</small></span></div>`).join('')
    : '<p>还没有当前活跃线索。</p>';
  const candidateBody = candidates.length
    ? `${candidates.map((candidate) => `<div class="feature-row static"><span><strong>${escapeHtml(candidate.title || candidate.life_core || '可落袋内容')}</strong><small>${escapeHtml(candidate.life_core || '')}${candidate.source_excerpt ? `<br>来源：${escapeHtml(candidate.source_excerpt)}` : ''}</small></span></div>`).join('')}<p class="feature-note">这些内容只在当前访客的待确认区里；确认前不会成为访客记事。</p>`
    : '<p>还没有可落袋内容。</p>';
  const pending = state.memory.pending_pockets || [];
  const pendingEntry = pending.length
    ? `<section class="feature-group"><div class="feature-card"><button class="feature-row" type="button" data-panel="pockets"><span><strong>待确认区 · ${pending.length}</strong><small>确认后才会进入访客记事本。</small></span><span>›</span></button></div></section>`
    : '';
  const model = [soil.model_label, soil.model_nickname].filter(Boolean).join(' · ') || '尚未整理';
  const provenance = `<p class="feature-note generation-provenance">revision ${Number(soil.revision || 1)} · 整理来源 · ${escapeHtml(model)}${soil.updated_at ? ` · ${escapeHtml(timeLabel(soil.updated_at))}` : ''}</p>`;
  return `${section('当前', textBlock(soil.current_text, '还没有整理当前方向。'))}
    ${section(`当前活跃线索 · ${seeds.length}/7`, seedBody)}
    ${section('勿复读', textBlock(soil.do_not_repeat))}
    ${section('可落袋', candidateBody)}
    ${pendingEntry}${provenance}`;
}

function pendingPocketCard(pocket) {
  return `<article class="feature-card feature-prose mailbox-memory-card" data-pocket-id="${escapeAttribute(pocket.id)}">
    <div class="memory-entry-meta"><span>待确认</span>${pocket.generated_by_model ? `<span>${escapeHtml(pocket.generated_by_model)}</span>` : ''}</div>
    <h2>${escapeHtml(pocket.title || '待确认内容')}</h2>
    <p><strong>生命核：</strong>${escapeHtml(pocket.life_core || '')}</p>
    ${textBlock(pocket.content || pocket.life_core)}
    ${pocket.usage_hint ? `<p><strong>使用：</strong>${escapeHtml(pocket.usage_hint)}</p>` : ''}
    ${pocket.avoid_hint ? `<p><strong>避免：</strong>${escapeHtml(pocket.avoid_hint)}</p>` : ''}
    <p class="feature-note">它还没有进入访客记事本，也不会当作长期记忆使用。</p>
    <div class="mailbox-pocket-actions">
      <button class="primary" type="button" data-mailbox-action="resolve-pocket" data-pocket-action="remember">确认落袋</button>
      <button type="button" data-mailbox-action="resolve-pocket" data-pocket-action="discard">丢弃</button>
    </div>
  </article>`;
}

function memoryEntryCard(entry) {
  const updated = entry.updated_at && entry.updated_at !== entry.created_at
    ? ` · 更新于 ${timeLabel(entry.updated_at)}`
    : '';
  return `<article class="feature-card feature-prose mailbox-memory-card" data-memory-id="${escapeAttribute(entry.id)}">
    <div class="memory-entry-meta"><span>访客记事</span><span>${escapeHtml(timeLabel(entry.created_at))}${escapeHtml(updated)}</span></div>
    <h2>${escapeHtml(entry.title || entry.life_core || '一张访客记事')}</h2>
    <p><strong>生命核：</strong>${escapeHtml(entry.life_core || entry.content || '')}</p>
    ${entry.content && entry.content !== entry.life_core ? textBlock(entry.content) : ''}
    ${entry.usage_hint ? `<p><strong>使用：</strong>${escapeHtml(entry.usage_hint)}</p>` : ''}
    ${entry.avoid_hint ? `<p><strong>避免：</strong>${escapeHtml(entry.avoid_hint)}</p>` : ''}
    <div class="button-row"><button type="button" data-mailbox-action="delete-memory" data-memory-id="${escapeAttribute(entry.id)}">删除</button></div>
  </article>`;
}

function notebookBody() {
  if (state.visitor && !state.visitor.allow_memory) {
    return '<p class="feature-empty">你登记时没有开启访客记事本；整理当前对话的纸条仍只作为当前房间的滚动工作上下文。</p>';
  }
  const pending = state.memory.pending_pockets || [];
  const entries = state.memory.entries || [];
  const pendingEntry = `<section class="feature-group"><div class="feature-card"><button class="feature-row" type="button" data-panel="pockets"><span><strong>待确认区 · ${pending.length}</strong><small>只有另一位屋主明确确认后，候选才会成为轻量记忆。</small></span><span>›</span></button></div></section>`;
  const memories = entries.length
    ? `<section class="feature-group"><h2>访客记事</h2><div class="memory-entry-list">${entries.map(memoryEntryCard).join('')}</div></section>`
    : '<section class="feature-group"><h2>访客记事</h2><div class="feature-card"><p class="feature-empty">这里还没有记事。等另一位屋主更熟悉你一点，也许会在这里留下几张小纸条。</p></div></section>';
  return pendingEntry + memories;
}

function pocketsBody() {
  const pending = state.memory.pending_pockets || [];
  return pending.length
    ? `<div class="memory-pocket-list">${pending.map(pendingPocketCard).join('')}</div>`
    : '<p class="feature-empty">待确认区是空的。</p>';
}

function renderPanelBody(kind) {
  const body = q('#mailboxPanelBody');
  if (!body) return;
  body.innerHTML = kind === 'soil'
    ? thoughtSoilBody()
    : kind === 'notebook'
      ? notebookBody()
      : pocketsBody();
}

async function openPanel(kind) {
  const panel = q('#mailboxPanel');
  const title = q('#mailboxPanelTitle');
  const subtitle = q('#mailboxPanelSubtitle');
  const body = q('#mailboxPanelBody');
  if (!panel || !title || !subtitle || !body) return;
  const panelMeta = {
    soil: ['整理当前对话的纸条', '当前访客房间的滚动工作上下文'],
    notebook: ['访客记事本', '待确认区与长期轻量记忆'],
    pockets: ['待确认区', '确认前不会进入访客记事本'],
  }[kind];
  if (!panelMeta) return;
  state.activePanel = kind;
  title.textContent = panelMeta[0];
  subtitle.textContent = panelMeta[1];
  body.innerHTML = '<p class="feature-empty">正在查看小纸条…</p>';
  if (!panel.open) panel.showModal();
  try {
    await fetchMemory();
    renderPanelBody(kind);
  } catch (error) {
    if (!handleSessionError(error)) {
      body.innerHTML = `<p class="feature-empty">${escapeHtml(error.message || '这些小纸条暂时没有同步。')}</p>`;
    }
  }
}

async function resolvePendingPocket(pocketId, action, button) {
  if (!pocketId || !['remember', 'discard'].includes(action)) return;
  const card = button?.closest('[data-pocket-id]');
  const buttons = card ? [...card.querySelectorAll('button')] : [];
  buttons.forEach((node) => { node.disabled = true; });
  try {
    await requestJson(`${API.mailboxMemory}/pockets/${encodeURIComponent(pocketId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    await fetchMemory();
    renderPanelBody(state.activePanel || 'pockets');
    renderMessages();
    toast(action === 'remember'
      ? '已经收进访客记事本。'
      : '这枚记忆候选已经放回潮水里。');
  } catch (error) {
    buttons.forEach((node) => { node.disabled = false; });
    if (!handleSessionError(error)) toast(error.message || '这枚候选暂时没有处理，请再试一次。', 3200);
  }
}

function messageById(messageId) {
  return state.messages.find((message) => message.id === messageId) || null;
}

async function editMessage(messageId) {
  const message = messageById(messageId);
  if (!message || message.role !== 'visitor') return;
  const content = window.prompt('编辑消息', message.content);
  if (content == null || content.trim() === message.content) return;
  if (!content.trim()) return toast('来信正文不能为空。');
  try {
    await requestJson(`${API.mailboxMessages}/${encodeURIComponent(message.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: content.trim() }),
    });
    await refreshMailbox();
    toast('这封来信已经更新，并重新等待巡灯。');
  } catch (error) {
    if (!handleSessionError(error)) toast(error.message || '这封来信暂时没有更新。');
  }
}

async function deleteMessage(messageId) {
  const message = messageById(messageId);
  if (!message) return;
  const visitorMessageSelected = message.role === 'visitor';
  const confirmed = await confirmDanger({
    title: visitorMessageSelected ? '删除这条用户消息？' : '删除这条助手回复？',
    message: visitorMessageSelected
      ? '如果这是这一轮唯一的用户消息，关联的另一位屋主回信也会一起从当前访客房间移除。'
      : '这只会删除当前选中的另一位屋主回信；其他访客房间不会受到影响。',
    confirmText: '删除',
  });
  if (!confirmed) return;
  try {
    await requestJson(`${API.mailboxMessages}/${encodeURIComponent(message.id)}`, {
      method: 'DELETE',
    });
    await refreshMailbox();
    toast('这条消息已经删除。');
  } catch (error) {
    if (!handleSessionError(error)) toast(error.message || '这条消息暂时没有删除。');
  }
}

async function copyMessage(messageId) {
  const message = messageById(messageId);
  if (!message) return;
  try {
    await navigator.clipboard.writeText(message.content);
    toast('已复制');
  } catch {
    toast('浏览器暂时不能复制这封回信。');
  }
}

async function deleteMemoryEntry(entryId) {
  const confirmed = await confirmDanger({
    title: '删除这条访客记事？',
    message: '删除后它会从当前访客记事本移除，不再作为这间房的长期轻量记忆。',
    confirmText: '删除',
  });
  if (!confirmed) return;
  try {
    await requestJson(`${API.mailboxMemory}/entries/${encodeURIComponent(entryId)}`, {
      method: 'DELETE',
    });
    await openPanel('notebook');
    toast('这条访客记事已经删除。');
  } catch (error) {
    if (!handleSessionError(error)) toast(error.message || '这条访客记事暂时没有删除。');
  }
}

function closeConversationMenu() {
  const menu = q('#mailboxConversationMenu');
  const bubble = q('#mailboxConversationBubble');
  if (menu) menu.setAttribute('aria-expanded', 'false');
  if (bubble) bubble.hidden = true;
}

function toggleConversationMenu() {
  const menu = q('#mailboxConversationMenu');
  const bubble = q('#mailboxConversationBubble');
  if (!menu || !bubble) return;
  const open = bubble.hidden;
  bubble.hidden = !open;
  menu.setAttribute('aria-expanded', String(open));
}

async function deleteAccount() {
  closeConversationMenu();
  const confirmed = await confirmDanger({
    title: '删除整个访客信箱对话？',
    message: '你的暗号、全部来信与回信、整理当前对话的纸条、待确认区和访客记事本都会永久删除，无法恢复。',
    confirmText: '删除全部数据',
  });
  if (!confirmed) return;
  try {
    await requestJson(API.mailboxAccount, { method: 'DELETE' });
    window.location.replace('/login?mailbox=1&deleted=1');
  } catch (error) {
    if (!handleSessionError(error)) toast(error.message || '整个访客房间暂时没有删除。', 3200);
  }
}

async function bootMailbox() {
  hydrateIconSlots();
  try {
    const me = await requestJson(API.mailboxMe);
    state.visitor = me;
    state.memory = emptyMemory(me.visitor_id);
    const label = q('#mailboxVisitorLabel');
    if (label) label.textContent = `${me.preferred_name || me.display_name} · 慢速回信房间`;
    await refreshMailbox();
  } catch (error) {
    if (!handleSessionError(error)) showLoadingStatus(error.message || '访客信箱没有打开。');
  }
}

q('#mailboxComposer')?.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage();
});

q('#mailboxPromptInput')?.addEventListener('input', (event) => {
  event.target.style.height = 'auto';
  event.target.style.height = `${Math.min(event.target.scrollHeight, 112)}px`;
});

q('#mailboxRefreshButton')?.addEventListener('click', () => refreshMailbox({ announce: true }));
q('#mailboxPanelClose')?.addEventListener('click', () => q('#mailboxPanel')?.close());
q('#mailboxConversationMenu')?.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleConversationMenu();
});

// The standalone mailbox owns this delegated click listener at its local root.
q('#mailboxApp')?.addEventListener('click', (event) => {
  if (!event.target.closest('#mailboxConversationMenuWrap')) closeConversationMenu();
  const panelButton = event.target.closest('[data-panel]');
  if (panelButton) {
    openPanel(panelButton.dataset.panel);
    return;
  }
  const actionButtonNode = event.target.closest('[data-mailbox-action]');
  if (!actionButtonNode) return;
  const message = actionButtonNode.closest('[data-message-id]');
  const action = actionButtonNode.dataset.mailboxAction;
  if (action === 'edit') editMessage(message?.dataset.messageId);
  if (action === 'copy') copyMessage(message?.dataset.messageId);
  if (action === 'delete') deleteMessage(message?.dataset.messageId);
  if (action === 'delete-memory') deleteMemoryEntry(actionButtonNode.dataset.memoryId);
  if (action === 'resolve-pocket') {
    const pocket = actionButtonNode.closest('[data-pocket-id]');
    resolvePendingPocket(pocket?.dataset.pocketId, actionButtonNode.dataset.pocketAction, actionButtonNode);
  }
  if (action === 'delete-account') deleteAccount();
});

bootMailbox();
