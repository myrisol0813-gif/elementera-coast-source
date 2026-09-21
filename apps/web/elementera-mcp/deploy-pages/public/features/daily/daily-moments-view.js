import { escapeAttribute, escapeHtml } from '../../core/dom.js';
import { authorName, dateKey, dateLabel, shortModelName, timeLabel } from './daily-format.js';

function compactTokens(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '';
  if (number < 1000) return String(Math.trunc(number));
  const text = (number / 1000).toFixed(number < 10000 ? 1 : 0).replace(/\.0$/, '');
  return `${text}k`;
}

function usageLabel(value) {
  if (!value || typeof value !== 'object') return '';
  if (value.total_tokens != null) return `${compactTokens(value.total_tokens)} tokens`;
  const input = value.prompt_tokens != null ? `in ${compactTokens(value.prompt_tokens)}` : '';
  const output = value.completion_tokens != null ? `out ${compactTokens(value.completion_tokens)}` : '';
  return [input, output].filter(Boolean).join(' / ');
}

export function createDailyMomentsView({ state, ensureLoad, syncNotice, profile }) {
  function myriName() {
    return profile.myriDisplayName();
  }

  function editableModelPartnerName(label, className = '') {
    return `<button class="moment-author-edit${className ? ` ${className}` : ''}" type="button" data-action="daily:edit-myri-name" aria-label="编辑 另一位屋主 在碳硅圈里的显示名称">${escapeHtml(label)}</button>`;
  }

  function postAuthor(post) {
    if (post.author === 'api' || post.author === 'myri') {
      const symbol = post.symbol ? ` ${post.symbol}` : '';
      return editableModelPartnerName(`${myriName()}${symbol}`);
    }
    return escapeHtml(authorName(post));
  }

  function modelUsageMeta(post) {
    const myriComment = [...(Array.isArray(post.comments) ? post.comments : [])]
      .reverse()
      .find((comment) => comment.author === 'myri' && comment.modelId);
    const modelId = myriComment?.modelId || post.modelNickname || post.modelLabel || '';
    if (!modelId) return '';
    const usage = usageLabel(myriComment?.usage);
    return `<div class="moment-model-usage">${escapeHtml(shortModelName(modelId))}${usage ? ` · ${escapeHtml(usage)}` : ''}</div>`;
  }

  function momentComments(post) {
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const list = comments.length
      ? `<div class="moment-comments">${comments.map((comment) => {
        const model = comment.modelId ? ` <small>· ${escapeHtml(shortModelName(comment.modelId))}</small>` : '';
        const remove = comment.id ? `<button class="moment-comment-delete" type="button" data-action="daily:delete-comment" data-id="${escapeAttribute(post.id)}" data-comment-id="${escapeAttribute(comment.id)}">删除</button>` : '';
        const author = comment.author === 'myri'
          ? editableModelPartnerName(`${myriName()}:`, 'is-comment')
          : `<b>${escapeHtml(comment.who || '屋主')}:</b>`;
        return `<p><span>${author} ${escapeHtml(comment.text)}${model}</span>${remove}</p>`;
      }).join('')}</div>` : '';
    const editor = state.commentTarget === post.id
      ? `<div class="moment-comment-editor"><input id="momentCommentInput" placeholder="写评论"><button type="button" data-action="daily:send-comment" data-id="${escapeAttribute(post.id)}">发送</button></div>`
      : '';
    return list + editor;
  }

  function momentNeedsFold(text) {
    const value = String(text || '');
    return value.length > 700 || value.split(/\r?\n/).length > 10;
  }

  function momentCard(post) {
    const stamp = `${dateLabel(post.date)} · ${timeLabel(post.createdAt)}`;
    const foldable = momentNeedsFold(post.text);
    const expanded = state.expandedMoments.has(post.id);
    const commenting = state.commentingMomentIds.has(post.id);
    const foldClass = foldable && !expanded ? ' is-collapsed' : '';
    const foldButton = foldable ? `<button class="moment-expand" type="button" data-action="daily:toggle-moment" data-id="${escapeAttribute(post.id)}">${expanded ? '收起' : '展开全文'}</button>` : '';
    return `<article class="moment-post">
      <div>${post.author === 'xiaohan' ? profile.xiaohanAvatar() : profile.myriAvatar()}</div>
      <div class="moment-main">
        <h3>${postAuthor(post)}</h3>
        <p class="moment-text${foldClass}">${escapeHtml(post.text || '（无正文）')}</p>
        ${foldButton}
        <div class="moment-actions">
          <span>${escapeHtml(stamp)}</span>
          <button class="${post.liked ? 'is-liked' : ''}" type="button" data-action="daily:like" data-id="${escapeAttribute(post.id)}">♡ ${Number(post.likeCount || 0)}</button>
          <button type="button" data-action="daily:comment" data-id="${escapeAttribute(post.id)}">评论</button>
          <button type="button" data-action="daily:myri-comment" data-id="${escapeAttribute(post.id)}" ${commenting ? 'disabled' : ''}>${commenting ? `${escapeHtml(myriName())} 正在看…` : `${escapeHtml(myriName())} 留言`}</button>
          <button type="button" data-action="daily:edit-moment" data-id="${escapeAttribute(post.id)}">编辑</button>
          <button type="button" data-action="daily:delete-moment" data-id="${escapeAttribute(post.id)}">删除</button>
        </div>
        ${momentComments(post)}
        ${modelUsageMeta(post)}
      </div>
    </article>`;
  }

  function momentsView() {
    ensureLoad();
    const feed = state.moments.length ? state.moments.map(momentCard).join('') : '<section class="daily-empty"><h2>暂无动态。</h2><p>写一点今天的新鲜事吧。</p></section>';
    const coverImage = state.profile.momentCoverDataurl || '';
    const cover = coverImage ? `style="background-image:linear-gradient(rgba(0,0,0,.12),rgba(0,0,0,.12)),url(${escapeAttribute(coverImage)})"` : '';
    return {
      title: '碳硅圈',
      subtitle: '前端内部朋友圈',
      className: 'moments-panel',
      headerAction: '<button class="feature-head-action" type="button" data-action="daily:moments-compose">＋ 动态</button>',
      body: `<button class="moment-cover${coverImage ? ' has-cover' : ''}" type="button" data-action="daily:cover" aria-label="${coverImage ? '更换碳硅圈封面' : '设置碳硅圈封面'}" ${cover}>${coverImage ? '' : '<span>点击设置封面</span>'}</button>
        <section class="moment-avatar-tools" aria-label="碳硅圈头像设置">
          <button type="button" data-action="daily:avatar">${profile.xiaohanAvatar()}<span><strong>屋主头像</strong><small>保存在前端</small></span></button>
          <button type="button" data-action="daily:myri-avatar">${profile.myriAvatar()}<span><strong>${escapeHtml(myriName())} 头像</strong><small>点击动态里的名字可以修改显示名</small></span></button>
        </section>
        ${syncNotice()}<section class="moment-feed">${feed}</section>`,
    };
  }

  function momentComposeView({ id = '' } = {}) {
    const entry = state.moments.find((item) => item.id === id) || null;
    return {
      title: entry ? '编辑碳硅圈' : '写碳硅圈',
      subtitle: '直接保存为正式条目',
      className: 'diary-panel',
      body: `<section class="daily-form-surface" data-daily-moment-id="${escapeAttribute(entry?.id || '')}">
        <label>日期<input id="momentDate" type="date" value="${escapeAttribute(entry?.date || dateKey())}"></label>
        <label>正文<textarea id="momentText" rows="8" maxlength="12000" placeholder="今天想留什么？">${escapeHtml(entry?.text || '')}</textarea></label>
        <button class="primary-wide" type="button" data-action="daily:save-moment" data-id="${escapeAttribute(entry?.id || '')}">${entry ? '保存修改' : '发布动态'}</button>
      </section>`,
    };
  }

  return Object.freeze({ momentsView, momentComposeView });
}
