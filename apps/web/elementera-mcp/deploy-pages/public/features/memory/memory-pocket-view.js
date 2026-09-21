import { escapeAttribute, escapeHtml } from '../../core/dom.js';
import { MEMORY_TAGS } from './memory-constants.js';
import { shortModelName, tagOptions } from './memory-format.js';

export function createPocketViews({ currentPockets }) {
  function pocketCard(pocket) {
    const title = pocket.title || pocket.suggested_title || '待确认内容';
    const lifeCore = pocket.life_core || pocket.suggested_life_core || pocket.source_text || '';
    const usageHint = pocket.usage_hint || pocket.suggested_usage_hint || '';
    const avoidHint = pocket.avoid_hint || pocket.suggested_avoid_hint || '';
    const selectedTag = MEMORY_TAGS.find((tag) => tag === pocket.tag || pocket.memory_tags?.includes(tag)) || '';
    const provenance = pocket.generated_by_model
      ? `<p class="feature-note generation-provenance">提炼 · ${escapeHtml(shortModelName(pocket.generated_by_model))}</p>`
      : '';
    const revision = pocket.revision
      ? `<p class="feature-kicker">记忆修订候选 · 旧版保留</p>`
      : '';
    return `<article class="feature-card feature-prose" data-pocket-id="${escapeAttribute(pocket.id)}">
      ${revision}
      <h2>${escapeHtml(title)}</h2>
      <p><strong>核心：</strong>${escapeHtml(lifeCore)}</p>
      ${pocket.source_excerpt ? `<p><strong>来源：</strong>${escapeHtml(pocket.source_excerpt)}</p>` : ''}
      ${usageHint ? `<p><strong>使用时机：</strong>${escapeHtml(usageHint)}</p>` : ''}
      ${avoidHint ? `<p><strong>勿误用：</strong>${escapeHtml(avoidHint)}</p>` : ''}
      <label class="memory-pocket-tag">六签<select data-memory-tag>${tagOptions(selectedTag)}</select></label>
      <p class="feature-note">只有确认后才会进入记忆库或种子库。种子是可生长方向，不是已确认事实。</p>
      ${provenance}
      <div class="button-row">
        <button class="primary-wide" type="button" data-action="memory:pocket-resolve" data-id="${escapeAttribute(pocket.id)}" data-destination="memory">写入记忆库</button>
        <button type="button" data-action="memory:pocket-resolve" data-id="${escapeAttribute(pocket.id)}" data-destination="seed">写入种子库</button>
        <button type="button" data-action="memory:pocket-discard" data-id="${escapeAttribute(pocket.id)}">丢弃</button>
      </div>
    </article>`;
  }

  function pocketsView() {
    const pockets = currentPockets();
    return {
      title: '待确认区',
      subtitle: '只属于当前窗口的缓冲层',
      className: 'memory-pockets',
      body: pockets.length
        ? `<div class="memory-pocket-list">${pockets.map(pocketCard).join('')}</div>`
        : '<p class="feature-empty">待确认区是空的。</p>',
    };
  }

  return Object.freeze({ pocketCard, pocketsView });
}
