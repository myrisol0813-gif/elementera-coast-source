import assert from 'node:assert/strict';
import {
  window, profile, tick, waitFor,
} from './dom-harness.mjs';

export async function runDeskFlow() {
  document.querySelector('[data-action="settings:wolf"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'wolf', '屋主设置 route');
  const wolfText = document.querySelector('#overlayRoot').textContent;
  for (const label of ['个人资料', '外观', '聊天记录', '模型箱', '基本设置', '关于与诊断']) assert.ok(wolfText.includes(label));
  for (const retired of ['API 免费沙盒测试', '施工状态', 'System Prompt 草稿', '运行水闸', '开发者工具']) assert.equal(wolfText.includes(retired), false);

  document.querySelector('[data-action="tools:basic-settings"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'basic-settings', 'basic settings route');
  for (const label of ['最近聊天轮数', '上下文 token budget', '回答长度', '最大输出 token', '表达倾向', '流式输出', '当前对话纸条最多字数', '线索冷却轮数', '世界书 / 词典', '每轮最多词条', '本轮记忆召回上限']) {
    assert.ok(document.querySelector('#overlayRoot').textContent.includes(label));
  }
  const recentTurnsControl = document.querySelector('[name="recentTurns"]');
  const contextBudgetControl = document.querySelector('[name="contextBudget"]');
  assert.ok(recentTurnsControl, 'recentTurns control must exist');
  assert.ok(contextBudgetControl, 'contextBudget control must exist');
  assert.equal(recentTurnsControl.hasAttribute('max'), false, 'recent turns must not have a product upper ceiling');
  assert.equal(contextBudgetControl.hasAttribute('max'), false, 'context budget must not have a product upper ceiling');
  for (const [name, value] of [
    ['maxOutputTokens', '4096'],
    ['seedCooldownTurns', '0'],
    ['memoryLimit', '6'],
    ['worldbookLimit', '4'],
  ]) {
    const control = document.querySelector(`[name="${name}"]`);
    assert.ok(control, `${name} control must exist`);
    control.value = value;
    control.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  document.querySelector('[data-action="tools:vector-status"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'memory-vector-status', 'vector status route');
  assert.ok(document.querySelector('#overlayRoot').textContent.includes('37'));
  assert.ok(document.querySelector('#overlayRoot').textContent.includes('未连接'));
  for (const route of ['basic-settings', 'wolf']) {
    document.querySelector('[data-action="router:back"]').click();
    await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === route, `back to ${route}`);
  }
  document.querySelector('[data-action="router:back"]').click();
  await tick();

  document.querySelector('[data-action="settings:desk"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'desk', '模型工作台 entry');
  const deskText = document.querySelector('#overlayRoot').textContent;
  assert.ok(deskText.includes('模型工作台'));
  assert.ok(deskText.includes('工具调用记录'));
  for (const retired of ['Model Partner 画像', 'Model Partner 气泡', '桌面便签', '本轮上下文预览', '词典', '开发者工具', '基本设置']) assert.equal(deskText.includes(retired), false);
  document.querySelector('[data-action="toolroom:open"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'toolroom', 'action log route through Event Spine');
  const toolroomText = document.querySelector('#overlayRoot').textContent;
  assert.ok(toolroomText.includes('工具调用记录'));
  assert.ok(toolroomText.includes('模型工作台'));
  assert.ok(toolroomText.includes('行动日志'));
  document.querySelector('[data-action="router:back"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'desk', 'toolroom returns to desk entry');
  document.querySelector('[data-action="router:back"]').click();
  await tick();

  document.querySelector('#modelButton').click();
  await waitFor(() => !document.querySelector('#modelQuickPicker').hidden, 'model quick picker');
  assert.ok(document.querySelectorAll('#modelQuickPicker [data-action="models:quick-select"]').length >= 2);
  document.querySelector('#modelQuickPicker [data-action="models:open"]').click();
  await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'models', 'models route');
  assert.ok(document.querySelectorAll('.model-row').length >= 2);
  const catalogHeadings = [...document.querySelectorAll('.feature-group > h2')].map((heading) => heading.textContent);
  assert.ok(catalogHeadings.indexOf('o 系列') < catalogHeadings.indexOf('GPT-4 系列'));
  assert.ok(catalogHeadings.indexOf('GPT-4 系列') < catalogHeadings.indexOf('GPT-5 系列'));
  const searchInput = document.querySelector('[data-input="models:search-draft"]');
  searchInput.value = '5.2';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('[data-input="models:search-draft"]'), searchInput, 'typing must not rerender the model page');
  document.querySelector('[data-submit="models:search"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => document.querySelector('.feature-group > h2')?.ownerDocument.body.textContent.includes('GPT-5.2'), 'model search');
  assert.equal(document.querySelectorAll('[data-action="models:add"][data-id="openai/gpt-5.2"]').length, 1);
  const modelBody = document.querySelector('.feature-body');
  modelBody.scrollTop = 320;
  document.querySelector('[data-action="models:add"][data-id="openai/gpt-5.2"]').click();
  await waitFor(() => profile.model_box.chat.includes('openai/gpt-5.2'), 'add model');
  assert.equal(document.querySelector('.feature-body').scrollTop, 320);
  assert.equal(document.querySelector('#toastRoot').textContent, '模型已添加');
  document.querySelector('[data-action="router:back"]').click();
  await tick();
  document.querySelector('#modelButton').click();
  await waitFor(() => !document.querySelector('#modelQuickPicker').hidden, 'updated quick picker');
  const quickFive = document.querySelector('#modelQuickPicker [data-action="models:quick-select"][data-id="openai/gpt-5.2"]');
  assert.ok(quickFive);
  quickFive.click();
  await waitFor(() => document.querySelector('#modelName').textContent === '5.2 ›', 'quick model switch');
  assert.equal(document.querySelector('#modelQuickPicker').hidden, true);
}
