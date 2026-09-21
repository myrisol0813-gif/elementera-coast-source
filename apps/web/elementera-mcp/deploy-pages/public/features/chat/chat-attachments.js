import { API, ApiError, requestJson } from '../../core/api.js';
import { escapeAttribute, escapeHtml } from '../../core/dom.js';
import { icon } from '../../core/icons.js';

const MAX_PENDING_ATTACHMENTS = 12;

function attachmentUrl(conversationId, attachmentId) {
  return `${API.attachments}/${encodeURIComponent(attachmentId)}?conversation_id=${encodeURIComponent(conversationId)}`;
}

function sizeLabel(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentCard(attachment, conversationId, { pending = false } = {}) {
  const name = escapeHtml(attachment.name || '附件');
  const meta = escapeHtml(`${attachment.mime || '文件'} · ${sizeLabel(attachment.size)}`);
  const url = attachmentUrl(conversationId, attachment.id);
  const body = attachment.type === 'image'
    ? `<img class="chat-attachment-image" src="${escapeAttribute(url)}" alt="${escapeAttribute(attachment.name || '图片附件')}" loading="lazy">`
    : `<span class="chat-attachment-file-icon">${icon('file')}</span>`;
  const text = `<span class="chat-attachment-copy"><strong>${name}</strong><small>${meta}</small></span>`;
  const remove = pending
    ? `<button class="chat-attachment-remove" type="button" data-action="chat:attachment-remove" data-id="${escapeAttribute(attachment.id)}" aria-label="移除 ${escapeAttribute(attachment.name || '附件')}">${icon('close')}</button>`
    : '';
  const open = pending
    ? `<span class="chat-attachment-card is-pending">${body}${text}${remove}</span>`
    : `<a class="chat-attachment-card" href="${escapeAttribute(url)}" target="_blank" rel="noopener">${body}${text}</a>`;
  return open;
}

export function renderMessageAttachments(attachments, conversationId) {
  const items = Array.isArray(attachments) ? attachments : [];
  if (!items.length) return '';
  return `<div class="chat-attachments">${items.map((item) => attachmentCard(item, conversationId)).join('')}</div>`;
}

async function uploadAttachment(conversationId, file) {
  const form = new FormData();
  form.set('conversation_id', conversationId);
  form.set('file', file, file.name || '附件');
  const response = await fetch(API.attachments, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = data?.error || {};
    throw new ApiError(error.message || `附件上传失败（${response.status}）`, {
      type: error.type || 'attachment_upload_failed',
      status: response.status,
      details: error,
    });
  }
  return data.attachment;
}

export function createChatAttachments({ runtime, ui, toast, composerState }) {
  runtime.pendingAttachments = [];
  runtime.attachmentUploading = false;
  runtime.attachmentMenuOpen = false;
  runtime.pendingAttachmentConversationId = '';

  function current() {
    if (runtime.pendingAttachmentConversationId && runtime.pendingAttachmentConversationId !== runtime.currentId) return [];
    return [...runtime.pendingAttachments];
  }

  function renderPending() {
    if (!ui.attachmentTray) return;
    const items = current();
    ui.attachmentTray.hidden = !items.length && !runtime.attachmentUploading;
    ui.attachmentTray.innerHTML = [
      ...items.map((item) => attachmentCard(item, runtime.currentId, { pending: true })),
      runtime.attachmentUploading ? '<span class="chat-attachment-uploading">正在收好附件…</span>' : '',
    ].join('');
  }

  function renderMenu() {
    if (!ui.attachmentMenu || !ui.attachmentButton) return;
    const open = runtime.attachmentMenuOpen && !runtime.generation && runtime.composerReady;
    ui.attachmentMenu.hidden = !open;
    ui.attachmentButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeMenu() {
    runtime.attachmentMenuOpen = false;
    renderMenu();
  }

  function toggleMenu() {
    if (!runtime.composerReady || runtime.generation) return;
    runtime.attachmentMenuOpen = !runtime.attachmentMenuOpen;
    renderMenu();
  }

  function choose(kind) {
    closeMenu();
    if (kind === 'image') ui.attachmentImageInput?.click();
    else ui.attachmentFileInput?.click();
  }

  async function addFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length || !runtime.currentId) return;
    if (runtime.pendingAttachmentConversationId && runtime.pendingAttachmentConversationId !== runtime.currentId) {
      runtime.pendingAttachments = [];
    }
    runtime.pendingAttachmentConversationId = runtime.currentId;
    const remaining = Math.max(0, MAX_PENDING_ATTACHMENTS - runtime.pendingAttachments.length);
    if (!remaining) {
      toast(`每轮最多 ${MAX_PENDING_ATTACHMENTS} 个附件。`);
      return;
    }
    runtime.attachmentUploading = true;
    renderPending();
    composerState();
    try {
      for (const file of files.slice(0, remaining)) {
        try {
          const attachment = await uploadAttachment(runtime.currentId, file);
          runtime.pendingAttachments.push(attachment);
          renderPending();
        } catch (error) {
          toast(`${file.name || '附件'}：${error.message}`, 3600);
        }
      }
      if (files.length > remaining) toast(`每轮最多 ${MAX_PENDING_ATTACHMENTS} 个附件。`);
    } finally {
      runtime.attachmentUploading = false;
      renderPending();
      composerState();
    }
  }

  async function remove(id) {
    const attachment = runtime.pendingAttachments.find((item) => item.id === id);
    if (!attachment) return;
    try {
      await requestJson(`${API.attachments}/${encodeURIComponent(id)}?conversation_id=${encodeURIComponent(runtime.currentId)}`, {
        method: 'DELETE',
      });
      runtime.pendingAttachments = runtime.pendingAttachments.filter((item) => item.id !== id);
      if (!runtime.pendingAttachments.length) runtime.pendingAttachmentConversationId = '';
      renderPending();
      composerState();
    } catch (error) {
      toast(`附件移除失败：${error.message}`);
    }
  }

  function clearSent() {
    runtime.pendingAttachments = [];
    runtime.pendingAttachmentConversationId = '';
    closeMenu();
    renderPending();
    composerState();
  }

  async function handleChange(name, target) {
    if (!['attachment-image-input', 'attachment-file-input'].includes(name)) return;
    const files = target?.files;
    await addFiles(files);
    if (target) target.value = '';
  }

  async function handleAction(name, target) {
    if (name === 'attachments-menu') return toggleMenu();
    if (name === 'attachment-image') return choose('image');
    if (name === 'attachment-file') return choose('file');
    if (name === 'attachment-remove') return remove(target.dataset.id || '');
  }

  function refresh() {
    renderMenu();
    renderPending();
  }

  return Object.freeze({
    current,
    clearSent,
    closeMenu,
    handleAction,
    handleChange,
    refresh,
  });
}
