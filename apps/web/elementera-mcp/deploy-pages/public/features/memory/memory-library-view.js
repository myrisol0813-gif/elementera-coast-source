import { escapeAttribute, escapeHtml } from '../../core/dom.js';
import {
  MEMORY_FILTER_KIND_ORDER,
  MEMORY_FILTER_KINDS,
  MEMORY_TAGS,
} from './memory-constants.js';
import { customInstructionsBody } from './memory-custom-view.js';
import { shortModelName, tagOptions } from './memory-format.js';

export function resetDimensionFilters(runtime) {
  for (const config of Object.values(MEMORY_FILTER_KINDS)) runtime.filters[config.stateKey] = '';
}

export function availableFilterKinds() {
  return [...MEMORY_FILTER_KIND_ORDER];
}

export function filterValues(kind, facets = {}) {
  if (kind === 'tag') return MEMORY_TAGS;
  const config = MEMORY_FILTER_KINDS[kind];
  return config && Array.isArray(facets[config.facetKey]) ? facets[config.facetKey] : [];
}

export function filterDisplayValue(kind, value) {
  if (!value) return MEMORY_FILTER_KINDS[kind]?.allLabel || '';
  return kind === 'model' ? (shortModelName(value) || value) : value;
}

export function normalizeFilterState(runtime, facets = {}) {
  let changed = false;
  const available = availableFilterKinds();
  if (!available.includes(runtime.filters.filterKind)) {
    runtime.filters.filterKind = 'tag';
    resetDimensionFilters(runtime);
    changed = true;
  }
  const active = MEMORY_FILTER_KINDS[runtime.filters.filterKind];
  for (const config of Object.values(MEMORY_FILTER_KINDS)) {
    if (config.stateKey !== active.stateKey && runtime.filters[config.stateKey]) {
      runtime.filters[config.stateKey] = '';
      changed = true;
    }
  }
  const current = runtime.filters[active.stateKey];
  if (current && !filterValues(runtime.filters.filterKind, facets).includes(current)) {
    runtime.filters[active.stateKey] = '';
    changed = true;
  }
  return changed;
}

export function createLibraryViews({ runtime, currentId, currentPockets, chat }) {
  function entryCard(entry) {
    return `<article class="feature-card feature-prose memory-entry-card" data-entry-id="${escapeAttribute(entry.id)}">
      <details>
        <summary class="memory-entry-summary">
          <span><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.life_core)}</small></span>
          <span class="memory-entry-meta">${[entry.tag, entry.source_model, entry.source_window, entry.source_date].filter(Boolean).map((value) => `<span>${escapeHtml(value)}</span>`).join('')}</span>
        </summary>
        <div class="memory-entry-detail">
          <p><strong>标题：</strong>${escapeHtml(entry.title)}</p>
          <p><strong>核心：</strong>${escapeHtml(entry.life_core)}</p>
          <p><strong>使用时机：</strong>${escapeHtml(entry.usage_hint || '未标注')}</p>
          <p><strong>勿误用：</strong>${escapeHtml(entry.avoid_hint || '未标注')}</p>
          <p class="feature-note">索引：${escapeHtml(entry.source_model || '未标注模型')} / ${escapeHtml(entry.source_window || '未标注窗口')} / ${escapeHtml(entry.source_date || '未标注时间')} / ${escapeHtml(entry.tag || '待整理')}</p>
          ${entry.migration_status ? `<p class="feature-note">迁移状态：${escapeHtml(entry.migration_status)}（不是长期标签）</p>` : ''}
          <div class="button-row">
            <button type="button" data-action="memory:entry-edit" data-id="${escapeAttribute(entry.id)}">编辑</button>
            <button type="button" data-action="memory:entry-delete" data-id="${escapeAttribute(entry.id)}">删除</button>
          </div>
        </div>
      </details>
    </article>`;
  }

  function entryGroup(title, entries, empty) {
    return `<section class="feature-group"><h2>${escapeHtml(title)}</h2>${entries.length
      ? `<div class="memory-entry-list">${entries.map(entryCard).join('')}</div>`
      : `<div class="feature-card"><p class="feature-empty">${escapeHtml(empty)}</p></div>`}</section>`;
  }

  function filterMenu(id, action, choices, selected) {
    return `<div id="${id}" class="memory-filter-menu" popover="auto" role="menu">${choices.map((choice) => {
      if (choice.disabled) {
        return `<button class="is-empty" type="button" role="menuitem" disabled><span>${escapeHtml(choice.label)}</span></button>`;
      }
      const active = choice.value === selected;
      return `<button class="${active ? 'is-selected' : ''}" type="button" role="menuitem" data-action="memory:${action}" data-value="${escapeAttribute(choice.value)}"><span>${escapeHtml(choice.label)}</span>${active ? '<i aria-hidden="true">●</i>' : ''}</button>`;
    }).join('')}</div>`;
  }

  function libraryControls() {
    const facets = runtime.facets[runtime.libraryTab] || { models: [], windows: [], tags: [], times: [] };
    const kinds = availableFilterKinds();
    const kind = kinds.includes(runtime.filters.filterKind) ? runtime.filters.filterKind : 'tag';
    const config = MEMORY_FILTER_KINDS[kind];
    const selectedValue = runtime.filters[config.stateKey] || '';
    const kindChoices = kinds.map((value) => ({ value, label: MEMORY_FILTER_KINDS[value].label }));
    const values = filterValues(kind, facets);
    const valueChoices = [
      { value: '', label: config.allLabel },
      ...(values.length
        ? values.map((value) => ({ value, label: filterDisplayValue(kind, value) }))
        : config.emptyLabel
          ? [{ value: '', label: config.emptyLabel, disabled: true }]
          : []),
    ];
    const filters = runtime.libraryTab === 'memory' || runtime.libraryTab === 'seed'
      ? `<section class="memory-retrieval-card" aria-label="检索">
        <div class="memory-retrieval-heading"><strong>检索</strong><small>搜索与筛选放在同一处</small></div>
        <form class="memory-search-form" data-submit="memory:search">
          <label class="memory-search-field"><span>搜索</span><input name="query" type="search" value="${escapeAttribute(runtime.filters.query)}" placeholder="搜索标题、核心、使用时机或勿误用"></label>
        </form>
        <div class="memory-filter-bubbles" aria-label="筛选">
          <button class="memory-filter-chip memory-filter-kind" type="button" popovertarget="memoryFilterKindMenu" aria-haspopup="menu"><span>${escapeHtml(config.label)}</span><span class="chip-chevron" aria-hidden="true"></span></button>
          <button class="memory-filter-chip memory-filter-value" type="button" popovertarget="memoryFilterValueMenu" aria-haspopup="menu"><span>${escapeHtml(filterDisplayValue(kind, selectedValue))}</span><span class="chip-chevron" aria-hidden="true"></span></button>
        </div>
        ${filterMenu('memoryFilterKindMenu', 'filter-kind', kindChoices, kind)}
        ${filterMenu('memoryFilterValueMenu', 'filter-value', valueChoices, selectedValue)}
      </section>`
      : '';
    return `<div class="memory-tabs memory-tabs-five" role="tablist" aria-label="记忆入口">
      <button class="${runtime.libraryTab === 'memory' ? 'is-active' : ''}" type="button" data-action="memory:tab" data-scope="memory">记忆库</button>
      <button class="${runtime.libraryTab === 'seed' ? 'is-active' : ''}" type="button" data-action="memory:tab" data-scope="seed">种子库</button>
      <button type="button" data-action="desk:worldbook">世界书</button>
      <button type="button" data-action="memory:global-excerpt">全局摘录</button>
      <button class="${runtime.libraryTab === 'custom' ? 'is-active' : ''}" type="button" data-action="memory:tab" data-scope="custom">自定义指令</button>
    </div>${filters}`;
  }

  function memoryView() {
    if (runtime.libraryTab === 'custom') {
      return {
        title: '记忆',
        subtitle: '自定义指令 · 独立的单份 active 文档',
        className: 'memory-library',
        body: `${libraryControls()}${customInstructionsBody(runtime.customInstructions)}`,
      };
    }
    const entryType = runtime.libraryTab === 'seed' ? 'seed' : 'memory';
    const entries = (runtime.entries[entryType] || [])
      .filter((entry) => !['stone', 'archived', 'discarded'].includes(entry.status));
    const isSeed = entryType === 'seed';
    return {
      title: '记忆',
      subtitle: isSeed
        ? '种子库 · 未完成但有生长性的意象，不是已确认事实'
        : '记忆库 · 已经确认的长期纸条',
      className: 'memory-library',
      headerAction: '<button class="feature-head-action" type="button" data-action="memory:entry-new">新增</button>',
      body: `${libraryControls()}<section class="feature-group"><div class="feature-card">
        <button class="feature-row" type="button" data-action="memory:pockets"><span><strong>待确认区 · ${currentPockets().length}</strong><small>只有确认后才会进入记忆库或种子库。</small></span><span>›</span></button>
      </div></section>${entryGroup(isSeed ? '种子库' : '记忆库', entries, isSeed ? '这里还没有种子。' : '这里还没有长期记忆。')}`,
    };
  }

  function findEntry(id) {
    return Object.values(runtime.entries).flat().find((entry) => entry.id === id) || null;
  }

  function entryEditView({ id = '', scope = runtime.libraryTab } = {}) {
    const entry = id ? findEntry(id) : null;
    const entryType = entry?.entry_type || (scope === 'seed' ? 'seed' : 'memory');
    const sourceWindow = entry?.source_window || chat.getCurrentConversation?.()?.title || currentId();
    const sourceTime = entry?.source_date || new Date().toISOString().slice(0, 10);
    return {
      title: `${entry ? '编辑' : '新增'}${entryType === 'seed' ? '种子' : '记忆'}`,
      subtitle: entryType === 'seed' ? '可生长方向，不是已确认事实' : '已确认的长期纸条',
      className: 'memory-entry-edit',
      body: `<form class="form-stack" data-submit="memory:entry-save" data-id="${escapeAttribute(entry?.id || '')}" data-entry-type="${entryType}">
        <label>标题<input name="title" maxlength="120" value="${escapeAttribute(entry?.title || '')}" required></label>
        <label>核心<textarea name="life_core" rows="6" required>${escapeHtml(entry?.life_core || '')}</textarea></label>
        <label>使用时机<textarea name="usage_hint" rows="4">${escapeHtml(entry?.usage_hint || '')}</textarea></label>
        <label>勿误用<textarea name="avoid_hint" rows="4">${escapeHtml(entry?.avoid_hint || '')}</textarea></label>
        <div class="form-grid memory-index-fields">
          <label>模型<input name="source_model" maxlength="120" value="${escapeAttribute(entry?.source_model || '手动整理')}" required></label>
          <label>窗口<input name="source_window" maxlength="180" value="${escapeAttribute(sourceWindow)}" required></label>
          <label>标签<select name="tag" required>${tagOptions(entry?.tag || '')}</select></label>
          <label>时间<input name="source_time" type="date" value="${escapeAttribute(sourceTime)}" required></label>
        </div>
        <button class="primary-wide" type="submit">保存</button>
      </form>`,
    };
  }

  function vectorStatusView() {
    const status = runtime.vectorStatus || {};
    const dimensions = status.detected_dimensions == null ? '尚未探测成功' : String(status.detected_dimensions);
    return {
      title: '向量状态',
      subtitle: status.index_ready ? '语义检索已连接' : 'D1 正常 · 语义检索未连接',
      className: 'memory-vector-status',
      body: `<section class="feature-group"><div class="feature-card">
        <div class="feature-row static"><span><strong>Workers AI</strong><small>${status.ai_binding ? '已绑定' : '未绑定'}</small></span></div>
        <div class="feature-row static"><span><strong>Embedding 模型</strong><small>${escapeHtml(status.embedding_model || '@cf/baai/bge-m3')}</small></span></div>
        <div class="feature-row static"><span><strong>实际 dimensions</strong><small>${escapeHtml(dimensions)}</small></span></div>
        <div class="feature-row static"><span><strong>Vectorize</strong><small>${status.index_ready ? 'ready' : '未连接'}</small></span></div>
        <div class="feature-row static"><span><strong>索引 / binding</strong><small>${escapeHtml(status.index_name || 'elementera-coast-memory-v1')} · ${escapeHtml(status.binding_name || 'COAST_MEMORY_VECTOR')}</small></span></div>
        <div class="feature-row static"><span><strong>索引队列</strong><small>pending ${Number(status.pending_count || 0)} · ready ${Number(status.ready_count || 0)} · error ${Number(status.error_count || 0)}</small></span></div>
      </div></section>
      ${status.probe_error ? `<p class="feature-note">维度探测失败：${escapeHtml(status.probe_error)}</p>` : ''}
      <div class="button-row"><button type="button" data-action="memory:vector-refresh">重新检查</button></div>`,
    };
  }

  return Object.freeze({ entryCard, entryGroup, filterMenu, libraryControls, memoryView, entryEditView, vectorStatusView });
}
