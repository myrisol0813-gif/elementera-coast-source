import { escapeAttribute, escapeHtml } from '../../core/dom.js';
import { memoryDate, section, shortModelName, textBlock, tokenSuffix } from './memory-format.js';

export function emptySoil(conversationId) {
  return {
    conversation_id: conversationId,
    current_text: '',
    hand_seeds: [],
    do_not_repeat: '',
    pocket_candidates: [],
    manual_locked: false,
    auto_refresh_enabled: true,
    revision: 1,
  };
}

export function seedLines(seeds) {
  return (Array.isArray(seeds) ? seeds : []).map((seed) => [
    seed.name || '',
    seed.life_core || '',
    seed.usage_hint || '',
    seed.avoid_hint || '',
  ].join('｜')).join('\n');
}

export function parseSeedLines(value, limit) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, limit).map((line) => {
    const [name = '', lifeCore = '', usageHint = '', avoidHint = ''] = line.split(/[｜|]/).map((part) => part.trim());
    return {
      name: name || lifeCore,
      life_core: lifeCore || name,
      usage_hint: usageHint,
      avoid_hint: avoidHint,
    };
  });
}

export function pocketCandidate(value) {
  if (typeof value === 'string') {
    return { title: value, life_core: value, content: value, usage_hint: '', avoid_hint: '', source_refs: [], source_excerpt: '' };
  }
  return {
    title: value?.title || value?.life_core || value?.content || '',
    life_core: value?.life_core || value?.title || '',
    content: value?.content || value?.life_core || '',
    usage_hint: value?.usage_hint || '',
    avoid_hint: value?.avoid_hint || '',
    source_refs: Array.isArray(value?.source_refs) ? value.source_refs : [],
    source_excerpt: value?.source_excerpt || '',
  };
}

export function pocketCandidateLines(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((item) => pocketCandidate(item).life_core || pocketCandidate(item).title)
    .filter(Boolean)
    .join('\n');
}

export function parsePocketCandidateLines(value, existing) {
  const available = (Array.isArray(existing) ? existing : []).map((item) => ({ item, candidate: pocketCandidate(item), used: false }));
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = available.find((entry) => !entry.used && (entry.candidate.life_core === line || entry.candidate.title === line));
    if (!match) return line;
    match.used = true;
    return match.item;
  });
}

export function createSoilViews({ runtime, currentId, maxHandSeeds, currentSoil }) {
  function renderSoilEntry(conversationId) {
    const soil = runtime.soils.get(conversationId) || emptySoil(conversationId);
    const handSeeds = Array.isArray(soil.hand_seeds) ? soil.hand_seeds : [];
    const locked = soil.manual_locked ? ' · 已锁定' : '';
    return `<div class="thought-soil-row"><button class="thought-soil-entry" type="button" data-action="memory:soil-open" data-scope="conversation" data-conversation-id="${escapeAttribute(conversationId)}">整理当前对话的纸条 · ${Math.min(handSeeds.length, maxHandSeeds())} 粒当前活跃线索${locked} <span aria-hidden="true">›</span></button></div>`;
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
    const limit = maxHandSeeds();
    const activeSeeds = (Array.isArray(soil.hand_seeds) ? soil.hand_seeds : []).slice(0, limit);
    const pocketCandidates = Array.isArray(soil.pocket_candidates) ? soil.pocket_candidates : [];
    const seeds = activeSeeds.length
      ? activeSeeds.map((seed) => `<div class="feature-row static"><span><strong>${escapeHtml(seed.name || seed.life_core)}</strong><small>${escapeHtml(seed.life_core || '')}${seed.usage_hint ? `<br>使用：${escapeHtml(seed.usage_hint)}` : ''}${seed.avoid_hint ? `<br>避免：${escapeHtml(seed.avoid_hint)}` : ''}</small></span></div>`).join('')
      : '<p>还没有当前活跃线索。</p>';
    const candidates = pocketCandidates.length
      ? `${pocketCandidates.map((item) => {
        const candidate = pocketCandidate(item);
        return `<div class="feature-row static"><span><strong>${escapeHtml(candidate.title || '可落袋内容')}</strong><small>${escapeHtml(candidate.life_core)}${candidate.source_excerpt ? `<br>来源：${escapeHtml(candidate.source_excerpt)}` : ''}</small></span></div>`;
      }).join('')}<p class="feature-note">这些内容已先放进待确认区。确认前不会参与召回。</p>`
      : '<p>还没有可落袋内容。</p>';
    const pocketEntry = pendingPockets.length || pocketCandidates.length
      ? `<section class="feature-group"><div class="feature-card">
        <button class="feature-row" type="button" data-action="memory:pockets" data-scope="${escapeAttribute(scope)}"${sourceSurface ? ` data-source-surface="${escapeAttribute(sourceSurface)}"` : ''}><span><strong>待确认区 · ${pendingPockets.length}</strong><small>候选会停在这里；确认前不会参与召回。</small></span><span>›</span></button>
      </div></section>`
      : '';
    const controls = scope === 'conversation'
      ? `<div class="button-row">
        <button type="button" data-action="memory:soil-edit">编辑</button>
        <button type="button" data-action="memory:soil-clear">清空</button>
        ${soil.manual_locked ? '<button type="button" data-action="memory:soil-auto">恢复自动整理</button>' : ''}
      </div>`
      : '';
    return `${section('当前', textBlock(soil.current_text, '还没有整理当前方向。'))}
      ${section(`当前活跃线索 · ${activeSeeds.length}/${limit}`, seeds)}
      ${section('勿复读', textBlock(soil.do_not_repeat))}
      ${section('可落袋', candidates)}
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
      subtitle: soil.manual_locked ? '手动内容已锁定' : '当前窗口的滚动工作上下文',
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
        <label>当前<textarea name="current_text" rows="4">${escapeHtml(soil.current_text)}</textarea></label>
        <label>当前活跃线索<textarea name="hand_seeds" rows="8" placeholder="每行：名称｜生命核｜使用提示｜避免提示">${escapeHtml(seedLines(soil.hand_seeds))}</textarea></label>
        <label>勿复读<textarea name="do_not_repeat" rows="4">${escapeHtml(soil.do_not_repeat)}</textarea></label>
        <label>可落袋<textarea name="pocket_candidates" rows="5" placeholder="每行一项">${escapeHtml(pocketCandidateLines(soil.pocket_candidates))}</textarea></label>
        <button class="primary-wide" type="submit">保存</button>
      </form>`,
    };
  }

  return Object.freeze({ renderSoilEntry, soilView, soilEditView });
}
