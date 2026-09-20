import {
  activeBranch,
  deleteActiveModelPartnerVariant,
  deleteActiveOwnerVariant,
  editOwnerVariant,
  switchVariant,
  toggleModelPartnerReaction,
} from '../chat-state.js';

export function createChatActions({
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
  attachments,
}) {
  function turnIdFrom(target) {
    return target.dataset.turn || target.closest('[data-turn]')?.dataset.turn || '';
  }

  async function submitComposer() {
    if (runtime.generation) {
      runtime.generation.controller.abort();
      return;
    }
    const pending = attachments?.current?.() || [];
    if (ui.input?.value.trim() || pending.length) {
      const sent = await send(ui.input?.value || '', pending);
      if (sent) attachments?.clearSent?.();
      return sent;
    }
    return;
  }

  function handleSubmit(name) {
    if (name === 'composer') return submitComposer();
  }

  function handleInput(name) {
    if (name === 'composer') composerState();
  }

  function handleChange(name, target) {
    return attachments?.handleChange?.(name, target);
  }

  async function handleAction(name, target) {
    const conversationId = target.dataset.id;
    if (name === 'composer-primary') return submitComposer();
    if (name === 'new') return newConversation();
    if (name === 'refresh') return refreshFromSource();
    if (name === 'open-type') return openRoomType(target.dataset.kind || 'main');
    if (['attachments-menu', 'attachment-image', 'attachment-file', 'attachment-remove'].includes(name)) {
      return attachments?.handleAction?.(name, target);
    }
    if (name === 'menu') return toggleMenu(conversationId);
    if (name === 'open') return loadConversation(conversationId);
    if (name === 'rename') return renameConversation(conversationId).catch((error) => toast(`改名失败：${error.message}`));
    if (name === 'delete-conversation') return deleteConversation(conversationId).catch((error) => toast(`删除失败：${error.message}`));

    const turnId = turnIdFrom(target);
    if (name === 'generation-detail') {
      const turn = currentHistory().turns.find((item) => item.id === turnId);
      const variant = turn ? activeBranch(turn).modelPartner : null;
      if (variant?.model_id) return toast(generationDetail(variant), 5200);
      return;
    }
    if (runtime.generation && runtime.generation.conversationId === runtime.currentId
      && ['switch-variant', 'edit-owner', 'delete-owner', 'delete-model-partner', 'regenerate'].includes(name)) {
      return toast('请先停止或等待当前回复完成。');
    }
    if (name === 'switch-variant') {
      const state = switchVariant(currentHistory(), turnId, target.dataset.kind, target.dataset.direction);
      setHistory(runtime.currentId, state);
      renderMessages();
      return saveHistory(runtime.currentId, state).catch(() => undefined);
    }
    if (name === 'edit-owner') {
      const turn = currentHistory().turns.find((item) => item.id === turnId);
      const branch = turn ? activeBranch(turn) : null;
      const content = prompt('编辑消息', branch?.owner?.content || '');
      if (content == null || content === branch?.owner?.content) return;
      const edited = editOwnerVariant(currentHistory(), turnId, content);
      setHistory(runtime.currentId, edited.state);
      renderMessages();
      const conversation = runtime.conversations.find((item) => item.id === runtime.currentId);
      if (conversation?.room_type === 'bridge') return saveHistory(runtime.currentId, edited.state).catch(() => undefined);
      return generate(runtime.currentId, turnId);
    }
    if (name === 'delete-owner') {
      const state = deleteActiveOwnerVariant(currentHistory(), turnId);
      setHistory(runtime.currentId, state);
      renderMessages();
      return saveHistory(runtime.currentId, state).catch(() => undefined);
    }
    if (name === 'delete-model-partner') {
      const state = deleteActiveModelPartnerVariant(currentHistory(), turnId);
      setHistory(runtime.currentId, state);
      renderMessages();
      return saveHistory(runtime.currentId, state).catch(() => undefined);
    }
    if (name === 'regenerate') {
      const conversation = runtime.conversations.find((item) => item.id === runtime.currentId);
      if (conversation?.room_type === 'bridge') return toast('这个桥接房间只保存文字，不调用模型 API 回复。');
      return generate(runtime.currentId, turnId);
    }
    if (name === 'copy') {
      const turn = currentHistory().turns.find((item) => item.id === turnId);
      const text = turn ? activeBranch(turn).modelPartner?.content || '' : '';
      await navigator.clipboard.writeText(text);
      return toast('已复制');
    }
    if (name === 'like' || name === 'favorite') {
      const reaction = name === 'like' ? 'liked' : 'favorite';
      const state = toggleModelPartnerReaction(currentHistory(), turnId, reaction);
      setHistory(runtime.currentId, state);
      renderMessages();
      return saveHistory(runtime.currentId, state).catch(() => undefined);
    }
  }

  return Object.freeze({ turnIdFrom, submitComposer, handleSubmit, handleInput, handleChange, handleAction });
}
