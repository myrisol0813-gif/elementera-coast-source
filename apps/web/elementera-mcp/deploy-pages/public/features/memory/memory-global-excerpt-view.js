import { escapeAttribute, escapeHtml } from '../../core/dom.js';

function rich(value) {
  return escapeHtml(String(value || '')).replace(/\n/g, '<br>');
}

function diffBody(beforeValue, afterValue) {
  const before = String(beforeValue || '');
  const after = String(afterValue || '');
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  const beforeMiddle = before.slice(prefix, before.length - suffix);
  const afterMiddle = after.slice(prefix, after.length - suffix);
  return [
    rich(after.slice(0, prefix)),
    beforeMiddle ? `<del class="global-excerpt-diff-old">${rich(beforeMiddle)}</del>` : '',
    afterMiddle ? `<mark class="global-excerpt-diff-new">${rich(afterMiddle)}</mark>` : '',
    rich(after.slice(after.length - suffix)),
  ].join('');
}

function dateLabel(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN');
}

function portraitViews({
  runtime,
  runtimeKey,
  documentKey,
  title,
  subtitle,
  actionPrefix,
}) {
  const data = () => runtime[runtimeKey] || {};
  const document = () => data()[documentKey] || { body: '', write_enabled: false, revision: 0 };
  const candidates = () => Array.isArray(data().candidates) ? data().candidates : [];
  const revisions = () => Array.isArray(data().revisions) ? data().revisions : [];

  function candidateCard(current, candidate) {
    return `<section class="global-excerpt-candidate" data-portrait-candidate="${escapeAttribute(candidate.id)}">
      <div class="global-excerpt-candidate-head">
        <span><strong>待确认修改</strong><small>${escapeHtml(candidate.change_kind || 'rewrite')} · ${escapeHtml(dateLabel(candidate.created_at))}</small></span>
      </div>
      <p class="feature-note">${escapeHtml(candidate.reason || '这一轮没有留下额外理由。')}</p>
      <div class="global-excerpt-paper global-excerpt-diff" aria-label="候选全文差异">${diffBody(current.body, candidate.proposed_body)}</div>
      <div class="button-row">
        <button type="button" data-action="memory:${actionPrefix}-confirm" data-id="${escapeAttribute(candidate.id)}">确认</button>
        <button type="button" data-action="memory:${actionPrefix}-edit" data-id="${escapeAttribute(candidate.id)}">编辑后确认</button>
        <button type="button" data-action="memory:${actionPrefix}-discard" data-id="${escapeAttribute(candidate.id)}">驳回</button>
      </div>
    </section>`;
  }

  function view() {
    const current = document();
    const pending = candidates();
    const history = revisions();
    return {
      title,
      subtitle,
      className: 'global-excerpt-view',
      body: `<section class="global-excerpt-toolbar">
        <div><strong>自动整理</strong><small>${current.write_enabled ? '开启 · 对话整理可在形成稳定新认识时提出修改候选' : '关闭 · 正式正文仍会照常参与上下文'}</small></div>
        <button type="button" class="choice-pill ${current.write_enabled ? 'is-active' : ''}" data-action="memory:${actionPrefix}-toggle" data-value="${current.write_enabled ? 'false' : 'true'}">${current.write_enabled ? '已开启' : '已关闭'}</button>
      </section>
      <details class="global-excerpt-guidance">
        <summary>收录准则</summary>
        <p class="feature-note">${escapeHtml(current.write_guidance || '')}</p>
      </details>
      <section class="feature-group">
        <h2>正式正文</h2>
        <article class="global-excerpt-paper">${current.body ? rich(current.body) : '<span class="feature-empty">这幅画像还没有开始书写。</span>'}</article>
      </section>
      ${pending.length ? `<section class="feature-group"><h2>待确认修改 · ${pending.length}</h2><div class="global-excerpt-candidates">${pending.map((candidate) => candidateCard(current, candidate)).join('')}</div></section>` : '<p class="feature-note">现在没有待确认修改。正式正文会继续照常进入上下文。</p>'}
      <details class="global-excerpt-history">
        <summary>修改记录 · ${history.length}</summary>
        <div class="global-excerpt-history-list">${history.length ? history.map((revision) => `<article>
          <strong>revision ${Number(revision.revision) || 0} · ${escapeHtml(dateLabel(revision.created_at))}</strong>
          <small>${escapeHtml(revision.confirmation_mode || '')} · ${escapeHtml(revision.operator || '')}${revision.source_conversation_id ? ` · 来源窗口 ${escapeHtml(revision.source_conversation_id)}` : ''}</small>
          ${revision.model_reason ? `<p>${escapeHtml(revision.model_reason)}</p>` : ''}
          <details><summary>查看前后差异</summary><div class="global-excerpt-paper global-excerpt-diff">${diffBody(revision.before_body, revision.after_body)}</div></details>
        </article>`).join('') : '<p class="feature-empty">还没有正式修改记录。</p>'}</div>
      </details>`,
    };
  }

  function editView({ id = '' } = {}) {
    const candidate = candidates().find((item) => item.id === id);
    if (!candidate) return { title: `编辑${title}`, subtitle: '候选已不存在', body: '<p class="feature-empty">这条候选已经离开待确认区。</p>' };
    return {
      title: '编辑后确认',
      subtitle: `保存后成为新的${title}正式正文，并留下 revision 记录`,
      className: 'global-excerpt-edit',
      body: `<form class="form-stack" data-submit="memory:${actionPrefix}-edit-confirm" data-id="${escapeAttribute(candidate.id)}">
        <label>完整正文<textarea name="body" rows="24" required>${escapeHtml(candidate.proposed_body)}</textarea></label>
        <p class="feature-note">这里编辑的是整篇正式正文候选；确认后候选消失，修改历史保留。</p>
        <button class="primary-wide" type="submit">编辑后确认</button>
      </form>`,
    };
  }

  return Object.freeze({ view, editView });
}

export function createGlobalExcerptViews({ runtime }) {
  const views = portraitViews({
    runtime,
    runtimeKey: 'globalExcerpt',
    documentKey: 'excerpt',
    title: '自我画像',
    subtitle: '模型如何长期认识自己 · 正式变化经过确认',
    actionPrefix: 'global-excerpt',
  });
  return Object.freeze({
    globalExcerptView: views.view,
    globalExcerptEditView: views.editView,
  });
}

export function createUserPortraitViews({ runtime }) {
  const views = portraitViews({
    runtime,
    runtimeKey: 'userPortrait',
    documentKey: 'portrait',
    title: '用户画像',
    subtitle: '模型如何长期认识当前用户 · 正式变化经过确认',
    actionPrefix: 'user-portrait',
  });
  return Object.freeze({
    userPortraitView: views.view,
    userPortraitEditView: views.editView,
  });
}
