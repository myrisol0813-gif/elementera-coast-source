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

function candidateCard(excerpt, candidate) {
  return `<section class="global-excerpt-candidate" data-global-excerpt-candidate="${escapeAttribute(candidate.id)}">
    <div class="global-excerpt-candidate-head">
      <span><strong>待确认修改</strong><small>${escapeHtml(candidate.change_kind || 'rewrite')} · ${escapeHtml(dateLabel(candidate.created_at))}</small></span>
    </div>
    <p class="feature-note">${escapeHtml(candidate.reason || '模型没有留下额外理由。')}</p>
    <div class="global-excerpt-paper global-excerpt-diff" aria-label="候选全文差异">${diffBody(excerpt.body, candidate.proposed_body)}</div>
    <div class="button-row">
      <button type="button" data-action="memory:global-excerpt-confirm" data-id="${escapeAttribute(candidate.id)}">确认</button>
      <button type="button" data-action="memory:global-excerpt-edit" data-id="${escapeAttribute(candidate.id)}">编辑后确认</button>
      <button type="button" data-action="memory:global-excerpt-discard" data-id="${escapeAttribute(candidate.id)}">驳回</button>
    </div>
  </section>`;
}

export function createGlobalExcerptViews({ runtime }) {
  function globalExcerptView() {
    const data = runtime.globalExcerpt || {};
    const excerpt = data.excerpt || { body: '', write_enabled: false, revision: 0 };
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const revisions = Array.isArray(data.revisions) ? data.revisions : [];
    return {
      title: '全局摘录',
      subtitle: '一篇长期生长的正文 · 正式变化必须经过确认',
      className: 'global-excerpt-view',
      body: `<section class="global-excerpt-toolbar">
        <div><strong>写入开关</strong><small>${excerpt.write_enabled ? '开启 · 模型可在高价值变化时提出候选' : '关闭 · 只读正式正文，不生成候选'}</small></div>
        <button type="button" class="choice-pill ${excerpt.write_enabled ? 'is-active' : ''}" data-action="memory:global-excerpt-toggle" data-value="${excerpt.write_enabled ? 'false' : 'true'}">${excerpt.write_enabled ? '已开启' : '已关闭'}</button>
      </section>
      <details class="global-excerpt-guidance">
        <summary>写入说明 / 收录准则</summary>
        <p class="feature-note">${escapeHtml(excerpt.write_guidance || '这里只沉积真正有重量的长期认知变化；候选必须经过确认后才进入正式正文。')}</p>
      </details>
      <section class="feature-group">
        <h2>正式正文</h2>
        <article class="global-excerpt-paper">${rich(excerpt.body)}</article>
      </section>
      ${candidates.length ? `<section class="feature-group"><h2>待确认区 · ${candidates.length}</h2><div class="global-excerpt-candidates">${candidates.map((candidate) => candidateCard(excerpt, candidate)).join('')}</div></section>` : '<p class="feature-note">现在没有待确认修改。正式正文会继续照常进入上下文。</p>'}
      <details class="global-excerpt-history">
        <summary>修改记录 · ${revisions.length}</summary>
        <div class="global-excerpt-history-list">${revisions.length ? revisions.map((revision) => `<article>
          <strong>revision ${Number(revision.revision) || 0} · ${escapeHtml(dateLabel(revision.created_at))}</strong>
          <small>${escapeHtml(revision.confirmation_mode || '')} · ${escapeHtml(revision.operator || '')}${revision.source_conversation_id ? ` · 来源窗口 ${escapeHtml(revision.source_conversation_id)}` : ''}</small>
          ${revision.model_reason ? `<p>${escapeHtml(revision.model_reason)}</p>` : ''}
          <details><summary>查看前后差异</summary><div class="global-excerpt-paper global-excerpt-diff">${diffBody(revision.before_body, revision.after_body)}</div></details>
        </article>`).join('') : '<p class="feature-empty">还没有正式修改记录。</p>'}</div>
      </details>`,
    };
  }

  function globalExcerptEditView({ id = '' } = {}) {
    const data = runtime.globalExcerpt || {};
    const candidate = (Array.isArray(data.candidates) ? data.candidates : []).find((item) => item.id === id);
    if (!candidate) return { title: '编辑全局摘录', subtitle: '候选已不存在', body: '<p class="feature-empty">这条候选已经离开待确认区。</p>' };
    return {
      title: '编辑后确认',
      subtitle: '保存后直接成为新的正式正文，并留下 revision 记录',
      className: 'global-excerpt-edit',
      body: `<form class="form-stack" data-submit="memory:global-excerpt-edit-confirm" data-id="${escapeAttribute(candidate.id)}">
        <label>完整正文<textarea name="body" rows="24" required>${escapeHtml(candidate.proposed_body)}</textarea></label>
        <p class="feature-note">这里编辑的是整篇正式正文候选；确认后候选消失，修改历史保留。</p>
        <button class="primary-wide" type="submit">编辑后确认</button>
      </form>`,
    };
  }

  return Object.freeze({ globalExcerptView, globalExcerptEditView });
}
