import { escapeAttribute, escapeHtml, formatRichText, qa } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { activeBranch, createState } from '../chat-state.js';
import { shortModelName } from './chat-profile.js';
import { renderMessageAttachments } from './chat-attachments.js';
import { renderToolRuns } from './chat-tools.js';
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
    'edit-owner': 'edit',
    'delete-owner': 'trash',
    regenerate: 'refresh',
    like: 'like',
    favorite: 'heart',
    'delete-model-partner': 'trash',
  }[action];
  return `<button class="action-button ${active ? 'is-active' : ''}" type="button" data-action="chat:${action}" ${reaction ? `data-reaction="${reaction}"` : ''} title="${escapeAttribute(title)}" aria-label="${escapeAttribute(title)}">${icon(iconName)}</button>`;
}

function conversationRow(conversation, runtime, roomTypeLabels) {
  const active = conversation.id === runtime.currentId;
  const title = `${roomTypeLabels[conversation.room_type] || roomTypeLabels.main}｜${conversation.title || '新聊天'}`;
  return `<div class="conversation-row" data-conversation-id="${escapeAttribute(conversation.id)}">
    <button class="history-item conversation-title ${active ? 'is-active' : ''}" type="button" data-action="chat:open" data-id="${escapeAttribute(conversation.id)}">${escapeHtml(title)}</button>
    <button class="conversation-more" type="button" data-action="chat:menu" data-id="${escapeAttribute(conversation.id)}" aria-label="窗口操作" aria-expanded="false">${icon('more')}</button>
    <div class="conversation-menu" data-conversation-menu hidden>
      <button type="button" data-action="chat:rename" data-id="${escapeAttribute(conversation.id)}">改名</button>
      <button class="danger" type="button" data-action="chat:delete-conversation" data-id="${escapeAttribute(conversation.id)}">删除</button>
    </div>
  </div>`;
}

function officialMcpLetter(owner, turnId, attachmentHtml = '') {
  const author = owner?.display_author || owner?.source_model_label || '官端 ChatGPT';
  const modelLabel = String(owner?.source_model_label || '').trim();
  const provenance = ['official_mcp', author, modelLabel && modelLabel !== author ? modelLabel : '']
    .filter(Boolean)
    .join(' · ');
  return `<article class="message owner official-mcp-message" data-turn="${escapeAttribute(turnId)}" data-message-source="official_mcp">
    <div class="mcp-letter-wrap">
      <div class="mcp-letter-paper">
        <div class="mcp-letter-heading"><span>官端来信 · MCP</span><span class="message-humanThought-mark">${escapeHtml(provenance)}</span></div>
        <div class="mcp-letter-body">${formatRichText(owner?.content || '')}</div>
        <div class="mcp-letter-signature">— ${escapeHtml(author)}</div>
      </div>
      ${attachmentHtml}
    </div>
  </article>`;
}

export function createChatRender({ runtime, ui, closeMenu, roomTypeLabels }) {
  const streamingPatches = new Map();
  let streamingFrame = 0;

  function patchModelPartnerStreamingText(conversationId, turnId, content, { errorDetail = '', loading = true } = {}) {
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
          const article = qa('.message.model-partner', ui.messages).find((node) => node.dataset.turn === patch.turnId);
          const text = article?.querySelector('.model-partner-text');
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
    ui.list.innerHTML = runtime.conversations.length
      ? runtime.conversations.map((conversation) => conversationRow(conversation, runtime, roomTypeLabels)).join('')
      : '<p class="sidebar-empty">还没有聊天窗口</p>';
  }

  function renderMessages(conversationId = runtime.currentId) {
    discardStreamingPatches(conversationId);
    if (!ui.messages || conversationId !== runtime.currentId) return;
    const state = runtime.histories.get(conversationId) || createState();
    const latestModelPartnerTurnId = [...state.turns].reverse().find((turn) => activeBranch(turn).modelPartner)?.id || '';
    const html = state.turns.map((turn) => {
      const branch = activeBranch(turn);
      const loading = runtime.generation
        && runtime.generation.conversationId === conversationId
        && runtime.generation.turnId === turn.id
        && runtime.generation.ownerIndex === branch.ownerIndex
        && runtime.generation.modelPartnerIndex === branch.modelPartnerIndex;
      const ownerAttachment = [
        renderMessageAttachments(branch.owner?.attachments || [], conversationId),
        branch.owner?.id ? '' : '',
      ].join('');
      const modelPartnerAttachment = '';
      const ownerImported = branch.owner?.message_source === 'external';
      const modelPartnerImported = branch.modelPartner?.message_source === 'external';
      const owner = branch.owner && !branch.owner.hidden
        ? branch.owner.message_source === 'official_mcp'
          ? officialMcpLetter(branch.owner, turn.id, ownerAttachment)
          : `<article class="message owner ${ownerImported ? 'imported-message' : ''}" data-turn="${escapeAttribute(turn.id)}"><div class="content">${branch.owner.content ? `<div class="user-bubble">${escapeHtml(branch.owner.content)}</div>` : ''}${ownerAttachment}${ownerImported ? '<span class="message-humanThought-mark">外部入口消息</span>' : ''}${branch.owner.humanThought_snapshot_id ? '<span class="message-humanThought-mark">人类思考链 · 随本轮</span>' : ''}<div class="message-actions">${actionButton('edit-owner', '编辑')}${actionButton('delete-owner', '删除')}${variantControl('owner', turn.id, branch.ownerIndex, turn.owner.variants.length)}</div></div></article>`
        : '';
      const modelPartner = branch.modelPartner ? `<article class="message model-partner ${modelPartnerImported ? 'imported-message' : ''}" data-turn="${escapeAttribute(turn.id)}" data-message-id="${escapeAttribute(branch.modelPartner.id || '')}"><span class="avatar" aria-hidden="true"></span><div class="content">${renderToolRuns(branch.modelPartner.tool_runs, { conversationId })}<div class="model-partner-text">${formatRichText(branch.modelPartner.content)}${branch.modelPartner.errorDetail ? `<span class="message-error">${escapeHtml(branch.modelPartner.errorDetail)}</span>` : ''}${loading ? '<span class="typing-cursor"></span>' : ''}</div>${modelPartnerAttachment}${modelPartnerImported ? `<span class="message-humanThought-mark">外部入口消息${branch.modelPartner.model_id ? ` · ${escapeHtml(shortModelName(branch.modelPartner.model_id))}` : ''}</span>` : ''}<div class="message-actions">${actionButton('copy', '复制')}${actionButton('like', '点赞', { active: branch.modelPartner.liked, reaction: 'liked' })}${actionButton('regenerate', '重新生成')}${actionButton('favorite', '收藏', { active: branch.modelPartner.favorite, reaction: 'favorite' })}${actionButton('delete-model-partner', '删除')}${variantControl('model_partner', turn.id, branch.modelPartnerIndex, branch.modelPartners.length)}${generationFootprint(branch.modelPartner, turn.id)}</div>${loading ? '' : renderModelMetadataTrace(branch.modelPartner, conversationId)}</div></article>` : '';
      const soil = branch.modelPartner && turn.id === latestModelPartnerTurnId ? runtime.memory?.renderSoilEntry(conversationId) || '' : '';
      return owner + soil + modelPartner;
    }).join('');
    ui.messages.innerHTML = html || '<div class="empty-state">这里还没有消息。</div>';
    hydrateModelMetadataTraces(ui.messages);
    const avatarUrl = runtime.profile.model_partner_avatar_dataurl;
    if (avatarUrl) {
      qa('.avatar', ui.messages).forEach((avatar) => { avatar.style.backgroundImage = `url(${JSON.stringify(avatarUrl)})`; });
    }
    requestAnimationFrame(() => { if (ui.scroller) ui.scroller.scrollTop = ui.scroller.scrollHeight; });
  }

  return Object.freeze({ renderConversationList, renderMessages, patchModelPartnerStreamingText });
}
