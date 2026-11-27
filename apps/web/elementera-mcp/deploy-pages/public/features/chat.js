import { API, requestJson } from '../core/api.js';
import { q, qa, sanitizeId } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { activeMessages, createState, flatMessagesToState, normalizeState } from './chat-state.js';
import { createChatActions } from './chat/chat-actions.js';
import { createChatAttachments } from './chat/chat-attachments.js';
import { createChatVoice } from './chat/chat-voice.js';
import { createChatTreasures } from './chat/chat-treasures.js';
import { createChatWindowSettings } from './chat/chat-window-settings.js';
import { createChatConversations } from './chat/chat-conversations.js';
import { createChatGeneration } from './chat/chat-generation.js';
import {
  DEFAULT_MODEL,
  cleanProfile,
  emptyProfile,
  mergeMigrationProfile,
  shortModelName,
} from './chat/chat-profile.js';
import { createChatRender, generationDetail } from './chat/chat-render.js';
import { importRikkaHubPackage, pickRikkaHubPackage } from './chat/chat-rikkahub.js';
import { createCoastSseParser } from './chat/chat-stream.js';

export { createCoastSseParser, shortModelName };

const ROOM_TYPE_LABELS = Object.freeze({ main: '主聊天', radio: '共通聊天室', lighthouse: 'MCP 对话区' });
const HANDLER_NAMES = Object.freeze({
  click: 'handleAction',
  submit: 'handleSubmit',
  input: 'handleInput',
  change: 'handleChange',
});

export function createChat({ storage, toast, dogtalk }) {
  const runtime = {
    conversations: [],
    histories: new Map(),
    treasureIndicators: new Map(),
    searchPreview: new Map(),
    rikkahubAttachments: new Map(),
    rikkahubExpanded: false,
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
    letters: null,
    profileListeners: new Set(),
    runSettings: () => storage.read().runControl,
  };

  const ui = {};
  // Device-only composer text, isolated by the real conversation ID.
  const drafts = new Map();
  const draftKey = (id) => 'coast.composer.draft.v1.' + encodeURIComponent(id);
  runtime.composerDrafts = {
    read(id) {
      if (!id) return '';
      if (drafts.has(id)) return drafts.get(id).text;
      try { return localStorage.getItem(draftKey(id)) || ''; }
      catch { toast('本机输入草稿无法读取。'); return ''; }
    },
    write(id, text) {
      if (!id) return null;
      const revision = { text };
      drafts.set(id, revision);
      try {
        if (text) localStorage.setItem(draftKey(id), text);
        else localStorage.removeItem(draftKey(id));
      } catch { toast('输入草稿未能保存，请暂勿刷新或关闭页面。'); }
      return revision;
    },
    accepted(id, revision) {
      if (!revision || drafts.get(id) !== revision) return;
      this.write(id, '');
      if (runtime.currentId === id && ui.input?.value === revision.text) ui.input.value = '';
    },
    remove(id) { this.write(id, ''); drafts.delete(id); },
  };

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
    ui.dogtalk = q('#mainDogtalkComposer');
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
    runtime.searchPreview.delete(conversationId);
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
      ui.input.placeholder = runtime.composerReady ? '询问任何问题' : (placeholder || '正在连接…');
    }
    composerState();
  }

  function composerState() {
    if (!ui.input || !ui.primary) return;
    ui.input.style.height = '22px';
    ui.input.style.height = `${Math.min(Math.max(ui.input.scrollHeight, 22), 112)}px`;
    ui.input.style.overflowY = ui.input.scrollHeight > 112 ? 'auto' : 'hidden';
    const generating = runtime.generation?.conversationId === runtime.currentId;
    const background = Boolean(runtime.generation && !generating);
    const finalizing = Boolean(background || runtime.finalizing || (runtime.pendingComposerSend && !generating));
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
    ui.primary.disabled = finalizing || (!generating && (!runtime.composerReady || uploading));
    ui.primary.setAttribute('aria-label', background ? '另一个窗口正在生成；可以先写草稿' : !runtime.composerReady && !generating
      ? '聊天正在载入'
      : uploading ? '附件正在上传'
        : generating ? '停止生成' : canSend ? '发送' : '通话');
    if (ui.mic) {
      ui.mic.hidden = generating || finalizing || canSend || uploading;
      ui.mic.disabled = !runtime.composerReady || finalizing || uploading;
    }
    if (ui.attachmentButton) ui.attachmentButton.disabled = !runtime.composerReady || generating || finalizing || uploading;
  }

  const chatAttachments = createChatAttachments({ runtime, ui, toast, composerState });

  const { renderConversationList, renderMessages, patchAssistantStreamingText } = createChatRender({
    runtime,
    ui,
    closeMenu,
    roomTypeLabels: ROOM_TYPE_LABELS,
  });

  const voice = createChatVoice({ runtime, toast, renderMessages });
  const treasures = createChatTreasures({ runtime, currentHistory, toast, renderMessages });

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
    migrateLocalConversations,
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
    dogtalk,
    toast,
    ui,
    roomTypeLabels: ROOM_TYPE_LABELS,
    setComposerReady,
    setStatus,
    setHistory,
    renderConversationList,
    renderMessages,
    closeMenu,
    voice,
    refreshTreasureIndex: treasures.refreshIndex,
  });

  const windowSettings = createChatWindowSettings({
    runtime,
    currentHistory,
    setHistory,
    saveHistory,
    renderConversationList,
    renderMessages,
    toast,
  });

  function toggleRikkaHub() {
    runtime.rikkahubExpanded = !runtime.rikkahubExpanded;
    renderConversationList();
  }

  async function importRikkaHub() {
    if (runtime.generation) {
      toast('当前回复还在生成，完成后再导入旧窗口。');
      return;
    }
    const file = await pickRikkaHubPackage();
    if (!file) return;
    setStatus('正在把 RikkaHub 旧窗口送回前端…', 'loading');
    try {
      const summary = await importRikkaHubPackage(file);
      await fetchConversations();
      runtime.rikkahubExpanded = true;
      renderConversationList();
      setStatus('');
      toast(`已导入 ${summary.conversations} 个 RikkaHub 窗口 · ${summary.messages} 条消息 · ${summary.attachments} 个附件`);
    } catch (error) {
      setStatus(`RikkaHub 导入失败：${error.message}`, 'error');
      toast(`RikkaHub 导入失败：${error.message}`);
    }
  }

  async function refreshFromCoast() {
    if (runtime.generation) {
      toast('当前回复还在生成，完成后再刷新前端。');
      return false;
    }
    setStatus('正在刷新前端状态…', 'loading');
    try {
      const profileData = await requestJson(API.profile);
      runtime.profile = cleanProfile(profileData.profile || {});
      notifyProfile();
      await fetchConversations();
      renderConversationList();

      let target = runtime.conversations.find((item) => item.id === runtime.currentId)
        || runtime.conversations.find((item) => item.id === storage.getCurrentConversation())
        || runtime.conversations.find((item) => item.source !== 'rikkahub')
        || runtime.conversations[0]
        || null;
      if (!target) {
        target = await createConversation('新聊天', 'main');
        renderConversationList();
      }
      const loaded = await loadConversation(target.id);
      if (loaded) toast('前端状态已刷新');
      return loaded;
    } catch (error) {
      setStatus(`前端刷新失败：${error.message}`, 'error');
      toast(`前端刷新失败：${error.message}`);
      return false;
    }
  }

  const {
    generate,
    sendLandingLetter,
    send,
    sendImage,
  } = createChatGeneration({
    runtime,
    ui,
    toast,
    dogtalk,
    currentHistory,
    setHistory,
    composerState,
    renderMessages,
    patchAssistantStreamingText,
    renderConversationList,
    saveHistory,
    voice,
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
    renderConversationList,
    saveHistory,
    generationDetail,
    generate,
    send,
    sendImage,
    newConversation,
    openRoomType,
    refreshFromCoast,
    toggleMenu,
    loadConversation,
    renameConversation,
    deleteConversation,
    toggleRikkaHub,
    importRikkaHub,
    attachments: chatAttachments,
    voice,
    windowSettings,
    treasures,
  });

  async function bootstrap() {
    setStatus('正在载入聊天窗口…', 'loading');
    ui.list.innerHTML = '<p class="sidebar-empty">正在载入…</p>';
    try {
      const [profileData] = await Promise.all([
        requestJson(API.profile),
        fetchConversations(),
      ]);
      const merged = mergeMigrationProfile(profileData.profile, storage.migrationProfile);
      runtime.profile = merged;
      if (storage.migrationPending && JSON.stringify(merged) !== JSON.stringify(cleanProfile(profileData.profile))) {
        await persistProfile(merged);
      } else notifyProfile();
      const migratedIds = await migrateLocalConversations();
      if (!runtime.conversations.length) runtime.conversations = [await createConversation('新聊天', 'main')];
      const remembered = storage.getCurrentConversation();
      const migratedRemembered = migratedIds.get(remembered) || remembered;
      if (migratedRemembered !== remembered) storage.setCurrentConversation(migratedRemembered);
      const target = runtime.conversations.find((item) => item.id === migratedRemembered)
        || runtime.conversations.find((item) => item.source !== 'rikkahub')
        || runtime.conversations[0];
      const loaded = await loadConversation(target.id);
      if (loaded) storage.completeMigration();
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

  // Search navigation previews an inactive branch locally; it does not silently
  // rewrite the owner's persisted choice of active variants.
  async function openSearchResult(hit) {
    if (!hit?.conversation_id) return false;
    if (!await loadConversation(hit.conversation_id)) return false;
    if (hit.kind === 'conversation') {
      if (ui.scroller) ui.scroller.scrollTop = 0;
      return true;
    }
    const original = currentHistory();
    const index = original.turns.findIndex((turn) => turn.id === hit.turn_id);
    if (index < 0) { toast('原始轮次已不存在，无法定位。'); return false; }
    const state = structuredClone(original);
    const turn = state.turns[index];
    const id = hit.message_id;
    let userIndex = -1, assistantIndex = -1;
    if (hit.role === 'user') {
      userIndex = turn.user.variants.findIndex((variant) => variant.id === id);
    } else {
      for (let i = 0; i < turn.user.variants.length; i += 1) {
        const variants = turn.assistant.variantsByUserVariant[String(i)] || [];
        const candidate = variants.findIndex((variant) => variant.id === id);
        if (candidate >= 0) { userIndex = i; assistantIndex = candidate; break; }
      }
    }
    if (userIndex < 0) { toast('消息版本已不存在，未跳转到其他版本。'); return false; }
    turn.user.active = userIndex;
    if (assistantIndex >= 0) turn.assistant.activeByUserVariant[String(userIndex)] = assistantIndex;
    // Display this inactive branch without changing canonical writable history.
    runtime.searchPreview.set(hit.conversation_id, state);
    renderMessages(hit.conversation_id);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const elements = [...(ui.messages?.querySelectorAll('.message') || [])];
        const target = elements.find((element) => element.dataset.messageId === id)
          || elements.find((element) => element.dataset.turn === hit.turn_id
            && element.classList.contains(hit.role));
        if (!target) { toast('已打开窗口，但原消息无法在当前视图定位。'); return; }
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.classList.add('coast-search-target');
        setTimeout(() => target.classList.remove('coast-search-target'), 2600);
      });
    });
    return true;
  }

  async function mount() {
    bindUi();
    setComposerReady(false, '正在连接…');
    await bootstrap();
    chatAttachments.refresh();
    composerState();
  }

  function refresh() {
    closeMenu();
    windowSettings.close();
    chatAttachments.refresh();
    composerState();
  }

  function destroy() {
    closeMenu();
    windowSettings.close();
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
    refreshFromCoast,
    getActiveMessages: () => activeMessages(currentHistory()),
    getCurrentConversationId: () => runtime.currentId,
    openSearchResult,
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
    setDreamTideController(controller) {
      runtime.dreamTide = controller;
    },
    setLettersController(controller) {
      runtime.letters = controller;
    },
  });
}
