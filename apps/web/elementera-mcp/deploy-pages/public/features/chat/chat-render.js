import { escapeAttribute, escapeHtml, formatRichText, qa } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { activeBranch, createState } from '../chat-state.js';
import { shortModelName } from './chat-profile.js';
import { renderMessageAttachments } from './chat-attachments.js';
import { renderFurnitureBubble } from './chat-furniture.js';
import {
  hydrateModelMetadataTraces,
  renderModelMetadataTrace,
} from './chat-model-metadata.js';

export function generationDetail(variant = {}) {
  const usage = variant.usage || {};
  return [
    `model_id: ${variant.model_id || '—'}`,
    `prompt_tokens: ${Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : '—'}`,
    `completion_tokens: ${Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : '—'}`,
    `total_tokens: ${Number.isFinite(usage.total_tokens) ? usage.total_tokens : '—'}`,
    `finish_reason: ${variant.finish_reason || '—'}`,
    `generation_source: ${variant.generation_source || '—'}`,
  ].join('\n');
}

export function generationFootprint(variant, turnId) {
  if (!variant?.model_id) return '';
  const model = shortModelName(variant.model_id);
  const total = Number.isFinite(variant?.usage?.total_tokens)
    ? ` · ${variant.usage.total_tokens.toLocaleString('en-US')} tok`
    : '';
  const detail = generationDetail(variant);
  return `<button class="generation-footprint" type="button" data-action="chat:generation-detail" data-turn="${escapeAttribute(turnId)}" title="${escapeAttribute(detail)}" aria-label="查看生成详情">${escapeHtml(`${model}${total}`)}</button>`;
}

export function variantControl(kind, turnId, active, total) {
  if (total <= 1) return '';
  return `<span class="variant-switch">
    <button type="button" data-action="chat:switch-variant" data-turn="${escapeAttribute(turnId)}" data-kind="${kind}" data-direction="previous" aria-label="上一个版本">${icon('back')}</button>
    <span>${active + 1}/${total}</span>
    <button class="is-next" type="button" data-action="chat:switch-variant" data-turn="${escapeAttribute(turnId)}" data-kind="${kind}" data-direction="next" aria-label="下一个版本">${icon('back')}</button>
  </span>`;
}

export function actionButton(action, title, { active = false, reaction = '' } = {}) {
  const iconName = {
    copy: 'copy',
    'edit-user': 'edit',
    'delete-user': 'trash',
    regenerate: 'refresh',
    like: 'like',
    favorite: 'heart',
    'delete-assistant': 'trash',
  }[action];
  return `<button class="action-button ${active ? 'is-active' : ''}" type="button" data-action="chat:${action}" ${reaction ? `data-reaction="${reaction}"` : ''} title="${escapeAttribute(title)}" aria-label="${escapeAttribute(title)}">${icon(iconName)}</button>`;
}

function conversationRow(conversation, runtime, roomTypeLabels) {
  const active = conversation.id === runtime.currentId;
  const isRikka = conversation.source === 'rikkahub';
  const title = isRikka
    ? conversation.title || '【Rikka】未命名窗口'
    : `${roomTypeLabels[conversation.room_type] || roomTypeLabels.main}｜${conversation.title || '新聊天'}`;
  return `<div class="conversation-row ${isRikka ? 'is-rikkahub' : ''}" data-conversation-id="${escapeAttribute(conversation.id)}">
    <button class="history-item conversation-title ${active ? 'is-active' : ''}" type="button" data-action="chat:open" data-id="${escapeAttribute(conversation.id)}">${escapeHtml(title)}</button>
    <button class="conversation-more" type="button" data-action="chat:menu" data-id="${escapeAttribute(conversation.id)}" aria-label="窗口操作" aria-expanded="false">${icon('more')}</button>
    <div class="conversation-menu" data-conversation-menu hidden>
      <button type="button" data-action="chat:rename" data-id="${escapeAttribute(conversation.id)}">改名</button>
      <button class="danger" type="button" data-action="chat:delete-conversation" data-id="${escapeAttribute(conversation.id)}">删除</button>
    </div>
  </div>`;
}

function renderRikkaAttachments(runtime, conversationId, messageId) {
  const attachments = runtime.rikkahubAttachments.get(conversationId)?.get(messageId) || [];
  if (!attachments.length) return '';
  const body = attachments.map((attachment) => {
    const name = escapeHtml(attachment.name || '附件');
    const url = String(attachment.url || '');
    const mime = String(attachment.mime_type || 'application/octet-stream');
    if (mime.startsWith('image/') && url) {
      return `<figure class="rikka-attachment"><img src="${escapeAttribute(url)}" alt="${escapeAttribute(attachment.name || 'RikkaHub 图片')}" loading="lazy"><figcaption>${name}</figcaption></figure>`;
    }
    if (url) return `<a class="rikka-attachment-link" href="${escapeAttribute(url)}" target="_blank" rel="noopener">${name}</a>`;
    return `<span class="rikka-attachment-link is-missing">${name}</span>`;
  }).join('');
  return body ? `<div class="rikka-attachments">${body}</div>` : '';
}

function officialMcpLetter(user, turnId, attachmentHtml = '') {
  const author = user?.display_author || user?.source_model_label || '官端 ChatGPT';
  const modelLabel = String(user?.source_model_label || '').trim();
  const provenance = ['official_mcp', author, modelLabel && modelLabel !== author ? modelLabel : '']
    .filter(Boolean)
    .join(' · ');
  return `<article class="message user official-mcp-message" data-turn="${escapeAttribute(turnId)}" data-message-source="official_mcp">
    <div class="mcp-letter-wrap">
      <div class="mcp-letter-paper">
        <div class="mcp-letter-heading"><span>官端来信 · MCP</span><span class="message-dogtalk-mark">${escapeHtml(provenance)}</span></div>
        <div class="mcp-letter-body">${formatRichText(user?.content || '')}</div>
        <div class="mcp-letter-signature">— ${escapeHtml(author)}</div>
      </div>
      ${attachmentHtml}
    </div>
  </article>`;
}

export function createChatRender({ runtime, ui, closeMenu, roomTypeLabels }) {
  const streamingPatches = new Map();
  let streamingFrame = 0;

  function patchAssistantStreamingText(conversationId, turnId, content, { errorDetail = '', loading = true } = {}) {
    if (!ui.messages || conversationId !== runtime.currentId) return false;
    const key = JSON.stringify([conversationId, turnId]);
    streamingPatches.set(key, { conversationId, turnId, content: String(content || ''), errorDetail: String(errorDetail || ''), loading: loading === true });
    if (!streamingFrame) {
      streamingFrame = -1;
      const frameId = requestAnimationFrame(() => {
        streamingFrame = 0;
        const pending = [...streamingPatches.values()];
        streamingPatches.clear();
        for (const patch of pending) {
          if (!ui.messages || patch.conversationId !== runtime.currentId) continue;
          const article = qa('.message.assistant', ui.messages).find((node) => node.dataset.turn === patch.turnId);
          const text = article?.querySelector('.assistant-text');
          if (!text) continue;
          text.innerHTML = formatRichText(patch.content)
            + (patch.errorDetail ? `<span class="message-error">${escapeHtml(patch.errorDetail)}</span>` : '')
            + (patch.loading ? '<span class="typing-cursor"></span>' : '');
        }
        if (ui.scroller) ui.scroller.scrollTop = ui.scroller.scrollHeight;
      });
      if (streamingFrame === -1) streamingFrame = frameId || 1;
    }
    return true;
  }

  function discardStreamingPatches(conversationId) {
    for (const [key, patch] of streamingPatches) {
      if (!conversationId || patch.conversationId === conversationId) streamingPatches.delete(key);
    }
  }

  function renderConversationList() {
    if (!ui.list) return;
    closeMenu();
    const coast = runtime.conversations.filter((conversation) => conversation.source !== 'rikkahub');
    const rikka = runtime.conversations.filter((conversation) => conversation.source === 'rikkahub');
    const coastHtml = coast.length ? coast.map((conversation) => conversationRow(conversation, runtime, roomTypeLabels)).join('') : '<p class="sidebar-empty">还没有普通聊天窗口</p>';
    const rikkaBody = runtime.rikkahubExpanded
      ? `<div class="rikkahub-conversation-body">${rikka.length ? rikka.map((conversation) => conversationRow(conversation, runtime, roomTypeLabels)).join('') : '<p class="sidebar-empty">还没有导入 RikkaHub 窗口</p>'}<button class="rikkahub-import-button" type="button" data-action="chat:import-rikkahub">导入聊天包</button></div>`
      : '';
    ui.list.innerHTML = `${coastHtml}<section class="rikkahub-conversation-section"><button class="rikkahub-section-toggle" type="button" data-action="chat:toggle-rikkahub" aria-expanded="${runtime.rikkahubExpanded ? 'true' : 'false'}"><span>RikkaHub</span><span aria-hidden="true">${runtime.rikkahubExpanded ? '⌃' : '⌄'}</span></button>${rikkaBody}</section>`;
  }

  function renderMessages(conversationId = runtime.currentId) {
    discardStreamingPatches(conversationId);
    if (!ui.messages || conversationId !== runtime.currentId) return;
    const state = runtime.histories.get(conversationId) || createState();
    const latestAssistantTurnId = [...state.turns].reverse().find((turn) => activeBranch(turn).assistant)?.id || '';
    const html = state.turns.map((turn) => {
      const branch = activeBranch(turn);
      const loading = runtime.generation
        && runtime.generation.conversationId === conversationId
        && runtime.generation.turnId === turn.id
        && runtime.generation.userIndex === branch.userIndex
        && runtime.generation.assistantIndex === branch.assistantIndex;
      const userAttachment = [
        renderMessageAttachments(branch.user?.attachments || [], conversationId),
        branch.user?.id ? renderRikkaAttachments(runtime, conversationId, branch.user.id) : '',
      ].join('');
      const assistantAttachment = branch.assistant?.id ? renderRikkaAttachments(runtime, conversationId, branch.assistant.id) : '';
      const userImported = branch.user?.message_source === 'rikkahub';
      const assistantImported = branch.assistant?.message_source === 'rikkahub';
      const user = branch.user && !branch.user.hidden
        ? branch.user.message_source === 'official_mcp'
          ? officialMcpLetter(branch.user, turn.id, userAttachment)
          : `<article class="message user ${userImported ? 'imported-message' : ''}" data-turn="${escapeAttribute(turn.id)}"><div class="content">${branch.user.content ? `<div class="user-bubble">${escapeHtml(branch.user.content)}</div>` : ''}${userAttachment}${userImported ? '<span class="message-dogtalk-mark">RikkaHub 旧档案</span>' : ''}${branch.user.dogtalk_snapshot_id ? '<span class="message-dogtalk-mark">私人草稿 · 随本轮</span>' : ''}<div class="message-actions">${actionButton('edit-user', '编辑')}${actionButton('delete-user', '删除')}${variantControl('user', turn.id, branch.userIndex, turn.user.variants.length)}</div></div></article>`
        : '';
      const assistant = branch.assistant ? `<article class="message assistant ${assistantImported ? 'imported-message' : ''}" data-turn="${escapeAttribute(turn.id)}" data-message-id="${escapeAttribute(branch.assistant.id || '')}"><button class="avatar" type="button" data-action="settings:avatar" aria-label="更换助手头像"></button><div class="content">${renderFurnitureBubble(branch.assistant.furniture_runs, { conversationId })}<div class="assistant-text">${formatRichText(branch.assistant.content)}${branch.assistant.errorDetail ? `<span class="message-error">${escapeHtml(branch.assistant.errorDetail)}</span>` : ''}${loading ? '<span class="typing-cursor"></span>' : ''}</div>${assistantAttachment}${assistantImported ? `<span class="message-dogtalk-mark">RikkaHub 旧档案${branch.assistant.model_id ? ` · ${escapeHtml(shortModelName(branch.assistant.model_id))}` : ''}</span>` : ''}<div class="message-actions">${actionButton('copy', '复制')}${actionButton('like', '点赞', { active: branch.assistant.liked, reaction: 'liked' })}${actionButton('regenerate', '重新生成')}${actionButton('favorite', '收藏', { active: branch.assistant.favorite, reaction: 'favorite' })}${actionButton('delete-assistant', '删除')}${variantControl('assistant', turn.id, branch.assistantIndex, branch.assistants.length)}${generationFootprint(branch.assistant, turn.id)}</div>${loading ? '' : renderModelMetadataTrace(branch.assistant, conversationId)}</div></article>` : '';
      const soil = branch.assistant && turn.id === latestAssistantTurnId ? runtime.memory?.renderSoilEntry(conversationId) || '' : '';
      return user + soil + assistant;
    }).join('');
    ui.messages.innerHTML = html || '<div class="empty-state">这里还没有消息。</div>';
    hydrateModelMetadataTraces(ui.messages);
    const avatarUrl = runtime.profile.assistant_avatar_dataurl;
    if (avatarUrl) {
      qa('.avatar', ui.messages).forEach((avatar) => { avatar.style.backgroundImage = `url(${JSON.stringify(avatarUrl)})`; });
    }
    requestAnimationFrame(() => { if (ui.scroller) ui.scroller.scrollTop = ui.scroller.scrollHeight; });
  }

  return Object.freeze({ renderConversationList, renderMessages, patchAssistantStreamingText });
}
