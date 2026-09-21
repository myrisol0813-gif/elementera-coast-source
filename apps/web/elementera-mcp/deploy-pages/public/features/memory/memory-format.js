import { escapeAttribute, escapeHtml } from '../../core/dom.js';
import { MEMORY_TAGS } from './memory-constants.js';

export { shortModelName } from '../../core/model-format.js';

export function tokenSuffix(usage) {
  return Number.isFinite(usage?.total_tokens)
    ? ` · ${usage.total_tokens.toLocaleString('en-US')} tok`
    : '';
}

export function memoryDate(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function textBlock(value, empty = '还没有内容。') {
  const text = String(value || '').trim();
  return `<p>${escapeHtml(text || empty).replace(/\n/g, '<br>')}</p>`;
}

export function section(title, body) {
  return `<section class="feature-group"><h2>${escapeHtml(title)}</h2><div class="feature-card feature-prose">${body}</div></section>`;
}

export function tagOptions(selected = '') {
  return `<option value="">请选择</option>${MEMORY_TAGS.map((tag) => `<option value="${escapeAttribute(tag)}" ${selected === tag ? 'selected' : ''}>${escapeHtml(tag)}</option>`).join('')}`;
}
