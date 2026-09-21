import assert from 'node:assert/strict';
import {
  window, prompts, profile, conversations, histories, historyWrites, formalChatRequests, formalChatBodies,
  soils, memoryPockets, memoryEntries, customInstructions, landingBodies, titleBodies, soilOrganizeBodies,
  dailyLoadRequests, dailyModelPartnerCommentBodies, dailyMoments, dailyDiaries, dailyProfile, dogtalks, clipboard, now, soilFor,
  tick, waitFor, waitForDanger, cancelDanger, acceptDanger,
  setFormalFinishReason, setLandingFinishReason, setFailNextSoilOrganize,
} from './dom-harness.mjs';

export async function runChatPrelude() {
  let danger;
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(JSON.parse(localStorage.getItem('elementera.local.v1')).preferences.ownerName, '迁移中的屋主');
  assert.equal(localStorage.getItem('gpt_like_shell_theme_clean_v1'), null);
  assert.equal(localStorage.getItem('cw_name'), null);
  assert.equal(localStorage.getItem('ec.currentConversationId'), null);
  assert.equal(document.querySelectorAll('#coastStatus').length, 1);
  assert.equal(document.querySelectorAll('#mainRooms').length, 1);
  assert.match(document.querySelector('#coastStatus').textContent, /共同度过\s+\d+\s+天/);
  assert.ok(document.querySelectorAll('svg.icon').length >= 15);
  assert.equal(document.querySelector('#newChatButton svg').getAttribute('viewBox'), '0 0 32 32');
  assert.equal(document.querySelector('[data-action="settings:wolf"] svg').getAttribute('viewBox'), '0 0 24 24');
  assert.equal(document.querySelector('#modelName').textContent, '4.1 Nano ›');
  assert.equal(document.querySelector('#contextStatus'), null, '旧上下文状态条已删除');
  assert.equal(document.querySelector('#deskStatus')?.hidden, true, '本轮上下文预览在首次回复前不显示空壳');

  document.querySelector('#menuButton').click();
  assert.equal(document.body.classList.contains('sidebar-open'), true, 'Shell owner opens the sidebar through Event Spine');
  document.querySelector('#sidebarClose').click();
  assert.equal(document.body.classList.contains('sidebar-open'), false, 'Shell owner closes the sidebar through Event Spine');
  const sidebarSearch = document.querySelector('#sidebarSearch');
  sidebarSearch.value = '没有这扇窗';
  sidebarSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('#chatConversationList .conversation-row').hidden, true, 'Shell input owner filters conversations');
  sidebarSearch.value = '';
  sidebarSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('#chatConversationList .conversation-row').hidden, false);

  document.querySelector('[data-action="daily:home"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'daily-home', 'daily home route');
  assert.ok(document.querySelector('#overlayRoot').textContent.includes('小组件'));
  document.querySelector('[data-action="router:back"]').click();
  await waitFor(() => !document.querySelector('#overlayRoot')?.dataset.route, 'daily overlay close');

  const input = document.querySelector('#promptInput');
  for (const options of [
    { key: 'Enter' },
    { key: 'Enter', shiftKey: true },
    { key: 'Enter', isComposing: true },
  ]) {
    const event = new window.KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true });
    assert.equal(input.dispatchEvent(event), true, 'Enter must retain the textarea native newline behavior');
    assert.equal(event.defaultPrevented, false);
  }
  await tick();
  assert.equal(formalChatRequests, 0, 'keyboard input must not submit chat');
  assert.equal(input.style.overflowY, 'hidden', 'an empty composer must not show a scrollbar beside the microphone');
  document.querySelector('#attachmentButton').click();
  await tick();
  assert.equal(document.querySelector('#attachmentMenu').hidden, false, 'plus opens the single attachment menu');
  assert.ok(document.querySelector('[data-action="chat:attachment-image"]'));
  assert.ok(document.querySelector('[data-action="chat:attachment-file"]'));
  document.body.click();
  await tick();
  assert.equal(document.querySelector('#attachmentMenu').hidden, true, 'outside click closes attachment menu');
  document.querySelector('#micButton').click();
  await tick();
  assert.equal(document.querySelector('#toastRoot').textContent, '语音输入还没接入。');
  document.querySelector('#composerActionButton').click();
  await tick();
  assert.equal(document.querySelector('#toastRoot').textContent, '通话模式还没接入。先输入文字或添加附件。');
  assert.ok(document.querySelector('#mainDogtalkComposer').textContent.includes('屋主这轮很放松，因此偷懒中。'));
  const mainDogtalk = document.querySelector('#mainDogtalkComposer');
  mainDogtalk.querySelector('details').open = true;
  mainDogtalk.querySelector('[name="body"]').value = '主窗这一轮想轻轻靠近。';
  mainDogtalk.querySelector('[name="true_core"]').value = '想被看见。';
  mainDogtalk.querySelector('[name="weather"]').value = '黏';
  mainDogtalk.querySelector('[name="read_mode"]').value = 'read_now';
  input.value = 'a1';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('#composerActionButton').click();
  await waitFor(() => document.querySelector('.message.assistant')?.textContent.includes('mock: a1'), 'assistant reply');
  await waitFor(() => document.querySelector('#deskStatus')?.hidden === false, 'desk slip status');
  assert.ok(document.querySelector('#deskStatus').textContent.includes('本轮上下文预览'));
  document.querySelector('#deskStatus [data-action="desk:open"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'desk-slip', 'desk slip route');
  assert.ok(document.querySelector('#overlayRoot').textContent.includes('相关记忆'));
  assert.equal(document.querySelector('#overlayRoot').textContent.includes('连通一千零一个触角'), false);
  assert.equal(document.querySelector('#overlayRoot').textContent.includes('今日海岸'), false);
  assert.equal(document.querySelector('#overlayRoot').textContent.includes('Context Manifest'), false);
  document.querySelector('[data-action="router:back"]').click();
  await waitFor(() => !document.querySelector('#overlayRoot')?.dataset.route, 'desk slip close');
  assert.equal(document.querySelector('.message.assistant .avatar').textContent, '', 'default avatar replaces the assistant glyph');
  assert.equal(formalChatRequests, 1, 'the existing right-hand button still submits chat');
  assert.equal(formalChatBodies[0].conversation_id, 'conv-1');
  assert.match(formalChatBodies[0].source_turn_id, /^turn-/);
  assert.match(formalChatBodies[0].local_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(formalChatBodies[0].dogtalk.body, '主窗这一轮想轻轻靠近。');
  assert.equal(formalChatBodies[0].dogtalk.read_mode, 'read_now');
  assert.match(formalChatBodies[0].dogtalk.snapshot_id, /^dogtalk-snapshot-/);
  assert.equal(dogtalks.get('conversation:conv-1').body, '主窗这一轮想轻轻靠近。');
  assert.ok(document.querySelector('.message.user .message-dogtalk-mark')?.textContent.includes('随本轮'));
  assert.equal(formalChatBodies[0].settings.max_tokens, null, 'natural output must not impose an application token limit');
  await waitFor(() => document.querySelector('.thought-soil-entry')?.textContent.includes('1 粒当前活跃线索'), 'thought soil entry');
  assert.equal(document.querySelector('.thought-soil-entry').dataset.action, 'memory:soil-open');
  assert.equal(document.querySelector('.thought-soil-entry').dataset.scope, 'conversation');
  assert.equal(document.querySelector('.thought-soil-entry').dataset.conversationId, 'conv-1');
  assert.ok(document.querySelector('.message.assistant').previousElementSibling?.classList.contains('thought-soil-row'));
  await waitFor(() => document.querySelector('#toastRoot').textContent.includes('模型或供应商达到自身长度上限'), 'ordinary truncation notice');
  assert.equal(soilOrganizeBodies.filter((item) => item.trigger === 'reply').length, 1, 'the first reply must organize thought soil');
  assert.equal(soilOrganizeBodies.find((item) => item.trigger === 'reply').force, true, 'each reply must bypass the old interval schedule');
  assert.equal(soilOrganizeBodies.find((item) => item.trigger === 'reply').model, 'openai/gpt-4.1-nano', 'thought soil must use the model selected for this reply');
  assert.equal(histories.get('conv-1').turns.at(-1).assistant.variantsByUserVariant['0'][0].finish_reason, 'length');
  setFormalFinishReason('stop');
  document.querySelector('.thought-soil-entry').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'thought-soil', 'thought soil route');
  assert.ok(document.querySelector('#overlayRoot').textContent.includes('勿复读'));
  assert.ok(document.querySelector('#overlayRoot').textContent.includes('暂放的潮汐岔路'));
  assert.ok(document.querySelector('#overlayRoot').textContent.includes('这条岔路先放下，以后也许还会长。'));
  assert.ok(document.querySelector('#overlayRoot').textContent.includes('这些内容已先放进待确认区。确认前不会参与召回。'));
  assert.ok(document.querySelector('#overlayRoot').textContent.includes('待确认区 · 1'));
  assert.ok(document.querySelector('#overlayRoot').textContent.includes('revision 2 · 整理来源'));
  assert.equal(document.querySelector('[data-action="memory:soil-organize"]'), null, 'manual soil organize entry must stay retired');
  assert.ok(document.querySelector('[data-action="memory:soil-edit"]'));
  assert.ok(document.querySelector('[data-action="memory:soil-clear"]'));
  const soilBeforeClearCancel = structuredClone(soilFor('conv-1'));
  document.querySelector('[data-action="memory:soil-clear"]').click();
  danger = await waitForDanger('清空当前窗口的整理当前对话的纸条？');
  assert.ok(danger.textContent.includes('当前、当前活跃线索、勿复读和可落袋候选会被清空。聊天记录、落袋、种子和记忆不会被删除。'));
  cancelDanger(danger);
  await tick();
  assert.deepEqual(soilFor('conv-1'), soilBeforeClearCancel, 'cancelled soil clear must not write the cleared state');
  document.querySelector('[data-action="memory:done"]').click();
  await tick();
  assert.equal(document.querySelectorAll('.message.user .action-button').length, 2);
  assert.equal(document.querySelectorAll('.message.assistant .action-button').length, 5);
  assert.equal(document.querySelectorAll('.message .action-button svg').length, 7);
  assert.deepEqual(
    [...document.querySelectorAll('.message .action-button svg')].map((svg) => svg.getAttribute('viewBox')),
    Array(7).fill('0 0 32 32'),
  );

  const userStateBeforeCancel = structuredClone(histories.get('conv-1'));
  const writesBeforeUserCancel = historyWrites;
  document.querySelector('.message.user [data-action="chat:delete-user"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  danger = await waitForDanger('删除这条用户消息？');
  assert.ok(danger.textContent.includes('如果这是这一轮唯一的用户消息，关联的助手回复也会一起从当前窗口移除。'));
  assert.deepEqual(histories.get('conv-1'), userStateBeforeCancel, 'mobile action-row click must stop before mutating the user state');
  assert.equal(historyWrites, writesBeforeUserCancel, 'cancel gate must stop the D1 history PUT path');
  cancelDanger(danger);
  await tick();
  assert.deepEqual(histories.get('conv-1'), userStateBeforeCancel);
  assert.equal(historyWrites, writesBeforeUserCancel);

  document.querySelector('.message.assistant [data-action="chat:like"]').click();
  await tick();
  assert.ok(document.querySelector('.message.assistant [data-action="chat:like"]').classList.contains('is-active'));
  assert.equal(document.querySelector('[data-danger-confirm]'), null, 'like must not open a danger confirmation');
  document.querySelector('.message.assistant [data-action="chat:copy"]').click();
  await tick();
  assert.equal(clipboard, 'mock: a1');
  assert.equal(document.querySelector('[data-danger-confirm]'), null, 'copy must not open a danger confirmation');

  prompts.push('a1 edited');
  document.querySelector('.message.user [data-action="chat:edit-user"]').click();
  await waitFor(() => document.querySelector('.message.user .variant-switch')?.textContent.includes('2/2'), 'user variant');
  await waitFor(() => document.querySelector('.message.assistant')?.textContent.includes('mock: a1 edited'), 'edited assistant');
  await waitFor(() => soilOrganizeBodies.filter((item) => item.trigger === 'reply').length === 2, 'each completed reply refreshes thought soil');
  assert.ok(formalChatBodies[1].recent_entry_ids.includes('mock-memory-1'), 'the next turn must carry cooldown ids, not memory contents');
  assert.equal(document.querySelectorAll('.message.assistant').length, 1);
  const pocketsBeforeRetiredLongPress = memoryPockets.length;
  const routeBeforeRetiredLongPress = document.querySelector('#overlayRoot')?.dataset.route || '';
  document.querySelector('.message.assistant').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(document.querySelector('#overlayRoot')?.dataset.route || '', routeBeforeRetiredLongPress, 'long-press/contextmenu must not navigate to a manual pocket page');
  assert.notEqual(document.querySelector('#overlayRoot')?.dataset.route, 'memory-pocket-action', 'retired manual pocket route must stay unreachable from messages');
  assert.equal(memoryPockets.length, pocketsBeforeRetiredLongPress, 'long-press/contextmenu must not create a manual pocket candidate');
  assert.equal(document.querySelector('[data-action="memory:pocket-save"]'), null, 'manual raw-message pocket save control must stay retired');
  const writesBeforeAssistantCancel = historyWrites;
  document.querySelector('.message.assistant [data-action="chat:delete-assistant"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  danger = await waitForDanger('删除这条助手回复？');
  assert.ok(danger.textContent.includes('这只会删除当前选中的助手回复版本；其他窗口不会受到影响。'));
  cancelDanger(danger);
  await tick();
  assert.equal(document.querySelectorAll('.message.assistant').length, 1, 'cancel must keep the assistant reply');
  assert.equal(historyWrites, writesBeforeAssistantCancel);
  document.querySelector('.message.assistant [data-action="chat:delete-assistant"]').click();
  danger = await waitForDanger('删除这条助手回复？');
  acceptDanger(danger);
  await waitFor(() => document.querySelectorAll('.message.assistant').length === 0, 'confirmed assistant delete');
  document.querySelector('.message.user [data-direction="previous"]').click();
  await tick();
  assert.equal(document.querySelectorAll('.message.assistant').length, 1);

  document.querySelector('#newChatButton').click();
  await waitFor(() => document.querySelectorAll('#chatConversationList .conversation-row').length === 2, 'new conversation');
  input.value = 'delete unique turn';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('#composerActionButton').click();
  await waitFor(() => document.querySelector('.message.assistant')?.textContent.includes('mock: delete unique turn'), 'disposable assistant reply');
  const disposableConversationId = document.querySelector('.conversation-title.is-active')?.closest('[data-conversation-id]')?.dataset.conversationId;
  const writesBeforeConfirmedUserDelete = historyWrites;
  document.querySelector('.message.user [data-action="chat:delete-user"]').click();
  danger = await waitForDanger('删除这条用户消息？');
  assert.equal(document.querySelectorAll('.message.user').length, 1);
  assert.equal(document.querySelectorAll('.message.assistant').length, 1);
  acceptDanger(danger);
  await waitFor(() => document.querySelectorAll('.message.user').length === 0 && document.querySelectorAll('.message.assistant').length === 0, 'confirmed unique user turn delete');
  assert.equal(histories.get(disposableConversationId).turns.length, 0, 'confirmed unique user delete may remove the whole linked turn');
  assert.ok(historyWrites > writesBeforeConfirmedUserDelete, 'confirmed user delete must persist the new state');
  const first = document.querySelector('#chatConversationList .conversation-row');
  first.querySelector('[data-action="chat:menu"]').click();
  prompts.push('改名1');
  first.querySelector('[data-action="chat:rename"]').click();
  await waitFor(() => document.querySelector('#chatConversationList').textContent.includes('改名1'), 'rename conversation');
  assert.equal(document.querySelectorAll('#chatConversationList .conversation-row').length, 2);
  const renamed = [...document.querySelectorAll('#chatConversationList .conversation-row')].find((row) => row.textContent.includes('改名1'));
  renamed.querySelector('[data-action="chat:menu"]').click();
  renamed.querySelector('[data-action="chat:delete-conversation"]').click();
  danger = await waitForDanger('删除这个聊天窗口？');
  cancelDanger(danger);
  await tick();
  assert.equal(document.querySelectorAll('#chatConversationList .conversation-row').length, 2, 'cancel must keep the conversation');
  renamed.querySelector('[data-action="chat:menu"]').click();
  renamed.querySelector('[data-action="chat:delete-conversation"]').click();
  danger = await waitForDanger('删除这个聊天窗口？');
  assert.ok(danger.textContent.includes('这个窗口会从侧边栏移除。其他窗口不会受到影响。'));
  acceptDanger(danger);
  await waitFor(() => document.querySelectorAll('#chatConversationList .conversation-row').length === 1, 'delete conversation');
}

export async function runChatTypedRooms() {
  let danger;
  const conversationsBeforeLanding = document.querySelectorAll('#chatConversationList .conversation-row').length;
  document.querySelector('#newChatButton').click();
  await waitFor(() => document.querySelectorAll('#chatConversationList .conversation-row').length === conversationsBeforeLanding + 1, 'fresh landing conversation');
  const landingConversationId = document.querySelector('#chatConversationList .conversation-title.is-active')?.closest('[data-conversation-id]')?.dataset.conversationId;
  assert.ok(landingConversationId);
  assert.equal(conversations.find((item) => item.id === landingConversationId)?.title, '新聊天');

  document.querySelector('#moreButton').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'island-letter', 'letter route');
  assert.ok(document.querySelector('#islandLetterText').value.includes('这是 source 版本的公开占位入住信'));
  assert.equal(document.querySelector('[data-action="letters:send-island"]').textContent, '递出登岛信');
  const visibleUsersBeforeLetter = document.querySelectorAll('.message.user').length;
  const assistantsBeforeLetter = document.querySelectorAll('.message.assistant').length;
  const titlesBeforeLetter = titleBodies.length;
  setLandingFinishReason('length');
  document.querySelector('[data-action="letters:send-island"]').click();
  await waitFor(() => document.querySelector('#overlayRoot').hidden, 'landing letter response closes panel');
  await waitFor(() => document.querySelectorAll('.message.assistant').length === assistantsBeforeLetter + 1, 'landing assistant reply');
  await waitFor(() => soilOrganizeBodies.some((item) => item.trigger === 'landing'), 'landing soil refresh');
  const landingSoil = soilOrganizeBodies.findLast((item) => item.trigger === 'landing');
  assert.deepEqual(landingBodies.at(-1).recent_entry_ids, [], 'zero cooldown must send no cooldown ids');
  assert.equal(landingBodies.at(-1).settings.max_tokens, null, 'landing natural output must not impose an application token limit');
  assert.equal(landingSoil.force, true, 'landing soil refresh must bypass the ordinary schedule');
  assert.equal(landingSoil.model, landingBodies.at(-1).model, 'landing soil must use the model that read the letter');
  assert.equal(landingSoil.settings.seedCooldownTurns, 0);
  assert.equal(landingSoil.settings.memoryLimit, 6);
  assert.equal('autoRefreshEveryTurns' in landingSoil.settings, false, 'legacy autoRefreshEveryTurns must not return to active run settings');
  assert.equal('maxHandSeeds' in landingSoil.settings, false, 'legacy maxHandSeeds must not return to active run settings');
  assert.equal(document.querySelectorAll('.message.user').length, visibleUsersBeforeLetter, 'hidden landing input must not render a user bubble');
  assert.ok(document.querySelector('.message.assistant:last-of-type')?.textContent.includes('我把登岛信读完了。'));
  assert.equal(titleBodies.length, titlesBeforeLetter + 1, 'landing must generate a title without another user message');
  assert.match(titleBodies.at(-1).user, /^登岛信：/);
  assert.equal(titleBodies.at(-1).assistant, '我把登岛信读完了。');
  assert.equal(conversations.find((item) => item.id === landingConversationId)?.title, '测试标题');
  assert.equal(document.querySelector('#toastRoot').textContent, '登岛信已递出，但模型或供应商达到自身长度上限；可以点“重新生成”再读一次。');
  assert.ok(document.querySelector('.thought-soil-entry')?.textContent.includes('1 粒当前活跃线索'));
  document.querySelector('.thought-soil-entry').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'thought-soil', 'landing thought soil route');
  assert.ok(document.querySelector('#overlayRoot').textContent.includes('继续测试当前窗口'));
  document.querySelector('[data-action="memory:done"]').click();
  await tick();

  const landingTurn = histories.get(landingConversationId).turns.at(-1);
  assert.equal(landingTurn.turn_type, 'landing');
  assert.equal(landingTurn.user.variants[0].hidden, true);
  assert.equal(landingTurn.assistant.variantsByUserVariant['0'][0].finish_reason, 'length');
  const requestsBeforeLandingRegenerate = formalChatRequests;
  document.querySelector(`.message.assistant[data-turn="${landingTurn.id}"] [data-action="chat:regenerate"]`).click();
  await waitFor(() => formalChatRequests === requestsBeforeLandingRegenerate + 1, 'landing regenerate request');
  await waitFor(() => histories.get(landingConversationId).turns.at(-1).assistant.variantsByUserVariant['0'].length === 2, 'landing regenerate variant');
  assert.equal(formalChatBodies.at(-1).messages.at(-1).content, landingBodies.at(-1).letter_text);
  assert.equal(formalChatBodies.at(-1).settings.max_tokens, null, 'landing regenerate must remain application-unbounded');
  assert.equal(document.querySelectorAll('.message.user').length, visibleUsersBeforeLetter, 'landing regenerate must keep the hidden input hidden');

  document.querySelector('#moreButton').click();
  await waitFor(() => document.querySelector('[data-action="letters:send-island"]'), 'reopen letter route');
  assert.equal(document.querySelector('[data-action="letters:send-island"]').textContent, '重新递出登岛信');
  const lockedSoil = { ...soilFor(landingConversationId), current_text: '屋主手动锁定的当前方向', hand_seeds: [], manual_locked: true };
  soils.set(landingConversationId, lockedSoil);
  setLandingFinishReason('stop');
  const landingCountBeforeLocked = landingBodies.length;
  document.querySelector('[data-action="letters:send-island"]').click();
  await waitFor(() => landingBodies.length === landingCountBeforeLocked + 1 && document.querySelector('#overlayRoot').hidden, 'locked landing soil readback');
  assert.equal(document.querySelector('#toastRoot').textContent, '登岛信已递出；整理当前对话的纸条已手动锁定，保留原有内容。');
  assert.equal(soilFor(landingConversationId).current_text, '屋主手动锁定的当前方向');
  assert.equal(soilFor(landingConversationId).hand_seeds.length, 0);
  assert.ok(document.querySelector('.thought-soil-entry')?.textContent.includes('已锁定'));

  document.querySelector('#moreButton').click();
  await waitFor(() => document.querySelector('[data-action="letters:send-island"]'), 'reopen letter for soil failure');
  setFailNextSoilOrganize(true);
  const landingCountBeforeFailure = landingBodies.length;
  document.querySelector('[data-action="letters:send-island"]').click();
  await waitFor(() => landingBodies.length === landingCountBeforeFailure + 1 && document.querySelector('#overlayRoot').hidden, 'landing soil failure preserves reply');
  assert.equal(document.querySelector('#toastRoot').textContent, '登岛信已递出，但整理当前对话的纸条整理失败，可以稍后手动整理。');
  assert.equal(document.querySelectorAll('.message.user').length, visibleUsersBeforeLetter);
  assert.equal(histories.get(landingConversationId).turns.length, 3, 'soil failure must not discard a saved landing reply');

  function activeConversationId() {
    return document.querySelector('#chatConversationList .conversation-title.is-active')
      ?.closest('[data-conversation-id]')?.dataset.conversationId || '';
  }
  function activeConversationRecord() {
    return conversations.find((item) => item.id === activeConversationId()) || null;
  }
  function appendOfficialTurn(conversationId, turnId, content) {
    const state = structuredClone(histories.get(conversationId) || { version: 4, updated_at: now(), turns: [] });
    state.turns.push({
      id: turnId,
      turn_type: 'message',
      user: {
        active: 0,
        variants: [{
          id: `${turnId}-user`,
          content,
          hidden: false,
          message_source: 'official_mcp',
          display_author: 'ChatGPT-5.6 Thinking sol≋',
          source_model_label: 'GPT-5.6 Thinking',
          created_at: now(),
        }],
      },
      assistant: { activeByUserVariant: {}, variantsByUserVariant: {} },
    });
    state.updated_at = now();
    histories.set(conversationId, state);
  }
  async function openType(type) {
    document.querySelector(`[data-action="chat:open-type"][data-kind="${type}"]`).click();
    await waitFor(() => activeConversationRecord()?.room_type === type, `open typed ${type} conversation`);
    return activeConversationId();
  }

  const radioConversationId = await openType('radio');
  assert.equal(document.querySelector('#roomWindow'), null);
  assert.equal(document.querySelector('#overlayRoot').hidden, true);
  assert.ok(document.querySelector('#chatWindow'));
  assert.ok(document.querySelector('.conversation-title.is-active').textContent.startsWith('共通聊天室｜'));
  assert.equal(conversations.find((item) => item.id === radioConversationId)?.room_type, 'radio');
  const radioRequestsBeforeSend = formalChatRequests;
  document.querySelector('#promptInput').value = 'radio typed DOM';
  document.querySelector('#composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => formalChatRequests === radioRequestsBeforeSend + 1
    && document.querySelector('#messages').textContent.includes('mock: radio typed DOM'), 'radio web message receives API reply');
  assert.equal(formalChatBodies.at(-1).conversation_id, radioConversationId);
  assert.equal(formalChatBodies.at(-1).messages.at(-1).content, 'radio typed DOM');

  appendOfficialTurn(radioConversationId, 'radio-official-turn-dom', '官端从 ChatGPT 向同一个共通聊天室发来一条消息。');
  await openType('main');
  await openType('radio');
  await waitFor(() => document.querySelector('#messages').textContent.includes('官端从 ChatGPT 向同一个共通聊天室发来一条消息。'), 'official MCP radio turn reload');
  const radioOfficialMark = [...document.querySelectorAll('#messages .message.user .message-dogtalk-mark')]
    .find((node) => node.textContent.includes('official_mcp'));
  assert.ok(radioOfficialMark?.textContent.includes('ChatGPT-5.6 Thinking sol≋'));
  const radioOfficialBubble = radioOfficialMark.closest('.message.user');
  assert.equal(radioOfficialBubble.querySelector('[data-action="chat:edit-user"]'), null, 'official MCP turn cannot impersonate/edit as Human Owner');
  assert.equal(radioOfficialBubble.querySelector('[data-action="chat:delete-user"]'), null);

  document.querySelector('[data-action="memory:open"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'memory', 'same Memory v2 from radio');
  for (const scope of ['memory', 'seed', 'custom']) assert.ok(document.querySelector(`[data-action="memory:tab"][data-scope="${scope}"]`));
  assert.equal(document.querySelector('[data-action="memory:tab"][data-scope="radio"]'), null);
  document.querySelector('[data-action="router:back"]').click();
  await waitFor(() => document.querySelector('#overlayRoot').hidden, 'return to typed radio');

  const radioCountBeforeNew = conversations.filter((item) => item.room_type === 'radio').length;
  document.querySelector('#newChatButton').click();
  await waitFor(() => conversations.filter((item) => item.room_type === 'radio').length === radioCountBeforeNew + 1
    && activeConversationRecord()?.room_type === 'radio', 'new button keeps current radio type');

  const lighthouseConversationId = await openType('lighthouse');
  assert.ok(document.querySelector('.conversation-title.is-active').textContent.startsWith('MCP 对话区｜'));
  assert.equal(conversations.find((item) => item.id === lighthouseConversationId)?.room_type, 'lighthouse');
  appendOfficialTurn(lighthouseConversationId, 'lighthouse-official-turn-dom', '官端写来一封低频 MCP 对话区消息。');
  await openType('main');
  await openType('lighthouse');
  await waitFor(() => document.querySelector('#messages').textContent.includes('官端写来一封低频 MCP 对话区消息。'), 'official MCP lighthouse turn reload');
  const lighthouseOfficialMark = [...document.querySelectorAll('#messages .message.user .message-dogtalk-mark')]
    .find((node) => node.textContent.includes('official_mcp'));
  assert.ok(lighthouseOfficialMark?.textContent.includes('ChatGPT-5.6 Thinking sol≋'));
  assert.equal(lighthouseOfficialMark.closest('.message.user').querySelector('[data-action="chat:edit-user"]'), null);

  const lighthouseRequestsBeforeSend = formalChatRequests;
  const lighthouseHistoryWritesBeforeSend = historyWrites;
  const lighthouseAssistantsBeforeSend = document.querySelectorAll('#messages .message.assistant').length;
  document.querySelector('#promptInput').value = '继续这封 MCP 对话区消息。';
  document.querySelector('#composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => historyWrites > lighthouseHistoryWritesBeforeSend
    && document.querySelector('#messages').textContent.includes('继续这封 MCP 对话区消息。'), 'Human Owner lighthouse turn is saved without generation');
  assert.equal(formalChatRequests, lighthouseRequestsBeforeSend, 'lighthouse web send must not call formal chat generation');
  assert.equal(document.querySelectorAll('#messages .message.assistant').length, lighthouseAssistantsBeforeSend, 'lighthouse web send must not create an assistant bubble');
  assert.equal(document.querySelector('#messages').textContent.includes('mock: 继续这封 MCP 对话区消息。'), false);
  assert.equal(document.querySelector('#roomWindow'), null);
  assert.ok(document.querySelector('#mainDogtalkComposer'));
}
