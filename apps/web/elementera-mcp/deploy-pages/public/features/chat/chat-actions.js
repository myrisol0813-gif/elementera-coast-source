import {
  activeBranch,
  selectedAssistantMessage,
  deleteActiveAssistantVariant,
  deleteActiveUserVariant,
  editUserVariant,
  switchVariant,
  toggleAssistantReaction,
} from '../chat-state.js';

export function createChatActions({
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
  attachments,
  voice,
  windowSettings,
  treasures,
}) {
  function turnIdFrom(target) {
    return target.dataset.turn || target.closest('[data-turn]')?.dataset.turn || '';
  }

  async function submitComposer() {
    if (runtime.searchPreview?.has(runtime.currentId)) {
      toast('正在只读预览旧版本，请先点「结束预览」再继续聊天。');
      return false;
    }
    if (runtime.finalizing) return false;
    if (runtime.generation) {
      if (runtime.generation.conversationId !== runtime.currentId) return false;
      runtime.generation.controller.abort();
      return;
    }
    if (runtime.pendingComposerSend) return false;
    const pending = attachments?.current?.() || [];
    if (ui.input?.value.trim() || pending.length) {
      const id = runtime.currentId;
      const text = ui.input?.value || '';
      const revision = runtime.composerDrafts?.write(id, text);
      runtime.pendingComposerSend = id;
      try {
        const sent = await send(text, pending);
        if (sent) {
          runtime.composerDrafts?.accepted(id, revision);
          if (!runtime.pendingAttachmentConversationId || runtime.pendingAttachmentConversationId === id) attachments?.clearSent?.();
        }
        return sent;
      } finally {
        runtime.pendingComposerSend = null;
        composerState();
      }
    }
    return toast('通话模式还没接入。先输入文字或添加附件。');
  }

  function handleSubmit(name) {
    if (name === 'composer') return submitComposer();
  }

  function handleInput(name) {
    if (name === 'composer') {
      runtime.composerDrafts?.write(runtime.currentId, ui.input?.value || '');
      composerState();
    }
  }

  function handleChange(name, target) {
    return attachments?.handleChange?.(name, target);
  }

  async function handleAction(name, target) {
    const conversationId = target.dataset.id;
    if (name.startsWith('window-')) return windowSettings?.handleAction?.(name, target);
    if (name === 'composer-primary') return submitComposer();
    if (name === 'generate-image') {
      attachments?.closeMenu?.();
      if(runtime.searchPreview?.has(runtime.currentId))return toast('请先结束旧版本预览。');
      if(attachments?.current?.().length||runtime.attachmentUploading)return toast('手动生图暂不接收参考图或文件，请先移除待发送附件。');
      return sendImage(ui.input?.value||'');
    }
    if (name === 'new') return newConversation();
    if (name === 'refresh') return refreshFromCoast();
    if (name === 'open-type') return openRoomType(target.dataset.kind || 'main');
    if (name === 'toggle-rikkahub') return toggleRikkaHub();
    if (name === 'import-rikkahub') return importRikkaHub();
    if (['attachments-menu', 'attachment-image', 'attachment-file', 'attachment-remove'].includes(name)) {
      return attachments?.handleAction?.(name, target);
    }
    if (name === 'menu') return toggleMenu(conversationId);
    if (name === 'open') return loadConversation(conversationId);
    if (name === 'rename') return renameConversation(conversationId).catch((error) => toast(`改名失败：${error.message}`));
    if (name === 'delete-conversation') return deleteConversation(conversationId).catch((error) => toast(`删除失败：${error.message}`));
    if (name === 'mic') return toast('语音输入还没接入。');

    if (name === 'end-search-preview') {
      runtime.searchPreview?.delete(runtime.currentId);
      renderMessages();
      toast('已回到正式聊天分支，未修改任何历史消息。');
      return;
    }
    const inPreview = runtime.searchPreview?.has(runtime.currentId);
    if (inPreview && !['favorite', 'copy'].includes(name)) {
      toast('旧版本正在只读预览。请先结束预览，再修改或生成聊天。');
      return;
    }
    const turnId = turnIdFrom(target);
    const messageId=target.closest('[data-message-id]')?.dataset.messageId || '';
    if (name === 'generation-detail') {
      const turn = currentHistory().turns.find((item) => item.id === turnId);
      const variant = turn ? selectedAssistantMessage(turn,messageId) : null;
      if (variant?.model_id) return toast(generationDetail(variant), 5200);
      return;
    }
    if ((runtime.generation || runtime.finalizing || runtime.pendingComposerSend)
      && ['switch-variant', 'edit-user', 'delete-user', 'delete-assistant', 'regenerate', 'like'].includes(name)) {
      return toast('请先停止或等待当前回复完成。');
    }
    if (name === 'switch-variant') {
      const state = switchVariant(currentHistory(), turnId, target.dataset.kind, target.dataset.direction);
      setHistory(runtime.currentId, state);
      renderMessages();
      return saveHistory(runtime.currentId, state).catch(() => undefined);
    }
    if (name === 'edit-user') {
      const turn = currentHistory().turns.find((item) => item.id === turnId);
      const branch = turn ? activeBranch(turn) : null;
      const content = prompt('编辑消息', branch?.user?.content || '');
      if (content == null || content === branch?.user?.content) return;
      const edited = editUserVariant(currentHistory(), turnId, content);
      setHistory(runtime.currentId, edited.state);
      renderMessages();
      const conversation = runtime.conversations.find((item) => item.id === runtime.currentId);
      if (conversation?.room_type === 'lighthouse') return saveHistory(runtime.currentId, edited.state).catch(() => undefined);
      return generate(runtime.currentId, turnId);
    }
    if (name === 'delete-user') {
      const previous=currentHistory();
      const state = deleteActiveUserVariant(previous, turnId);
      setHistory(runtime.currentId, state);
      renderMessages();
      return saveHistory(runtime.currentId, state,{deleteRevision:previous.updated_at}).catch(() => undefined);
    }
    if (name === 'delete-assistant') {
      const previous=currentHistory();
      const state = deleteActiveAssistantVariant(previous, turnId);
      setHistory(runtime.currentId, state);
      renderMessages();
      return saveHistory(runtime.currentId, state,{deleteRevision:previous.updated_at}).catch(() => undefined);
    }
    if (name === 'regenerate') {
      const conversation = runtime.conversations.find((item) => item.id === runtime.currentId);
      if (conversation?.room_type === 'lighthouse') return toast('MCP 对话区只保存文字，不调用 API 模型伙伴回复。');
      return generate(runtime.currentId, turnId);
    }
    if (name === 'voice') return voice.select(target);
    if (name === 'copy') {
      const visible = runtime.searchPreview?.get(runtime.currentId) || currentHistory();
      const turn = visible.turns.find((item) => item.id === turnId);
      const assistant=turn ? selectedAssistantMessage(turn,messageId) : null;
      if (!assistant) return toast('原消息版本已经改变，请重新打开。');
      await navigator.clipboard.writeText(assistant.content || '');
      return toast('已复制');
    }
    if (name === 'favorite') return treasures?.open(target);
    if (name === 'like') {
      const current=currentHistory();
      const turn=current.turns.find(item=>item.id===turnId);
      if (!turn || !selectedAssistantMessage(turn,messageId)) return toast('原消息版本已经改变，请重新打开。');
      const state = toggleAssistantReaction(current, turnId, 'liked', messageId);
      setHistory(runtime.currentId, state);
      renderMessages();
      return saveHistory(runtime.currentId, state).catch(() => undefined);
    }
  }

  return Object.freeze({ turnIdFrom, submitComposer, handleSubmit, handleInput, handleChange, handleAction });
}
