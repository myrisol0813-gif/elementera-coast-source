import { API, requestJson } from '../../core/api.js';
import {
  activeBranch,
  appendModelPartnerVariant,
  appendTurn,
  updateModelPartnerVariant,
} from '../chat-state.js';
import { DEFAULT_MODEL, isImageModel } from './chat-profile.js';
import { contextMessages as buildContextMessages } from './chat-context.js';
import { chatRequestContext as buildChatRequestContext } from './chat-request-context.js';
import { runChatStreamFlow } from './chat-stream-flow.js';
import { localDateKey, localDateTimeKey } from './chat-local-time.js';
import { createChatTitleLanding } from './chat-title-landing.js';

const CONNECTING_TEXT = '正在连接当前模型……';

function soilIsBlank(soil = {}) {
  return !String(soil.current_text || '').trim()
    && !(Array.isArray(soil.hand_seeds) && soil.hand_seeds.length)
    && !String(soil.do_not_repeat || '').trim()
    && !(Array.isArray(soil.pocket_candidates) && soil.pocket_candidates.length);
}

function externalFailureSection(error, deskSlip) {
  const fromDesk = deskSlip?.external;
  if (fromDesk && typeof fromDesk === 'object' && fromDesk.mode !== 'off') return fromDesk;
  const direct = error?.details?.external;
  if (direct && typeof direct === 'object') return direct;
  const nested = error?.details?.details?.external;
  return nested && typeof nested === 'object' ? nested : null;
}

function visibleExternalFailure(error, deskSlip) {
  const section = externalFailureSection(error, deskSlip);
  if (!section || section.status !== '递送失败') return '';
  const requested = Math.max(0, Number(section.requested_turns ?? section.total_requested_turns) || 0);
  const loaded = Math.max(0, Number(section.loaded_turns ?? section.total_loaded_turns) || 0);
  const attempted = Math.max(0, Number(section.attempted_delivered_turns ?? loaded) || 0);
  const chars = Math.max(0, Number(section.attempted_chars ?? section.loaded_chars) || 0);
  const estimated = Math.max(0, Number(section.attempted_estimated_tokens) || 0);
  const type = String(section.provider_error_type || error?.type || 'request_failed');
  const message = String(section.provider_error_message || error?.message || '模型请求失败。');
  const tooLong = ['provider_context_limit', 'provider_body_limit'].includes(String(section.failure_reason || ''));
  const head = tooLong
    ? '这轮外部入口取信内容太长，provider / 模型未能完成回复。系统没有静默裁剪内容，也没有假装递完。'
    : '这轮外部入口取信没有完成递送。系统没有静默裁剪内容，也没有假装递完。';
  return [
    head,
    `requested_turns=${requested}`,
    `loaded_turns=${loaded}`,
    `attempted_delivered_turns=${attempted}`,
    `attempted_chars=${chars}`,
    ...(estimated ? [`estimated_tokens=${estimated}`] : []),
    `provider_error_type=${type}`,
    `provider_error_message=${message}`,
  ].join('\n');
}

export function createChatGeneration({
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
}) {
  const contextMessages = (history, turnId) => buildContextMessages(history, turnId, runtime.runSettings() || {});
  const chatRequestContext = (conversationId) => buildChatRequestContext(runtime.runSettings, runtime.recallHistory, conversationId);

  const { autoTitle, autoTitleFromLanding, sendLandingLetter } = createChatTitleLanding({
    runtime,
    composerState,
    chatRequestContext,
    setHistory,
    renderMessages,
    renderConversationList,
  });

  function patchGeneratedVariant(conversationId, turnId, appended, patch, { render = true } = {}) {
    let latest = runtime.histories.get(conversationId) || appended.state;
    latest = updateModelPartnerVariant(latest, turnId, appended.ownerIndex, appended.modelPartnerIndex, patch);
    setHistory(conversationId, latest);
    if (render) renderMessages(conversationId);
    return latest;
  }

  async function generate(conversationId, turnId, { humanThoughtSubmission = null, externalSubmission = null } = {}) {
    if (runtime.generation || runtime.deletedIds.has(conversationId)) return;
    const targetConversation = runtime.conversations.find((item) => item.id === conversationId);
    if (targetConversation?.room_type === 'bridge') return;
    const original = runtime.histories.get(conversationId);
    const appended = appendModelPartnerVariant(original, turnId, { content: CONNECTING_TEXT });
    if (!appended.turn || !appended.variant) return;
    setHistory(conversationId, appended.state);
    const controller = new AbortController();
    runtime.generation = { conversationId, turnId, ownerIndex: appended.ownerIndex, modelPartnerIndex: appended.modelPartnerIndex, controller };
    renderMessages(conversationId);
    composerState();

    const requestContext = chatRequestContext(conversationId);
    const streamingEnabled = requestContext.settings.streamingEnabled === true;
    if (!streamingEnabled) saveHistory(conversationId, appended.state).catch(() => undefined);
    const modelId = runtime.profile.current_chat_model || DEFAULT_MODEL;
    const payload = {
      conversation_id: conversationId,
      source_turn_id: turnId,
      message_id: appended.variant.id,
      local_date: localDateKey(),
      local_datetime: localDateTimeKey(),
      model: modelId,
      messages: contextMessages(appended.state, turnId),
      attachment_ids: (activeBranch(appended.turn).owner?.attachments || []).map((item) => item.id),
      recent_entry_ids: requestContext.recentEntryIds,
      settings: requestContext.settings,
      ...(humanThoughtSubmission ? { humanThought: humanThoughtSubmission } : {}),
      ...(externalSubmission ? { external: externalSubmission } : {}),
    };
    let patch;
    let generated = false;
    let finishReason = '';
    const streamState = {
      done: false,
      finishReason: '',
      partialContent: '',
      streamModelId: '',
      streamUsage: null,
      toolRuns: [],
      deskSlip: null,
    };
    try {
      if (streamingEnabled) {
        const streamed = await runChatStreamFlow({
          payload,
          signal: controller.signal,
          runtime,
          conversationId,
          turnId,
          appended,
          modelId,
          patchGeneratedVariant,
          patchModelPartnerStreamingText,
          state: streamState,
        });
        patch = streamed.patch;
        finishReason = streamState.finishReason;
        generated = true;
      } else {
        const data = await requestJson(API.chat, {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify(payload),
        });
        finishReason = String(data?.finish_reason || '');
        runtime.desk?.captureSlip(data.desk_slip);
        patch = {
          content: data?.message?.content || '模型没有返回文本。',
          errorDetail: '',
          model_id: data?.model || modelId,
          ...(data?.usage ? { usage: data.usage } : {}),
          finish_reason: finishReason,
          generation_source: 'chat',
          ...(Array.isArray(data?.tool_runs) && data.tool_runs.length ? { tool_runs: data.tool_runs } : {}),
          ...(data?.desk_slip && typeof data.desk_slip === 'object' ? { desk_slip: data.desk_slip } : {}),
        };
        const selected = Array.isArray(data?.memory?.selected_entry_ids) ? data.memory.selected_entry_ids.map(String) : [];
        const history = runtime.recallHistory.get(conversationId) || [];
        runtime.recallHistory.set(conversationId, [...history, selected].slice(-8));
        generated = true;
      }
    } catch (error) {
      const cancelled = error.name === 'AbortError';
      const failedDeskSlip = streamState.deskSlip && typeof streamState.deskSlip === 'object' ? streamState.deskSlip : null;
      const visibleFailure = cancelled ? '' : visibleExternalFailure(error, failedDeskSlip);
      const partialContent = String(streamState.partialContent || '');
      patch = {
        content: streamingEnabled
          ? partialContent || (cancelled ? '已停止生成。' : visibleFailure || '消息生成失败，请稍后重试。')
          : (cancelled ? '已停止生成。' : visibleFailure || '消息生成失败，请稍后重试。'),
        errorDetail: cancelled ? '' : `${error.type || 'request_failed'}: ${error.message}`,
        model_id: streamState.streamModelId || modelId,
        ...(streamState.streamUsage ? { usage: streamState.streamUsage } : {}),
        finish_reason: cancelled ? 'cancelled' : 'error',
        generation_source: 'chat',
        ...(failedDeskSlip ? { desk_slip: failedDeskSlip } : {}),
      };
      finishReason = patch.finish_reason;
    }

    if (runtime.deletedIds.has(conversationId)) {
      if (runtime.generation?.controller === controller) runtime.generation = null;
      composerState();
      return;
    }

    const latest = patchGeneratedVariant(conversationId, turnId, appended, patch, { render: false });
    if (runtime.generation?.controller === controller) runtime.generation = null;
    renderMessages(conversationId);
    composerState();
    await saveHistory(conversationId, latest).catch(() => undefined);
    runtime.desk?.onConversationChanged(latest, conversationId);
    if (generated) { humanThought?.resetCrossWindow?.({ room_scope: 'conversation', conversation_id: conversationId }); autoTitle(conversationId, latest, turnId).catch(() => undefined); }
    if (generated) {
      let soilRefresh = null;
      try {
        soilRefresh = await (runtime.memory?.onReplyCompleted(conversationId, { modelId: patch.model_id || modelId }) || Promise.resolve(null));
      } catch (error) {
        console.warn('[memory:reply]', error);
        soilRefresh = { ok: false, reason: error?.type || 'soil_organize_failed' };
      }
      const soilFailed = soilRefresh?.ok === false;
      const lockedBlank = soilRefresh?.reason === 'manual_locked' && soilIsBlank(soilRefresh.soil);
      if (finishReason === 'length' && soilFailed) toast('回复已保存，当前对话纸条已保底整理；下轮会继续自动整理。', 3200);
      else if (finishReason === 'length') toast('模型或供应商达到自身长度上限；可以点“重新生成”再生成一个版本。', 3200);
      else if (soilFailed) toast('回复已保存，当前对话纸条已保底整理。', 3000);
      else if (lockedBlank) toast('当前对话纸条目前为空且已手动锁定；恢复自动整理后会继续更新。', 3200);
    }
  }

  async function send(text, attachments = []) {
    const content = String(text || '').trim();
    const attachmentList = (Array.isArray(attachments) ? attachments : []).filter((item) => item?.id).slice(0, 12);
    if ((!content && !attachmentList.length) || !runtime.currentId || runtime.generation || !runtime.composerReady) return false;
    if (isImageModel(runtime.profile.current_chat_model, runtime.profile.model_box.image)) {
      toast('当前是生图模型，不能用于聊天。请切换聊天模型。');
      return false;
    }
    const target = { room_scope: 'conversation', conversation_id: runtime.currentId };
    const turnPapers = { humanThoughtSubmission: humanThought?.submission(target, ui.humanThought), externalSubmission: humanThought?.externalSubmission?.(target, ui.humanThought) };
    const appended = appendTurn(currentHistory(), content, {
      humanThought_snapshot_id: turnPapers.humanThoughtSubmission?.snapshot_id,
      message_source: 'owner_web',
      display_author: 'Owner',
      attachments: attachmentList,
    });
    setHistory(runtime.currentId, appended.state);
    ui.input.value = '';
    composerState();
    renderMessages();
    const conversation = runtime.conversations.find((item) => item.id === runtime.currentId);
    if (conversation?.room_type === 'bridge') await saveHistory(runtime.currentId, appended.state).catch(() => undefined);
    else await generate(runtime.currentId, appended.turn.id, turnPapers);
    humanThought?.mountComposer(ui.humanThought, target);
    return true;
  }

  return Object.freeze({ contextMessages, chatRequestContext, patchGeneratedVariant, generate, sendLandingLetter, autoTitle, autoTitleFromLanding, send });
}
