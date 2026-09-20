import { API, requestJson } from '../../core/api.js';
import { sanitizeId } from '../../core/dom.js';
import { createState, normalizeState } from '../chat-state.js';

export function createChatConversations({
  runtime,
  storage,
  humanThought,
  toast,
  ui,
  roomTypeLabels,
  setComposerReady,
  setStatus,
  setHistory,
  renderConversationList,
  renderMessages,
  closeMenu,
}) {
  async function fetchConversations() {
    const data = await requestJson(API.conversations);
    const seen = new Set();
    runtime.conversations = (Array.isArray(data.conversations) ? data.conversations : [])
      .filter((conversation) => conversation?.id && !seen.has(conversation.id) && seen.add(conversation.id))
      .map((conversation) => ({
        ...conversation,
        source: conversation.source || 'source',
        source_window_id: conversation.source_window_id || '',
      }));
  }


  async function createConversation(title = '新聊天', roomType = 'main') {
    const type = roomTypeLabels[roomType] ? roomType : 'main';
    const data = await requestJson(API.conversations, { method: 'POST', body: JSON.stringify({ title, room_type: type }) });
    const conversation = {
      ...data.conversation,
      source: data.conversation?.source || 'source',
      source_window_id: data.conversation?.source_window_id || '',
    };
    runtime.conversations = [conversation, ...runtime.conversations.filter((item) => item.id !== conversation.id)];
    runtime.histories.set(conversation.id, createState());
    return conversation;
  }

  async function loadConversation(value) {
    const conversationId = sanitizeId(value, 'conversation');
    if (runtime.deletedIds.has(conversationId)) return false;
    const conversation = runtime.conversations.find((item) => item.id === conversationId) || null;
    setComposerReady(false, '正在载入聊天记录…');
    runtime.currentId = conversationId;
    storage.setCurrentConversation(conversationId);
    renderConversationList();
    setStatus('正在载入聊天记录…', 'loading');
    const cached = runtime.histories.get(conversationId) || createState();
    runtime.desk?.onConversationChanged(cached, conversationId);
    if (!runtime.histories.has(conversationId)) runtime.histories.set(conversationId, cached);
    renderMessages(conversationId);
    try {
      const data = await requestJson(`${API.history}?conversation_id=${encodeURIComponent(conversationId)}`);
      setHistory(conversationId, data.history || {});
      setStatus('');
      renderMessages(conversationId);
      setComposerReady(true);
      runtime.memory?.onConversationChanged(conversationId)?.catch((error) => console.warn('[memory:conversation]', error));
      runtime.desk?.onConversationChanged(data.history || {}, conversationId);
      humanThought?.mountComposer(ui.humanThought, {
        room_scope: 'conversation',
        conversation_id: conversationId,
      });
      return true;
    } catch (error) {
      setComposerReady(false, '聊天记录载入失败');
      setStatus(`聊天记录载入失败：${error.message}`, 'error');
      return false;
    }
  }

  function saveHistory(conversationId, value) {
    if (runtime.deletedIds.has(conversationId)) return Promise.resolve();
    const snapshot = normalizeState(value);
    runtime.histories.set(conversationId, snapshot);
    const previous = runtime.saveChains.get(conversationId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      if (runtime.deletedIds.has(conversationId)) return;
      await requestJson(`${API.history}?conversation_id=${encodeURIComponent(conversationId)}`, {
        method: 'PUT',
        body: JSON.stringify(snapshot),
      });
      if (runtime.currentId === conversationId) setStatus('');
    }).catch((error) => {
      if (runtime.currentId === conversationId && !runtime.deletedIds.has(conversationId)) {
        setStatus(`聊天记录写入失败：${error.message}`, 'error');
      }
      throw error;
    });
    runtime.saveChains.set(conversationId, next);
    next.finally(() => {
      if (runtime.saveChains.get(conversationId) === next) runtime.saveChains.delete(conversationId);
    }).catch(() => undefined);
    return next;
  }

  async function openRoomType(roomType = 'main') {
    const type = roomTypeLabels[roomType] ? roomType : 'main';
    let conversation = runtime.conversations.find((item) => item.room_type === type);
    if (!conversation) conversation = await createConversation(roomTypeLabels[type], type);
    return loadConversation(conversation.id);
  }

  async function newConversation() {
    try {
      const current = runtime.conversations.find((item) => item.id === runtime.currentId);
      const roomType = current?.room_type || 'main';
      const conversation = await createConversation('新聊天', roomType);
      await loadConversation(conversation.id);
    } catch (error) {
      toast(`新建窗口失败：${error.message}`);
    }
  }

  async function renameConversation(conversationId) {
    const current = runtime.conversations.find((item) => item.id === conversationId);
    const title = prompt('给这个窗口改名', current?.title || '新聊天');
    if (title == null || !title.trim()) return;
    const data = await requestJson(`${API.conversations}/${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: title.trim() }),
    });
    runtime.conversations = runtime.conversations.map((item) => item.id === conversationId
      ? {
        ...data.conversation,
        source: data.conversation?.source || current?.source || 'source',
        source_window_id: data.conversation?.source_window_id || current?.source_window_id || '',
      }
      : item);
    renderConversationList();
  }

  async function deleteConversation(conversationId) {
    runtime.deletedIds.add(conversationId);
    closeMenu();
    if (runtime.generation?.conversationId === conversationId) runtime.generation.controller.abort();
    const deleted = runtime.conversations.find((item) => item.id === conversationId) || null;
    try {
      await requestJson(`${API.conversations}/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
    } catch (error) {
      runtime.deletedIds.delete(conversationId);
      throw error;
    }
    runtime.conversations = runtime.conversations.filter((item) => item.id !== conversationId);
    runtime.histories.delete(conversationId);
    runtime.recallHistory.delete(conversationId);
    if (runtime.currentId === conversationId) {
      let next = runtime.conversations.find((item) => item.room_type === deleted?.room_type)
        || runtime.conversations[0]
        || runtime.conversations[0]
        || null;
      if (!next) next = await createConversation('新聊天', deleted?.room_type || 'main');
      await loadConversation(next.id);
    } else renderConversationList();
  }

  return Object.freeze({
    fetchConversations,
    createConversation,
    loadConversation,
    saveHistory,
    openRoomType,
    newConversation,
    renameConversation,
    deleteConversation,
  });
}
