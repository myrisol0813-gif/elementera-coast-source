import { API, requestJson } from '../core/api.js';
import { q, qa, sanitizeId } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { activeMessages, createState, flatMessagesToState, normalizeState } from './chat-state.js';
import { createChatActions } from './chat/chat-actions.js';
import { createChatAttachments } from './chat/chat-attachments.js';
import { createChatConversations } from './chat/chat-conversations.js';
import { createChatGeneration } from './chat/chat-generation.js';
import {
  DEFAULT_MODEL,
  cleanProfile,
  emptyProfile,
  shortModelName,
} from './chat/chat-profile.js';
import { createChatRender, generationDetail } from './chat/chat-render.js';
import { createCoastSseParser } from './chat/chat-stream.js';

export { createCoastSseParser, shortModelName };

const ROOM_TYPE_LABELS = Object.freeze({ main: '主聊天', radio: '无线电波', lighthouse: '灯塔来信' });
const HANDLER_NAMES = Object.freeze({
  click: 'handleAction',
  submit: 'handleSubmit',
  input: 'handleInput',
  change: 'handleChange',
});

export function createChat({ storage, toast, humanThought }) {
  const runtime = {
    conversations: [],
    histories: new Map(),
    currentId: '',
    composerReady: false,
    openMenuId: '',
    deletedIds: new Set(),
    saveChains: new Map(),
    recallHistory: new Map(),
    profileChain: Promise.resolve(),
    profile: emptyProfile(),
    generation: null,
    memory: null,
    desk: null,
    profileListeners: new Set(),
    runSettings: () => storage.read().runControl,
  };

  const ui = {};

  function bindUi() {
    ui.root = q('#chatWindow');
    ui.list = q('#chatConversationList');
    ui.messages = q('#messages');
    ui.scroller = q('#messageScroller');
    ui.form = q('#composer');
    ui.input = q('#promptInput');
    ui.primary = q('#composerActionButton');
    ui.mic = q('#micButton');
    ui.attachmentButton = q('#attachmentButton');
    ui.attachmentMenu = q('#attachmentMenu');
    ui.attachmentTray = q('#composerAttachmentTray');
    ui.attachmentImageInput = q('#attachmentImageInput');
    ui.attachmentFileInput = q('#attachmentFileInput');
    ui.status = q('#chatStatus');
    ui.modelName = q('#modelName');
    ui.humanThought = q('#mainHumanThoughtComposer');
  }

  function setStatus(message = '', kind = 'error') {
    if (!ui.status) return;
    ui.status.textContent = message;
    ui.status.dataset.kind = kind;
    ui.status.hidden = !message;
  }

  function notifyProfile() {
    refreshModelLabel();
    runtime.profileListeners.forEach((listener) => listener(runtime.profile));
  }

  function refreshModelLabel() {
    const model = runtime.profile.current_chat_model || DEFAULT_MODEL;
    if (ui.modelName) {
      ui.modelName.textContent = `${model} ›`;
      ui.modelName.title = model;
    }
  }

  function closeMenu() {
    runtime.openMenuId = '';
    qa('[data-conversation-menu]', ui.list).forEach((menu) => { menu.hidden = true; });
    qa('[data-action="chat:menu"]', ui.list).forEach((button) => button.setAttribute('aria-expanded', 'false'));
  }

  function toggleMenu(conversationId) {
    const id = sanitizeId(conversationId, 'conversation');
    const row = qa('[data-conversation-id]', ui.list).find((item) => item.dataset.conversationId === id);
    if (!row) return;
    const menu = q('[data-conversation-menu]', row);
    const button = q('[data-action="chat:menu"]', row);
    const open = runtime.openMenuId !== id || menu.hidden;
    closeMenu();
    if (!open) return;
    runtime.openMenuId = id;
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => menu.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));
  }

  function currentHistory() {
    return runtime.histories.get(runtime.currentId) || createState();
  }

  function setHistory(conversationId, value) {
    const state = normalizeState(value);
    runtime.histories.set(conversationId, state);
    return state;
  }

  function setComposerReady(ready, placeholder = '') {
    runtime.composerReady = ready === true;
    if (ui.form) {
      ui.form.setAttribute('aria-busy', runtime.composerReady ? 'false' : 'true');
      ui.form.dataset.ready = runtime.composerReady ? 'true' : 'false';
    }
    if (ui.input) {
      ui.input.disabled = !runtime.composerReady;
      ui.input.placeholder = runtime.composerReady ? '询问任何问题' : (placeholder || '正在连接海岸…');
    }
    composerState();
  }

  function composerState() {
    if (!ui.input || !ui.primary) return;
    ui.input.style.height = '22px';
    ui.input.style.height = `${Math.min(Math.max(ui.input.scrollHeight, 22), 112)}px`;
    ui.input.style.overflowY = ui.input.scrollHeight > 112 ? 'auto' : 'hidden';
    const generating = Boolean(runtime.generation);
    const hasText = Boolean(ui.input.value.trim());
    const hasAttachments = Boolean(
      Array.isArray(runtime.pendingAttachments)
      && runtime.pendingAttachments.length
      && (!runtime.pendingAttachmentConversationId || runtime.pendingAttachmentConversationId === runtime.currentId),
    );
    const uploading = runtime.attachmentUploading === true;
    const canSend = hasText || hasAttachments;
    const name = generating ? 'stop' : canSend ? 'send' : 'call';
    ui.primary.innerHTML = icon(name);
    ui.primary.disabled = generating ? false : (!runtime.composerReady || uploading);
    ui.primary.setAttribute('aria-label', !runtime.composerReady && !generating
      ? '聊天正在载入'
      : uploading ? '附件正在上传'
        : generating ? '停止生成' : canSend ? '发送' : '通话');
    if (ui.mic) {
      ui.mic.hidden = generating || canSend || uploading;
      ui.mic.disabled = !runtime.composerReady || uploading;
    }
    if (ui.attachmentButton) ui.attachmentButton.disabled = !runtime.composerReady || generating || uploading;
  }

  const chatAttachments = createChatAttachments({ runtime, ui, toast, composerState });

  const { renderConversationList, renderMessages, patchModelPartnerStreamingText } = createChatRender({
    runtime,
    ui,
    closeMenu,
    roomTypeLabels: ROOM_TYPE_LABELS,
  });

  async function persistProfile(profile) {
    const data = await requestJson(API.profile, {
      method: 'PUT',
      body: JSON.stringify({ profile }),
    });
    runtime.profile = cleanProfile(data.profile || profile);
    notifyProfile();
    renderMessages();
    return runtime.profile;
  }

  function updateProfile(patch) {
    runtime.profileChain = runtime.profileChain.catch(() => undefined).then(() => {
      const next = cleanProfile({
        ...runtime.profile,
        ...patch,
        model_box: patch.model_box || runtime.profile.model_box,
      });
      return persistProfile(next);
    }).catch((error) => {
      setStatus(`个人设置写入失败：${error.message}`, 'error');
      throw error;
    });
    return runtime.profileChain;
  }

  const {
    fetchConversations,
    createConversation,
    loadConversation,
    saveHistory,
    openRoomType,
    newConversation,
    renameConversation,
    deleteConversation,
  } = createChatConversations({
    runtime,
    storage,
    humanThought,
    toast,
    ui,
    roomTypeLabels: ROOM_TYPE_LABELS,
    setComposerReady,
    setStatus,
    setHistory,
    renderConversationList,
    renderMessages,
    closeMenu,
  });


  async function refreshFromSource() {
    if (runtime.generation) {
      toast('当前回复还在生成，完成后再刷新海岸。');
      return false;
    }
    setStatus('正在刷新当前状态…', 'loading');
    try {
      const profileData = await requestJson(API.profile);
      runtime.profile = cleanProfile(profileData.profile || {});
      notifyProfile();
      await fetchConversations();
      renderConversationList();

      let target = runtime.conversations.find((item) => item.id === runtime.currentId)
        || runtime.conversations.find((item) => item.id === storage.getCurrentConversation())
        || runtime.conversations[0]
        || null;
      if (!target) {
        target = await createConversation('新聊天', 'main');
        renderConversationList();
      }
      const loaded = await loadConversation(target.id);
      if (loaded) toast('当前状态已刷新');
      return loaded;
    } catch (error) {
      setStatus(`刷新失败：${error.message}`, 'error');
      toast(`刷新失败：${error.message}`);
      return false;
    }
  }

  const {
    generate,
    sendLandingLetter,
    send,
  } = createChatGeneration({
    runtime,
    ui,
    toast,
    humanThought,
    currentHistory,
    setHistory,
    composerState,
    renderMessages,
    patchModelPartnerStreamingText,
    renderConversationList,
    saveHistory,
  });

  const {
    handleAction,
    handleSubmit,
    handleInput,
    handleChange,
  } = createChatActions({
    runtime,
    ui,
    toast,
    currentHistory,
    setHistory,
    composerState,
    renderMessages,
    saveHistory,
    generationDetail,
    generate,
    send,
    newConversation,
    openRoomType,
    refreshFromSource,
    toggleMenu,
    loadConversation,
    renameConversation,
    deleteConversation,
    attachments: chatAttachments,
  });

  async function bootstrap() {
    setStatus('正在载入聊天窗口…', 'loading');
    ui.list.innerHTML = '<p class="sidebar-empty">正在载入…</p>';
    try {
      const [profileData] = await Promise.all([
        requestJson(API.profile),
        fetchConversations(),
      ]);
      runtime.profile = cleanProfile(profileData.profile || {});
      notifyProfile();
      if (!runtime.conversations.length) runtime.conversations = [await createConversation('新聊天', 'main')];
      const remembered = storage.getCurrentConversation();
      const target = runtime.conversations.find((item) => item.id === remembered) || runtime.conversations[0];
      await loadConversation(target.id);
    } catch (error) {
      setComposerReady(false, '聊天窗口载入失败');
      setStatus(`聊天窗口载入失败：${error.message}`, 'error');
      ui.list.innerHTML = '<p class="sidebar-empty">无法载入聊天窗口</p>';
    }
  }

  function observeEvent(event) {
    if (event.type === 'click' && !event.target?.closest?.('[data-conversation-id]')) closeMenu();
    if (event.type === 'click' && !event.target?.closest?.('.composer-attachment-anchor')) chatAttachments.closeMenu();
  }

  function ownsEvent(_event, context) {
    const handlerName = HANDLER_NAMES[context.eventType];
    if (context.namespace !== 'chat' || typeof ({ handleAction, handleSubmit, handleInput, handleChange })[handlerName] !== 'function') return false;
    return { preventDefault: context.eventType === 'click' || context.eventType === 'submit' };
  }

  function handleEvent(event, context) {
    const handlers = { handleAction, handleSubmit, handleInput, handleChange };
    return handlers[HANDLER_NAMES[context.eventType]]?.(context.name, context.target, event);
  }

  async function mount() {
    bindUi();
    setComposerReady(false, '正在连接海岸…');
    await bootstrap();
    chatAttachments.refresh();
    composerState();
  }

  function refresh() {
    closeMenu();
    chatAttachments.refresh();
    composerState();
  }

  function destroy() {
    closeMenu();
  }

  return Object.freeze({
    id: 'chat',
    priority: 80,
    mountOrder: 70,
    refreshOnNavigation: true,
    observeEvent,
    ownsEvent,
    handleEvent,
    mount,
    refresh,
    destroy,
    handleAction,
    handleSubmit,
    handleInput,
    handleChange,
    closeMenu,
    renderConversationList,
    renderMessages,
    refreshFromSource,
    getActiveMessages: () => activeMessages(currentHistory()),
    getCurrentConversationId: () => runtime.currentId,
    getCurrentConversation: () => runtime.conversations.find((item) => item.id === runtime.currentId) || null,
    openRoomType,
    getProfile: () => runtime.profile,
    getRunSettings: () => runtime.runSettings() || {},
    sendLandingLetter,
    updateProfile,
    importFlatMessages: async (messages) => {
      if (!runtime.currentId) throw new Error('当前没有聊天窗口');
      const state = flatMessagesToState(messages);
      setHistory(runtime.currentId, state);
      renderMessages();
      await saveHistory(runtime.currentId, state);
    },
    onProfile(listener) {
      runtime.profileListeners.add(listener);
      return () => runtime.profileListeners.delete(listener);
    },
    setRunSettingsProvider(provider) {
      runtime.runSettings = provider;
    },
    setMemoryController(controller) {
      runtime.memory = controller;
    },
    setDeskController(controller) {
      runtime.desk = controller;
    },
  });
}
