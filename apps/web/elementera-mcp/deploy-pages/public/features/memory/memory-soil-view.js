import { escapeAttribute, escapeHtml } from '../../core/dom.js';
import { memoryDate, section, shortModelName, textBlock, tokenSuffix } from './memory-format.js';

export function emptySoil(conversationId) {
  return {
    conversation_id: conversationId,
    current_text: '',
    afterthoughts: [],
    memory_candidates: [],
    seed_candidates: [],
    manual_locked: false,
    auto_refresh_enabled: true,
    revision: 1,
  };
}

export function afterthoughtLines(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n');
}

export function parseAfterthoughtLines(value, limit = 7) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, Math.max(1, Number(limit) || 7));
}

export function soilCandidate(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    return { title: text, content: text, source_refs: [], source_excerpt: '' };
  }
  return {
    title: String(value?.title || value?.content || '').trim(),
    content: String(value?.content || value?.title || '').trim(),
    source_refs: Array.isArray(value?.source_refs) ? value.source_refs : [],
    source_excerpt: String(value?.source_excerpt || '').trim(),
  };
}

export function soilCandidateLines(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((item) => soilCandidate(item))
    .filter((item) => item.title || item.content)
    .map((item) => item.title && item.content && item.title !== item.content
      ? `${item.title}｜${item.content}`
      : item.content || item.title)
    .join('\n');
}

export function parseSoilCandidateLines(value, existing = [], limit = 7) {
  const available = (Array.isArray(existing) ? existing : [])
    .map((item) => ({ item, candidate: soilCandidate(item), used: false }));
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, Math.max(1, Number(limit) || 7))
    .map((line) => {
      const [rawTitle = '', ...rest] = line.split(/[｜|]/);
      const title = rawTitle.trim();
      const content = rest.join('｜').trim() || title;
      const match = available.find((entry) => !entry.used
        && entry.candidate.title === title
        && entry.candidate.content === content);
      if (match) {
        match.used = true;
        return match.item;
      }
      return {
        title,
        content,
        source_refs: [],
        source_excerpt: '',
      };
    });
}

function candidateBlock(items, emptyText) {
  const candidates = (Array.isArray(items) ? items : []).map(soilCandidate).filter((item) => item.title || item.content);
  if (!candidates.length) return `<p>${escapeHtml(emptyText)}</p>`;
  return candidates.map((candidate) => `<div class="feature-row static"><span>
    <strong>${escapeHtml(candidate.title || candidate.content)}</strong>
    <small>${escapeHtml(candidate.content)}${candidate.source_excerpt ? `<br>来源：${escapeHtml(candidate.source_excerpt)}` : ''}</small>
  </span></div>`).join('');
}

export function createSoilViews({ runtime, currentId, maxAfterthoughts, currentSoil }) {
  function renderSoilEntry(conversationId) {
    const soil = runtime.soils.get(conversationId) || emptySoil(conversationId);
    const afterthoughts = Array.isArray(soil.afterthoughts) ? soil.afterthoughts : [];
    const state = soil.auto_refresh_enabled === false ? ' · 已关闭' : soil.manual_locked ? ' · 已锁定' : '';
    return `<div class="thought-soil-row"><button class="thought-soil-entry" type="button" data-action="memory:soil-open" data-scope="conversation" data-conversation-id="${escapeAttribute(conversationId)}">整理当前对话的纸条 · ${afterthoughts.length} 条余思${state} <span aria-hidden="true">›</span></button></div>`;
  }

  function soilProvenance(soil) {
    const revisionValue = Number(soil.revision);
    const revision = Number.isFinite(revisionValue) ? Math.max(1, Math.trunc(revisionValue)) : 1;
    const organizer = soil.display_author
      || shortModelName(soil.organized_by_model)
      || '尚未整理';
    const updatedAt = memoryDate(soil.updated_at || soil.organized_at);
    return `<p class="feature-note generation-provenance">revision ${revision} · 整理来源 · ${escapeHtml(organizer)}${escapeHtml(tokenSuffix(soil.organize_usage))}${updatedAt ? ` · ${escapeHtml(updatedAt)}` : ''}</p>`;
  }

  function soilBody(soil, {
    scope = 'conversation',
    sourceSurface = '',
    pendingPockets = [],
  } = {}) {
    const afterthoughts = (Array.isArray(soil.afterthoughts) ? soil.afterthoughts : [])
      .slice(0, maxAfterthoughts());
    const afterthoughtBody = afterthoughts.length
      ? afterthoughts.map((item) => `<div class="feature-row static"><span><small>${escapeHtml(item)}</small></span></div>`).join('')
      : '<p>这一刻没有想留下的余思。</p>';
    const memoryCandidates = Array.isArray(soil.memory_candidates) ? soil.memory_candidates : [];
    const seedCandidates = Array.isArray(soil.seed_candidates) ? soil.seed_candidates : [];
    const destinationBody = `
      <div class="feature-kicker">记忆候选 · ${memoryCandidates.length}</div>
      ${candidateBlock(memoryCandidates, '没有想递往记忆库的内容。')}
      <div class="feature-kicker">种子候选 · ${seedCandidates.length}</div>
      ${candidateBlock(seedCandidates, '没有想递往种子库的内容。')}
      ${memoryCandidates.length || seedCandidates.length ? '<p class="feature-note">这些只是模型建议的去处，已送入待确认区；确认前不会参与召回。</p>' : ''}
    `;
    const pocketEntry = pendingPockets.length || memoryCandidates.length || seedCandidates.length
      ? `<section class="feature-group"><div class="feature-card">
        <button class="feature-row" type="button" data-action="memory:pockets" data-scope="${escapeAttribute(scope)}"${sourceSurface ? ` data-source-surface="${escapeAttribute(sourceSurface)}"` : ''}><span><strong>待确认区 · ${pendingPockets.length}</strong><small>模型给出的去处只是建议，你仍可以改投另一边或丢弃。</small></span><span>›</span></button>
      </div></section>`
      : '';
    const enabled = soil.auto_refresh_enabled !== false;
    const switchCard = scope === 'conversation'
      ? `<section class="feature-group"><div class="feature-card">
        <button class="feature-row" type="button" data-action="memory:soil-toggle" data-value="${enabled ? 'false' : 'true'}"><span><strong>${enabled ? '整理当前对话的纸条已开启' : '整理当前对话的纸条已关闭'}</strong><small>${enabled ? (soil.manual_locked ? '当前为手动锁定：不会自动覆盖，但仍会递入模型上下文。' : '每轮回复后自动整理，并把“当前 / 余思”递入下一轮。') : '停止自动整理，也不递入模型上下文；已有内容会原样保留。'}</small></span><span>${enabled ? '关闭' : '开启'}</span></button>
      </div></section>`
      : '';
    const controls = scope === 'conversation'
      ? `<div class="button-row">
        <button type="button" data-action="memory:soil-edit">编辑</button>
        <button type="button" data-action="memory:soil-clear">清空</button>
        ${enabled && soil.manual_locked ? '<button type="button" data-action="memory:soil-auto">解除手动锁定</button>' : ''}
      </div>`
      : '';
    return `${switchCard}
      ${section('当前', textBlock(soil.current_text, '现在没有需要越过最近上下文继续承接的内容。'))}
      ${section(`余思 · ${afterthoughts.length}`, afterthoughtBody)}
      ${section('去处', destinationBody)}
      ${pocketEntry}
      ${soilProvenance(soil)}
      ${controls}`;
  }

  function soilView({ conversation_id: conversationId = '' } = {}) {
    const id = conversationId || currentId();
    const soil = runtime.soils.get(id) || emptySoil(id);
    const pockets = runtime.pockets.get(id) || [];
    return {
      title: '整理当前对话的纸条',
      subtitle: soil.auto_refresh_enabled === false
        ? '已关闭 · 不整理，也不递入模型上下文'
        : soil.manual_locked
          ? '手动内容已锁定 · 当前与余思仍会递入模型上下文'
          : '当前 · 余思 · 去处',
      className: 'memory-soil',
      headerAction: '<button class="feature-head-action" type="button" data-action="memory:done">完成</button>',
      body: soilBody(soil, { scope: 'conversation', pendingPockets: pockets }),
    };
  }

  function soilEditView() {
    const soil = currentSoil();
    return {
      title: '编辑整理当前对话的纸条',
      subtitle: '保存后停止自动覆盖',
      className: 'memory-soil-edit',
      body: `<form class="form-stack" data-submit="memory:soil-save">
        <label>当前<textarea name="current_text" rows="5">${escapeHtml(soil.current_text || '')}</textarea></label>
        <label>余思<textarea name="afterthoughts" rows="6" placeholder="每行一条；可以留空">${escapeHtml(afterthoughtLines(soil.afterthoughts))}</textarea></label>
        <label>记忆候选<textarea name="memory_candidates" rows="6" placeholder="每行：名称｜内容">${escapeHtml(soilCandidateLines(soil.memory_candidates))}</textarea></label>
        <label>种子候选<textarea name="seed_candidates" rows="6" placeholder="每行：名称｜内容">${escapeHtml(soilCandidateLines(soil.seed_candidates))}</textarea></label>
        <button class="primary-wide" type="submit">保存</button>
      </form>`,
    };
  }

  return Object.freeze({ renderSoilEntry, soilView, soilEditView });
}
