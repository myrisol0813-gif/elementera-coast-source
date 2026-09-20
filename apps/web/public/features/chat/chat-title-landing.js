import { API, requestJson } from '../../core/api.js';
import { activeBranch, normalizeState } from '../chat-state.js';
import { localDateKey, localDateTimeKey } from './chat-local-time.js';

export function createChatTitleLanding({
  runtime,
  composerState,
  chatRequestContext,
  setHistory,
  renderMessages,
  renderConversationList,
}) {
  async function autoTitle(conversationId, history, turnId) {
    if (normalizeState(history).turns.length !== 1) return;
    const conversation = runtime.conversations.find((item) => item.id === conversationId);
    if (!conversation || conversation.title_manual || conversation.title_generated_at) return;
    const turn = history.turns.find((item) => item.id === turnId);
    const branch = turn ? activeBranch(turn) : null;
    if (branch?.owner?.hidden) return;
    const data = await requestJson(API.title, {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: conversationId,
        owner: branch?.owner?.content || '',
        model_partner: branch?.modelPartner?.content || '',
      }),
    });
    if (data.conversation) {
      runtime.conversations = runtime.conversations.map((item) => (
        item.id === conversationId ? data.conversation : item
      ));
      renderConversationList();
    }
  }

  async function autoTitleFromLanding(conversationId, letterText, modelPartnerText) {
    const conversation = runtime.conversations.find((item) => item.id === conversationId);
    if (!conversation || conversation.title_manual || conversation.title_generated_at) return;
    const excerpt = String(letterText || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
    const data = await requestJson(API.title, {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: conversationId,
        owner: `启动说明：${excerpt}`,
        model_partner: String(modelPartnerText || '').slice(0, 1000),
      }),
    });
    if (data.conversation) {
      runtime.conversations = runtime.conversations.map((item) => (
        item.id === conversationId ? data.conversation : item
      ));
      renderConversationList();
    }
  }

  async function sendLandingLetter({ conversationId, modelId, letterText }) {
    if (runtime.generation) throw new Error('请先停止或等待当前回复完成。');
    if (runtime.deletedIds.has(conversationId)) throw new Error('这个聊天窗口已经删除。');
    const pendingSave = runtime.saveChains.get(conversationId);
    if (pendingSave) await pendingSave;
    const requestContext = chatRequestContext(conversationId);
    const controller = new AbortController();
    runtime.generation = {
      conversationId,
      turnId: '',
      ownerIndex: -1,
      modelPartnerIndex: -1,
      controller,
    };
    composerState();
    try {
      const data = await requestJson(API.landingLetter, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          conversation_id: conversationId,
          model: modelId,
          letter_text: letterText,
          recent_entry_ids: requestContext.recentEntryIds,
          local_date: localDateKey(),
          local_datetime: localDateTimeKey(),
          settings: requestContext.settings,
        }),
      });
      setHistory(conversationId, data.history || {});
      runtime.desk?.captureSlip(data.desk_slip);
      runtime.desk?.captureModelEcho(data.history || {}, conversationId);
      if (data.conversation) {
        runtime.conversations = runtime.conversations.map((item) => (
          item.id === conversationId ? data.conversation : item
        ));
        renderConversationList();
      }
      const selected = Array.isArray(data?.memory?.selected_entry_ids)
        ? data.memory.selected_entry_ids.map(String)
        : [];
      const recalled = runtime.recallHistory.get(conversationId) || [];
      runtime.recallHistory.set(conversationId, [...recalled, selected].slice(-8));
      renderMessages(conversationId);
      autoTitleFromLanding(conversationId, letterText, data?.model_partner?.content || '')
        .catch((error) => console.warn('[chat:landing-title]', error));
      data.soil_refresh = await (
        runtime.memory?.onReplyCompleted(conversationId, {
          trigger: 'landing',
          modelId: data?.model_partner?.model_id || data?.model || modelId,
        }) || Promise.resolve({ ok: false, reason: 'memory_unavailable' })
      );
      return data;
    } finally {
      if (runtime.generation?.controller === controller) runtime.generation = null;
      composerState();
    }
  }

  return Object.freeze({ autoTitle, autoTitleFromLanding, sendLandingLetter });
}
