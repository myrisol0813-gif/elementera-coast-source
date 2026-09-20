import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml } from '../core/dom.js';

const ROUTES = new Set(['widget-moments', 'widget-moment-compose', 'widget-diaries', 'widget-diary-compose']);

function authorLabel(value) {
  return value === 'model_partner' ? '另一位屋主' : '屋主';
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function momentCard(item) {
  return '<article class="moment-post"><div class="daily-avatar">' + (item.author === 'model_partner' ? 'M' : 'O')
    + '</div><div class="moment-main"><h3>' + escapeHtml(authorLabel(item.author)) + '</h3><p>'
    + escapeHtml(item.text || '') + '</p><div class="moment-actions"><span>' + escapeHtml(item.date || '')
    + '</span><button type="button" data-action="widgets:moment-delete" data-id="' + escapeAttribute(item.id)
    + '">删除</button></div></div></article>';
}
function diaryCard(item) {
  return '<article class="diary-paper"><header><b>' + escapeHtml(item.date || '') + '</b><span>'
    + escapeHtml(authorLabel(item.author)) + '</span></header><p>' + escapeHtml(item.text || '')
    + '</p><div class="diary-card-actions"><button class="is-delete" type="button" data-action="widgets:diary-delete" data-id="'
    + escapeAttribute(item.id) + '">删除</button></div></article>';
}

export function createWidgets({ router, toast }) {
  const state = { moments: [], diaries: [] };

  async function loadMoments() {
    const data = await requestJson(API.dailyMoments);
    state.moments = Array.isArray(data.moments) ? data.moments : [];
  }
  async function loadDiaries() {
    const data = await requestJson(API.dailyDiaries);
    state.diaries = Array.isArray(data.diaries) ? data.diaries : [];
  }

  async function momentsView() {
    await loadMoments();
    return {
      title: '短帖',
      subtitle: '小组件 · source 本地数据',
      className: 'daily-panel',
      headerAction: '<button class="feature-head-action" type="button" data-action="widgets:moment-compose">新建</button>',
      body: '<section class="moment-feed">' + (state.moments.length ? state.moments.map(momentCard).join('')
        : '<div class="daily-empty"><h2>还没有短帖</h2><p>这里存放 source 部署自己的简短记录。</p></div>') + '</section>',
    };
  }

  function momentComposeView() {
    return {
      title: '新建短帖',
      subtitle: '小组件',
      className: 'daily-panel',
      body: '<form class="daily-form-surface" data-submit="widgets:moment-save">'
        + '<label>日期<input type="date" name="date" value="' + today() + '"></label>'
        + '<label>作者<select name="author"><option value="owner">屋主</option><option value="model_partner">另一位屋主</option></select></label>'
        + '<label>正文<textarea name="text" rows="8" maxlength="12000" required></textarea></label>'
        + '<button class="primary-wide" type="submit">保存短帖</button></form>',
    };
  }

  async function diariesView() {
    await loadDiaries();
    return {
      title: '日记',
      subtitle: '小组件 · source 本地数据',
      className: 'daily-panel',
      headerAction: '<button class="feature-head-action" type="button" data-action="widgets:diary-compose">新建</button>',
      body: state.diaries.length ? state.diaries.map(diaryCard).join('')
        : '<div class="daily-empty"><h2>还没有日记</h2><p>这里存放 source 部署自己的长文本记录。</p></div>',
    };
  }

  function diaryComposeView() {
    return {
      title: '新建日记',
      subtitle: '小组件',
      className: 'daily-panel',
      body: '<form class="daily-form-surface" data-submit="widgets:diary-save">'
        + '<label>日期<input type="date" name="date" value="' + today() + '"></label>'
        + '<label>作者<select name="author"><option value="owner">屋主</option><option value="model_partner">另一位屋主</option></select></label>'
        + '<label>天气<input name="weather" maxlength="80"></label>'
        + '<label>心情<input name="mood" maxlength="120"></label>'
        + '<label>标签<input name="tags" maxlength="300" placeholder="用逗号分隔"></label>'
        + '<label>正文<textarea name="text" rows="12" maxlength="50000" required></textarea></label>'
        + '<button class="primary-wide" type="submit">保存日记</button></form>',
    };
  }

  router.register('widget-moments', momentsView);
  router.register('widget-moment-compose', momentComposeView);
  router.register('widget-diaries', diariesView);
  router.register('widget-diary-compose', diaryComposeView);

  async function handleAction(name, target) {
    if (name === 'moments') return router.open('widget-moments');
    if (name === 'diaries') return router.open('widget-diaries');
    if (name === 'moment-compose') return router.open('widget-moment-compose');
    if (name === 'diary-compose') return router.open('widget-diary-compose');
    if (name === 'moment-delete') {
      await requestJson(API.dailyMoments + '/' + encodeURIComponent(target?.dataset?.id || ''), { method: 'DELETE' });
      toast('短帖已删除');
      return router.refresh();
    }
    if (name === 'diary-delete') {
      await requestJson(API.dailyDiaries + '/' + encodeURIComponent(target?.dataset?.id || ''), { method: 'DELETE' });
      toast('日记已删除');
      return router.refresh();
    }
  }

  async function handleSubmit(name, target) {
    const data = new FormData(target);
    if (name === 'moment-save') {
      await requestJson(API.dailyMoments, {
        method: 'POST',
        body: JSON.stringify({
          date: String(data.get('date') || ''),
          author: String(data.get('author') || 'owner'),
          text: String(data.get('text') || ''),
        }),
      });
      toast('短帖已保存');
      return router.open('widget-moments');
    }
    if (name === 'diary-save') {
      await requestJson(API.dailyDiaries, {
        method: 'POST',
        body: JSON.stringify({
          date: String(data.get('date') || ''),
          author: String(data.get('author') || 'owner'),
          weather: String(data.get('weather') || ''),
          mood: String(data.get('mood') || ''),
          tags: String(data.get('tags') || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean),
          text: String(data.get('text') || ''),
        }),
      });
      toast('日记已保存');
      return router.open('widget-diaries');
    }
  }

  return Object.freeze({
    id: 'widgets',
    priority: 55,
    mountOrder: 55,
    ownsRoute: (route) => ROUTES.has(route?.name || ''),
    ownsEvent(_event, context) {
      if (context.namespace !== 'widgets') return false;
      if (context.eventType === 'click' || context.eventType === 'submit') return { preventDefault: true };
      return false;
    },
    handleEvent(_event, context) {
      return context.eventType === 'submit'
        ? handleSubmit(context.name, context.target)
        : handleAction(context.name, context.target);
    },
    handleAction,
    mount() {},
    refresh() {},
    destroy() {},
  });
}