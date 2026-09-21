import assert from 'node:assert/strict';
import {
  window, prompts, profile, conversations, histories, historyWrites, formalChatRequests, formalChatBodies,
  soils, memoryPockets, memoryEntries, customInstructions, landingBodies, titleBodies, soilOrganizeBodies,
  dailyLoadRequests, dailyModelPartnerCommentBodies, dailyMoments, dailyDiaries, dailyProfile, dogtalks, clipboard, now, soilFor,
  tick, waitFor, waitForDanger, cancelDanger, acceptDanger,
  setFormalFinishReason, setLandingFinishReason, setFailNextSoilOrganize,
} from './dom-harness.mjs';

function installDailyCommentSseAdapter() {
  const baseFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), 'http://coast.test');
    if (!url.pathname.endsWith('/model-partner-comment')) return baseFetch(input, options);
    const response = await baseFetch(input, options);
    const payload = await response.json();
    const body = [
      'event: ready',
      'data: {"ok":true}',
      '',
      'event: result',
      `data: ${JSON.stringify(payload)}`,
      '',
      '',
    ].join('\n');
    return new Response(body, {
      status: response.status,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    });
  };
  return () => { globalThis.fetch = baseFetch; };
}

export async function runDailyFlow() {
  const restoreFetch = installDailyCommentSseAdapter();
  try {
    let danger;
    document.querySelector('[data-action="daily:home"]').click();
    await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'daily-home', 'daily route');
    await waitFor(() => document.querySelectorAll('.daily-grid button').length === 4, 'trimmed Daily server load');
    for (const action of ['moments', 'diary', 'pets', 'widgets']) assert.ok(document.querySelector(`[data-action="daily:${action}"]`));
    for (const retired of ['summary', 'album']) assert.equal(document.querySelector(`[data-action="daily:${retired}"]`), null);
    assert.equal(document.querySelector('.daily-sync-note'), null);
    assert.equal(document.querySelector('.daily-hero'), null);

    document.querySelector('[data-action="daily:diary"]').click();
    await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'diary', 'diary route through Event Spine');
    await waitFor(() => document.querySelector('[data-action="daily:delete-diary"][data-id="daily-diary-delete-dom"]'), 'Daily diary server record');
    const diaryDeleteButton = document.querySelector('[data-action="daily:delete-diary"][data-id="daily-diary-delete-dom"]');
    assert.ok(diaryDeleteButton.closest('.diary-card-actions'));
    assert.equal(diaryDeleteButton.classList.contains('is-delete'), true);
    const diaryLoadsBeforeDelete = dailyLoadRequests;
    diaryDeleteButton.click();
    danger = await waitForDanger('确定删除这篇日记吗？');
    acceptDanger(danger);
    await waitFor(() => !dailyDiaries.some((entry) => entry.id === 'daily-diary-delete-dom')
      && !document.querySelector('[data-action="daily:delete-diary"][data-id="daily-diary-delete-dom"]'), 'confirmed Daily diary delete');
    assert.equal(dailyLoadRequests, diaryLoadsBeforeDelete, 'diary delete must not immediately re-fetch Daily');

    document.querySelector('[data-action="daily:diary-compose"]').click();
    await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'diary-compose', 'diary composer');
    document.querySelector('#diaryWeather').value = '微风';
    document.querySelector('#diaryMood').value = '安稳';
    document.querySelector('#diaryText').value = '统一后的第一张服务器日记。';
    document.querySelector('#diaryTags').value = '海岸,整理';
    document.querySelector('[data-action="daily:save-diary"]').click();
    await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'diary'
      && document.querySelector('#overlayRoot').textContent.includes('统一后的第一张服务器日记。'), 'direct Diary create');
    assert.equal(dailyDiaries.length, 1);
    assert.deepEqual(dailyDiaries[0].tags, ['海岸', '整理']);

    document.querySelector('[data-action="daily:home"]').click();
    await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'daily-home', 'return trimmed Daily home');
    document.querySelector('[data-action="daily:moments"]').click();
    await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'moments', 'moments route');
    assert.ok(document.querySelector('[data-action="daily:model-partner-avatar"]')?.textContent.includes('另一位屋主 头像'));
    assert.ok(document.querySelector('[data-action="daily:model-partner-avatar"]')?.textContent.includes('点击动态里的名字可以修改显示名'));
    assert.ok(document.querySelector('[data-action="daily:cover"]')?.textContent.includes('点击设置封面'));
    assert.equal(document.querySelector('[data-draft-id]'), null, 'Daily no longer renders generated drafts');
    document.querySelector('[data-action="daily:moments-compose"]').click();
    await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'moments-compose', 'moments composer');
    assert.equal(document.querySelector('#momentImageRef'), null, 'Moment 图片引用输入必须保持删除');
    assert.equal(document.querySelector('#diaryImageRef'), null, 'Diary 图片引用输入必须保持删除');
    document.querySelector('#momentText').value = '第一条统一服务器碳硅圈\n' + '长长的海岸文字。'.repeat(100);
    document.querySelector('[data-action="daily:save-moment"]').click();
    await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'moments'
      && document.querySelector('#overlayRoot').textContent.includes('第一条统一服务器碳硅圈'), 'direct Moment create');
    assert.equal(dailyMoments.length, 1);
    assert.equal(dailyMoments[0].source, 'manual');
    assert.equal(dailyModelPartnerCommentBodies.length, 1, 'new manual Moment must request the instant Model Partner comment once');
    assert.equal(dailyMoments[0].comments.length, 1);
    assert.equal(dailyMoments[0].comments[0].author, 'model_partner');
    assert.ok(document.querySelector('[data-action="daily:edit-model-partner-name"]'), 'Model Partner author/comment must expose the shared editable display name');
    assert.ok(document.querySelector('.moment-text.is-collapsed'));
    assert.equal(document.querySelector('[data-action="daily:toggle-moment"]').textContent, '展开全文');
    document.querySelector('[data-action="daily:toggle-moment"]').click();
    await waitFor(() => document.querySelector('[data-action="daily:toggle-moment"]')?.textContent === '收起', 'expand long Moment');
    assert.equal(document.querySelector('.moment-text.is-collapsed'), null);
    document.querySelector('[data-action="daily:toggle-moment"]').click();
    await waitFor(() => document.querySelector('.moment-text.is-collapsed'), 'collapse long Moment again');

    document.querySelector('[data-action="daily:like"]').click();
    await waitFor(() => dailyMoments[0].liked === true && dailyMoments[0].like_count === 1, 'Moment like');
    document.querySelector('[data-action="daily:comment"]').click();
    await waitFor(() => document.querySelector('#momentCommentInput'), 'Moment comment editor');
    document.querySelector('#momentCommentInput').value = '今天的海风很好。';
    document.querySelector('[data-action="daily:send-comment"]').click();
    await waitFor(() => dailyMoments[0].comments.length === 2
      && document.querySelector('#overlayRoot').textContent.includes('今天的海风很好。'), 'manual Moment comment');
    const ownerComment = dailyMoments[0].comments.find((comment) => comment.author === 'owner');
    assert.ok(ownerComment);
    const commentDeleteButton = document.querySelector(`[data-action="daily:delete-comment"][data-comment-id="${ownerComment.id}"]`);
    assert.ok(commentDeleteButton);
    commentDeleteButton.click();
    danger = await waitForDanger('删除这条评论吗？');
    acceptDanger(danger);
    await waitFor(() => dailyMoments[0].comments.length === 1
      && dailyMoments[0].comments[0].author === 'model_partner', 'confirmed Daily comment delete');
    const momentLoadsBeforeDelete = dailyLoadRequests;
    document.querySelector('[data-action="daily:delete-moment"]').click();
    danger = await waitForDanger('确定删除这条碳硅圈吗？');
    acceptDanger(danger);
    await waitFor(() => dailyMoments.length === 0
      && !document.querySelector('#overlayRoot').textContent.includes('第一条统一服务器碳硅圈'), 'confirmed Daily moment delete');
    assert.equal(dailyLoadRequests, momentLoadsBeforeDelete, 'moment delete must not immediately re-fetch Daily');

    for (const [action, title] of [['pets', '宠物系统'], ['widgets', '未来小组件']]) {
      document.querySelector('[data-action="daily:home"]').click();
      await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'daily-home', `Daily home before ${action}`);
      document.querySelector(`[data-action="daily:${action}"]`).click();
      await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'daily-placeholder'
        && document.querySelector('#overlayRoot').textContent.includes(title), `${title} placeholder`);
    }
    document.querySelector('[data-action="daily:home"]').click();
    await waitFor(() => document.querySelector('#overlayRoot')?.dataset.route === 'daily-home', 'Daily home after placeholders');
    document.querySelector('[data-action="router:back"]').click();
    await tick();
  } finally {
    restoreFetch();
  }
}
