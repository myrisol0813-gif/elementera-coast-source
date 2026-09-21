import { escapeAttribute, escapeHtml } from '../../core/dom.js';
import { authorName, dateKey } from './daily-format.js';

export function createDailyDiariesView({ state, ensureLoad, syncNotice }) {
  function diaryCard(entry) {
    const tags = entry.tags?.length ? `<p class="daily-context">${entry.tags.map((tag) => `#${escapeHtml(tag)}`).join(' ')}</p>` : '';
    return `<article class="diary-paper">
      <header><strong>${escapeHtml(entry.date || dateKey())}</strong><small>${escapeHtml(authorName(entry))} · ${escapeHtml(entry.weather || '未标注')} · ${escapeHtml(entry.mood || '未标注')}</small></header>
      <p>${escapeHtml(entry.text || '（空白）')}</p>
      ${tags}
      <footer class="diary-card-actions"><button type="button" data-action="daily:edit-diary" data-id="${escapeAttribute(entry.id)}">编辑</button><button class="is-delete" type="button" data-action="daily:delete-diary" data-id="${escapeAttribute(entry.id)}">删除</button></footer>
    </article>`;
  }

  function diaryView() {
    ensureLoad();
    return {
      title: '日记',
      subtitle: '服务器里的正式纸页',
      className: 'diary-panel',
      headerAction: '<button class="feature-head-action" type="button" data-action="daily:diary-compose">＋ 日记</button>',
      body: `${syncNotice()}${state.diaries.length ? `<section class="diary-list">${state.diaries.map(diaryCard).join('')}</section>` : '<section class="daily-empty"><h2>还没有日记。</h2><p>想写的时候再留一张纸。</p></section>'}`,
    };
  }

  function diaryComposeView({ id = '' } = {}) {
    const entry = state.diaries.find((item) => item.id === id) || null;
    return {
      title: entry ? '编辑日记' : '写日记',
      subtitle: '直接保存为正式日记',
      className: 'diary-panel',
      body: `<section class="daily-form-surface" data-daily-diary-id="${escapeAttribute(entry?.id || '')}">
        <div class="form-grid">
          <label>日期<input id="diaryDate" type="date" value="${escapeAttribute(entry?.date || dateKey())}"></label>
          <label>天气<input id="diaryWeather" maxlength="80" value="${escapeAttribute(entry?.weather || '')}" placeholder="未标注"></label>
          <label>心情<input id="diaryMood" maxlength="120" value="${escapeAttribute(entry?.mood || '')}" placeholder="未标注"></label>
        </div>
        <label>正文<textarea id="diaryText" rows="12" maxlength="24000" placeholder="写今天。">${escapeHtml(entry?.text || '')}</textarea></label>
        <label>标签（逗号或换行分隔）<textarea id="diaryTags" rows="3">${escapeHtml((entry?.tags || []).join('\n'))}</textarea></label>
        <button class="primary-wide" type="button" data-action="daily:save-diary" data-id="${escapeAttribute(entry?.id || '')}">${entry ? '保存修改' : '写入日记'}</button>
      </section>`,
    };
  }

  return Object.freeze({ diaryView, diaryComposeView });
}
