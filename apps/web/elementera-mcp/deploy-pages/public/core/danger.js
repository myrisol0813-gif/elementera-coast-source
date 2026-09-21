import { escapeAttribute, escapeHtml } from './dom.js';

const DANGER_ACTIONS = Object.freeze({
  'settings:logout': Object.freeze({
    title: '退出前端账号？',
    message: '确认后会清除当前登录态并回到登录页面。聊天、记忆与前端数据不会被删除。',
    confirmText: '退出账号',
    cancelText: '取消',
    dangerLevel: 'warning',
  }),
  'chat:delete-user': Object.freeze({
    title: '删除这条用户消息？',
    message: '如果这是这一轮唯一的用户消息，关联的助手回复也会一起从当前窗口移除。',
    confirmText: '删除',
    cancelText: '取消',
    dangerLevel: 'danger',
  }),
  'chat:delete-assistant': Object.freeze({
    title: '删除这条助手回复？',
    message: '这只会删除当前选中的助手回复版本；其他窗口不会受到影响。',
    confirmText: '删除',
    cancelText: '取消',
    dangerLevel: 'danger',
  }),
  'chat:delete-conversation': Object.freeze({
    title: '删除这个聊天窗口？',
    message: '这个窗口会从侧边栏移除。其他窗口不会受到影响。',
    confirmText: '删除窗口',
    cancelText: '取消',
    dangerLevel: 'danger',
  }),
  'memory:soil-clear': Object.freeze({
    title: '清空当前窗口的整理当前对话的纸条？',
    message: '当前、当前活跃线索、勿复读和可落袋候选会被清空。聊天记录、落袋、种子和记忆不会被删除。',
    confirmText: '清空整理当前对话的纸条',
    cancelText: '取消',
    dangerLevel: 'danger',
  }),
  'tools:clear-soil': Object.freeze({
    title: '清空当前窗口的整理当前对话的纸条？',
    message: '当前、当前活跃线索、勿复读和可落袋候选会被清空。聊天记录、落袋、种子和记忆不会被删除。',
    confirmText: '清空整理当前对话的纸条',
    cancelText: '取消',
    dangerLevel: 'danger',
  }),
  'memory:pocket-discard': Object.freeze({
    title: '丢弃这条待确认内容？',
    message: '丢弃后它不会进入落袋，也不会参与召回。',
    confirmText: '丢弃',
    cancelText: '取消',
    dangerLevel: 'danger',
  }),
  'memory:pocket-stone': Object.freeze({
    title: '把它转为石头？',
    message: '它会沉入石头状态，不再像普通内容一样参与召回。',
    confirmText: '转为石头',
    cancelText: '取消',
    dangerLevel: 'warning',
  }),
  'memory:entry-delete': Object.freeze({
    title: '删除这条记忆内容？',
    message: '删除后它会从对应库中移除，并不再参与召回。',
    confirmText: '删除',
    cancelText: '取消',
    dangerLevel: 'danger',
  }),
  'memory:entry-stone': Object.freeze({
    title: '把它转为石头？',
    message: '它会沉入石头状态，不再像普通内容一样参与召回。',
    confirmText: '转为石头',
    cancelText: '取消',
    dangerLevel: 'warning',
  }),
  'memory:entry-archive': Object.freeze({
    title: '封存这条记忆内容？',
    message: '它会进入封存状态，不再像普通内容一样参与召回。',
    confirmText: '封存',
    cancelText: '取消',
    dangerLevel: 'warning',
  }),
  'dogtalk:clear': Object.freeze({
    title: '清空这条私人草稿草稿？',
    message: '本条草稿会收进归档，不再作为当前房间最近的私人草稿；整理当前对话的纸条、落袋、种子和记忆不会受到影响。',
    confirmText: '清空草稿',
    cancelText: '取消',
    dangerLevel: 'danger',
  }),
  'dogtalk:archive': Object.freeze({
    title: '把这条私人草稿收进归档？',
    message: '归档后它不再作为当前房间最近的私人草稿，也不会被低频读取；之后仍可由数据层保留。',
    confirmText: '归档',
    cancelText: '取消',
    dangerLevel: 'warning',
  }),
  'daily:delete-comment': Object.freeze({
    title: '删除这条评论吗？',
    message: '删除后只移除这条评论，不影响碳硅圈正文。',
    confirmText: '删除',
    cancelText: '取消',
    dangerLevel: 'danger',
  }),
  'daily:delete-moment': Object.freeze({
    title: '确定删除这条碳硅圈吗？',
    message: '删除后这条碳硅圈会从 Daily 移除，关联评论和点赞也会一起删除。',
    confirmText: '删除',
    cancelText: '取消',
    dangerLevel: 'danger',
  }),
  'daily:delete-diary': Object.freeze({
    title: '确定删除这篇日记吗？',
    message: '删除后这篇日记会从 Daily 移除。',
    confirmText: '删除',
    cancelText: '取消',
    dangerLevel: 'danger',
  }),
});

const STYLE_ID = 'coast-danger-confirm-styles';
let defaultConfirmer = null;

export function dangerConfirmationFor(action) {
  const value = DANGER_ACTIONS[String(action || '')];
  return value ? { ...value } : null;
}

export function destructiveActions() {
  return Object.keys(DANGER_ACTIONS);
}

function ensureStyles(documentRef) {
  if (!documentRef?.head || documentRef.getElementById(STYLE_ID)) return;
  const style = documentRef.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .danger-confirm {
      width: min(88vw, 420px);
      max-width: calc(100vw - 32px);
      margin: auto;
      padding: 0;
      overflow: hidden;
      color: var(--text, #202123);
      background: var(--surface-raised, #fff);
      border: 1px solid var(--line, #e5e5e7);
      border-radius: 18px;
      box-shadow: var(--shadow, 0 18px 48px rgba(0, 0, 0, .14));
    }
    .danger-confirm::backdrop {
      background: rgba(0, 0, 0, .42);
      backdrop-filter: blur(2px);
    }
    .danger-confirm-card {
      padding: 22px 20px 18px;
    }
    .danger-confirm-card h1 {
      margin: 0 0 10px;
      font-size: 19px;
      line-height: 1.35;
    }
    .danger-confirm-card p {
      margin: 0;
      color: var(--text-soft, #5f6368);
      font-size: 14px;
      line-height: 1.65;
    }
    .danger-confirm-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      padding: 0 20px 20px;
    }
    .danger-confirm-actions button {
      min-height: 46px;
      border: 1px solid var(--line, #e5e5e7);
      border-radius: 14px;
      background: var(--surface-soft, #f7f7f8);
    }
    .danger-confirm-actions .is-danger {
      color: #fff;
      border-color: var(--danger, #d04444);
      background: var(--danger, #d04444);
      font-weight: 650;
    }
    .danger-confirm[data-danger-level="warning"] .danger-confirm-actions .is-danger {
      color: var(--accent-contrast, #fff);
      border-color: var(--accent, #ff6a21);
      background: var(--accent, #ff6a21);
    }
    @media (max-width: 520px) {
      .danger-confirm {
        width: calc(100vw - 28px);
      }
      .danger-confirm-card {
        padding: 20px 18px 16px;
      }
      .danger-confirm-actions {
        padding: 0 18px calc(18px + env(safe-area-inset-bottom, 0px));
      }
    }
  `;
  documentRef.head.appendChild(style);
}

function token() {
  return globalThis.crypto?.randomUUID?.() || `danger-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createDangerConfirmer({
  document: documentRef = globalThis.document,
  window: windowRef = globalThis.window,
  history: historyRef = globalThis.history || globalThis.window?.history,
} = {}) {
  let active = false;

  return function confirmDanger({
    title = '确认危险操作？',
    message = '这个操作会修改或移除现有内容。',
    confirmText = '确认',
    cancelText = '取消',
    dangerLevel = 'danger',
  } = {}) {
    if (active || !documentRef?.body) return Promise.resolve(false);
    active = true;
    ensureStyles(documentRef);

    return new Promise((resolve) => {
      const dialog = documentRef.createElement('dialog');
      dialog.className = 'danger-confirm';
      dialog.dataset.dangerConfirm = '';
      dialog.dataset.dangerLevel = dangerLevel === 'warning' ? 'warning' : 'danger';
      dialog.setAttribute('aria-labelledby', 'dangerConfirmTitle');
      dialog.setAttribute('aria-describedby', 'dangerConfirmMessage');
      dialog.innerHTML = `<section class="danger-confirm-card">
        <h1 id="dangerConfirmTitle">${escapeHtml(title)}</h1>
        <p id="dangerConfirmMessage">${escapeHtml(message)}</p>
      </section>
      <div class="danger-confirm-actions">
        <button type="button" data-danger-cancel>${escapeHtml(cancelText)}</button>
        <button class="is-danger" type="button" data-danger-confirm-action aria-label="${escapeAttribute(confirmText)}">${escapeHtml(confirmText)}</button>
      </div>`;
      documentRef.body.appendChild(dialog);

      const cancelButton = dialog.querySelector('[data-danger-cancel]');
      const confirmButton = dialog.querySelector('[data-danger-confirm-action]');
      const historyToken = token();
      let pushedHistory = false;
      let settled = false;

      const cleanup = () => {
        dialog.removeEventListener('cancel', onCancel);
        dialog.removeEventListener('click', onBackdropClick);
        windowRef?.removeEventListener?.('popstate', onPopState);
        if (dialog.open) dialog.close();
        dialog.remove();
        active = false;
      };

      const settle = (value, { fromHistory = false } = {}) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (pushedHistory && !fromHistory && historyRef?.state?.coastDangerConfirm === historyToken) {
          historyRef.back();
        }
        resolve(Boolean(value));
      };

      function onCancel(event) {
        event.preventDefault();
        settle(false);
      }

      function onBackdropClick(event) {
        if (event.target === dialog) settle(false);
      }

      function onPopState() {
        settle(false, { fromHistory: true });
      }

      cancelButton?.addEventListener('click', () => settle(false), { once: true });
      confirmButton?.addEventListener('click', () => settle(true), { once: true });
      dialog.addEventListener('cancel', onCancel);
      dialog.addEventListener('click', onBackdropClick);

      try {
        if (historyRef?.pushState && windowRef?.addEventListener) {
          historyRef.pushState({ ...(historyRef.state || {}), coastDangerConfirm: historyToken }, '');
          pushedHistory = true;
          // Modal-local browser-back listener; it exists only while the dialog is open
          // and cleanup removes it before the dialog is released.
          windowRef.addEventListener('popstate', onPopState);
        }
      } catch {
        pushedHistory = false;
      }

      try {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      } catch {
        dialog.setAttribute('open', '');
      }

      const focusCancel = () => cancelButton?.focus?.();
      if (typeof queueMicrotask === 'function') queueMicrotask(focusCancel);
      else setTimeout(focusCancel, 0);
    });
  };
}

export function confirmDanger(options) {
  if (!defaultConfirmer) defaultConfirmer = createDangerConfirmer();
  return defaultConfirmer(options);
}
