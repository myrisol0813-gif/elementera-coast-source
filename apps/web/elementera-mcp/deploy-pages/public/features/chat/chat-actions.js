import {
  activeBranch,
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
  saveHistory,
  generationDetail,
  generate,
  send,
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
    return toast('通话模式还没接入。先输入文字或添加附件。');
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

    const turnId = turnIdFrom(target);
    if (name === 'generation-detail') {
      const turn = currentHistory().turns.find((item) => item.id === turnId);
      const variant = turn ? activeBranch(turn).assistant : null;
      if (variant?.model_id) return toast(generationDetail(variant), 5200);
      return;
    }
    if (runtime.generation && runtime.generation.conversationId === runtime.currentId
      && ['switch-variant', 'edit-user', 'delete-user', 'delete-assistant', 'regenerate'].includes(name)) {
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
      const state = deleteActiveUserVariant(currentHistory(), turnId);
      setHistory(runtime.currentId, state);
      renderMessages();
      return saveHistory(runtime.currentId, state).catch(() => undefined);
    }
    if (name === 'delete-assistant') {
      const state = deleteActiveAssistantVariant(currentHistory(), turnId);
      setHistory(runtime.currentId, state);
      renderMessages();
      return saveHistory(runtime.currentId, state).catch(() => undefined);
    }
    if (name === 'regenerate') {
      const conversation = runtime.conversations.find((item) => item.id === runtime.currentId);
      if (conversation?.room_type === 'lighthouse') return toast('MCP 对话区只保存文字，不调用 API 模型伙伴回复。');
      return generate(runtime.currentId, turnId);
    }
    if (name === 'copy') {
      const turn = currentHistory().turns.find((item) => item.id === turnId);
      const text = turn ? activeBranch(turn).assistant?.content || '' : '';
      await navigator.clipboard.writeText(text);
      return toast('已复制');
    }
    if (name === 'like' || name === 'favorite') {
      const reaction = name === 'like' ? 'liked' : 'favorite';
      const state = toggleAssistantReaction(currentHistory(), turnId, reaction);
      setHistory(runtime.currentId, state);
      renderMessages();
      return saveHistory(runtime.currentId, state).catch(() => undefined);
    }
  }

  return Object.freeze({ turnIdFrom, submitComposer, handleSubmit, handleInput, handleChange, handleAction });
}
