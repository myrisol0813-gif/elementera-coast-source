import assert from 'node:assert/strict';
import {
  window, prompts, profile, conversations, histories, historyWrites, formalChatRequests, formalChatBodies,
  soils, memoryPockets, memoryEntries, customInstructions, landingBodies, titleBodies, soilOrganizeBodies,
  dailyLoadRequests, dailyModelPartnerCommentBodies, dailyMoments, dailyDiaries, dailyProfile, dogtalks, clipboard, now, soilFor,
  tick, waitFor, waitForDanger, cancelDanger, acceptDanger,
  setFormalFinishReason, setLandingFinishReason, setFailNextSoilOrganize,
} from './dom-harness.mjs';

export async function runMemoryFlow() {
  let danger;
  document.querySelector('[data-action="memory:open"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'memory', 'memory owner route');
  for (const [scope, label] of [['memory', '记忆库'], ['seed', '种子库'], ['custom', '自定义指令']]) {
    assert.ok(document.querySelector(`[data-action="memory:tab"][data-scope="${scope}"]`)?.textContent.includes(label));
  }
  assert.ok(document.querySelector('[data-action="desk:worldbook"]')?.textContent.includes('世界书'));
  for (const retiredScope of ['conversation', 'radio', 'lighthouse', 'global']) {
    assert.equal(document.querySelector(`[data-action="memory:tab"][data-scope="${retiredScope}"]`), null);
  }
  assert.equal(document.querySelector('#overlayRoot [data-action="memory:soil-open"]'), null);
  assert.equal(document.querySelector('[name="source_model"]'), null, '双气泡不使用原生模型筛选');
  assert.ok(document.querySelector('.memory-filter-kind')?.textContent.includes('标签'));
  assert.ok(document.querySelector('.memory-filter-value')?.textContent.includes('全部标签'));
  for (const [kind, label] of [['time', '日期'], ['model', '模型'], ['window', '窗口'], ['tag', '标签']]) {
    const option = document.querySelector(`[data-action="memory:filter-kind"][data-value="${kind}"]`);
    assert.ok(option, `${label} dimension must always exist`);
  }
  document.querySelector('[data-action="memory:filter-kind"][data-value="time"]').click();
  await waitFor(() => document.querySelector('.memory-filter-kind')?.textContent.includes('日期'), 'empty library can switch to date dimension');
  assert.ok(document.querySelector('.memory-filter-value')?.textContent.includes('全部日期'));
  assert.ok([...document.querySelectorAll('#memoryFilterValueMenu button')].some((button) => button.disabled && button.textContent.includes('暂无日期')));
  document.querySelector('[data-action="memory:filter-kind"][data-value="tag"]').click();
  await waitFor(() => document.querySelector('.memory-filter-kind')?.textContent.includes('标签'), 'return empty library filter to tag');
  assert.equal(document.querySelector('#overlayRoot').textContent.includes('屋主 · 人类思考链'), false, 'dogtalk belongs beside the composer, not inside the trajectory page');
  document.querySelector('[data-action="memory:tab"][data-scope="custom"]').click();
  await waitFor(() => document.querySelector('[data-action="memory:tab"][data-scope="custom"]').classList.contains('is-active'), 'custom instructions tab');
  assert.ok(document.querySelector('[data-submit="memory:custom-instructions-save"]'));
  assert.equal(document.querySelector('#overlayRoot').textContent.includes('dry-run'), false, 'custom instructions no longer renders migration scaffold');
  assert.equal(document.querySelector('[data-action="memory:migration-refresh"]'), null);
  const customForm = document.querySelector('[data-submit="memory:custom-instructions-save"]');
  customForm.querySelector('[name="content"]').value = '进入海岸时先回应当前的屋主。';
  customForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => customInstructions.content.includes('先回应当前'), 'save one active custom instruction document');
  document.querySelector('[data-action="memory:tab"][data-scope="memory"]').click();
  await waitFor(() => document.querySelector('[data-action="memory:tab"][data-scope="memory"]').classList.contains('is-active'), 'return memory library');
  document.querySelector('[data-action="memory:pockets"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'memory-pockets', 'pending pocket route');
  let autoPocketCard = document.querySelector('[data-pocket-id="soil-pocket-conv-1"]');
  assert.ok(autoPocketCard.textContent.includes('暂放的潮汐岔路'));
  assert.ok(autoPocketCard.textContent.includes('核心：这条岔路现在不用，但以后仍可能长出新的理解。'));
  assert.ok(autoPocketCard.textContent.includes('来源：这条岔路先放下，以后也许还会长。'));
  assert.ok(autoPocketCard.textContent.includes('使用时机：再次谈到这条岔路时重新触碰。'));
  assert.ok(autoPocketCard.textContent.includes('勿误用：不要把它说成已经确认的长期记忆。'));
  assert.ok(autoPocketCard.textContent.includes('只有确认后才会进入记忆库或种子库'));
  assert.equal(autoPocketCard.querySelectorAll('.button-row button').length, 3);
  assert.equal(autoPocketCard.textContent.includes('石头'), false);
  autoPocketCard.querySelector('[data-action="memory:pocket-discard"]').click();
  danger = await waitForDanger('丢弃这条待确认内容？');
  assert.ok(danger.textContent.includes('丢弃后它不会进入落袋，也不会参与召回。'));
  cancelDanger(danger);
  await tick();
  assert.equal(memoryPockets.find((pocket) => pocket.id === 'soil-pocket-conv-1')?.status, 'pending', 'cancel must keep the pending pocket');
  autoPocketCard = document.querySelector('[data-pocket-id="soil-pocket-conv-1"]');
  autoPocketCard.querySelector('[data-memory-tag]').value = '历史锚点';
  autoPocketCard.querySelector('[data-action="memory:pocket-resolve"][data-destination="memory"]').click();
  await waitFor(() => memoryPockets.find((pocket) => pocket.id === 'soil-pocket-conv-1')?.status === 'confirmed', 'write canonical pocket to memory library');
  assert.equal(memoryPockets.some((pocket) => pocket.source_type === 'message'), false, 'retired raw-message pocket must not exist in pending pocket state');
  document.querySelector('[data-action="router:back"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'memory', 'return to memory library');
  assert.ok(document.querySelector('[data-entry-id]')?.textContent.includes('暂放的潮汐岔路'));
  for (const [kind, label] of [['time', '日期'], ['model', '模型'], ['window', '窗口'], ['tag', '标签']]) {
    const option = document.querySelector(`[data-action="memory:filter-kind"][data-value="${kind}"]`);
    assert.ok(option, `${label} dimension stays fixed after entries appear`);
  }
  document.querySelector('[data-action="memory:filter-kind"][data-value="model"]').click();
  await waitFor(() => document.querySelector('.memory-filter-kind')?.textContent.includes('模型'), 'switch filter dimension to model');
  assert.ok(document.querySelector('[data-action="memory:filter-value"][data-value="5.5"]'), 'model value bubble menu must derive 5.5 from real entries');
  assert.equal(document.querySelector('[name="source_model"]'), null, 'filter bubbles must not restore native model select');

  const memoryDetails = document.querySelector('[data-entry-id] details');
  memoryDetails.open = true;
  assert.ok(memoryDetails.textContent.includes('索引：5.5 /'));
  document.querySelector('[data-action="memory:tab"][data-scope="seed"]').click();
  await waitFor(() => document.querySelector('[data-action="memory:tab"][data-scope="seed"]').classList.contains('is-active'), 'seed library tab');
  assert.equal(
    [...document.querySelectorAll('[data-entry-id]')].some((entry) => entry.textContent.includes('mock: a1 edited')),
    false,
    'retired raw-message pocket must not seed the library',
  );
  document.querySelector('[data-action="memory:tab"][data-scope="memory"]').click();
  await waitFor(() => document.querySelector('[data-action="memory:tab"][data-scope="memory"]').classList.contains('is-active'), 'memory library tab');
  document.querySelector('[data-action="memory:entry-new"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'memory-entry-edit', 'manual memory editor');
  document.querySelector('[name="title"]').value = '长期家具';
  document.querySelector('[name="life_core"]').value = '只在明确相关时递入';
  document.querySelector('[name="usage_hint"]').value = '当屋主问起长期习惯时。';
  document.querySelector('[name="avoid_hint"]').value = '不要当成当前指令。';
  document.querySelector('[name="source_model"]').value = '手动整理';
  document.querySelector('[name="source_window"]').value = '主聊天';
  document.querySelector('[name="tag"]').value = '偏好';
  document.querySelector('[name="source_time"]').value = '2026-08-31';
  document.querySelector('[data-submit="memory:entry-save"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'memory', 'manual memory saved');
  const manualEntry = memoryEntries.find((entry) => entry.title === '长期家具' && entry.tag === '偏好');
  assert.ok(manualEntry);
  let manualEntryCard = document.querySelector(`[data-entry-id="${manualEntry.id}"]`);
  manualEntryCard.querySelector('[data-action="memory:entry-delete"]').click();
  danger = await waitForDanger('删除这条记忆内容？');
  assert.ok(danger.textContent.includes('删除后它会从对应库中移除，并不再参与召回。'));
  cancelDanger(danger);
  await tick();
  assert.equal(Boolean(manualEntry.deleted_at), false, 'cancel must keep the memory entry');
  manualEntryCard = document.querySelector(`[data-entry-id="${manualEntry.id}"]`);
  manualEntryCard.querySelector('[data-action="memory:entry-delete"]').click();
  danger = await waitForDanger('删除这条记忆内容？');
  acceptDanger(danger);
  await waitFor(() => Boolean(manualEntry.deleted_at), 'confirmed memory entry delete');
  assert.equal(document.querySelector(`[data-entry-id="${manualEntry.id}"]`), null);
  document.querySelector('[data-action="router:back"]').click();
  await tick();
}
