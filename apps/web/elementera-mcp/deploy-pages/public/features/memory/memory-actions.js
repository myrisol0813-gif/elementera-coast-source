import { q } from '../../core/dom.js';
import { MEMORY_FILTER_KINDS, MEMORY_TAGS } from './memory-constants.js';
import {
  createEntryRequest,
  discardGlobalExcerptCandidateRequest,
  deleteEntryRequest,
  patchEntryRequest,
  resolvePocketRequest,
  resolveGlobalExcerptCandidateRequest,
  saveCustomInstructionsRequest,
  saveSoilRequest,
  setGlobalExcerptWriteEnabledRequest,
} from './memory-client.js';
import {
  availableFilterKinds,
  filterValues,
  resetDimensionFilters,
} from './memory-library-view.js';
import { parsePocketCandidateLines, parseSeedLines } from './memory-soil-view.js';

export function createMemoryActions({
  runtime,
  router,
  toast,
  chat,
  currentId,
  maxHandSeeds,
  currentSoil,
  currentPockets,
  fetchSoil,
  fetchPockets,
  fetchEntries,
  fetchCustomInstructions,
  fetchGlobalExcerpt,
  fetchVectorStatus,
}) {
  async function openSoil({ conversation_id: conversationId = '' } = {}) {
    const id = conversationId || currentId();
    if (!id) return;
    await Promise.all([fetchSoil(id), fetchPockets(id)]);
    return router.open('thought-soil', { conversation_id: id });
  }

  async function openPockets() {
    await fetchPockets(currentId());
    return router.open('memory-pockets', { conversation_id: currentId() });
  }

  async function openLibrary(scope = runtime.libraryTab) {
    runtime.libraryTab = ['memory', 'seed', 'custom'].includes(scope) ? scope : 'memory';
    if (runtime.libraryTab === 'custom') {
      await fetchCustomInstructions();
    } else {
      await Promise.all([fetchPockets(currentId()), fetchEntries(runtime.libraryTab)]);
    }
    return router.open('memory');
  }

  async function showVectorStatus() {
    await fetchVectorStatus();
    return router.open('memory-vector-status');
  }

  async function clearSoil() {
    const data = await saveSoilRequest(currentId(), {
      current_text: '', hand_seeds: [], do_not_repeat: '', pocket_candidates: [], manual_locked: true,
    });
    runtime.soils.set(currentId(), data.soil);
    chat.renderMessages();
    return true;
  }

  async function resolveCurrentPocket(id, action, tag = '') {
    const pocket = currentPockets().find((item) => item.id === id);
    if (!pocket) return;
    if (['memory', 'seed'].includes(action) && !MEMORY_TAGS.includes(tag)) {
      throw new Error('请先为这张纸条选择六签之一。');
    }
    await resolvePocketRequest(id, {
      action,
      title: pocket.title || pocket.suggested_title,
      life_core: pocket.life_core || pocket.suggested_life_core || pocket.source_text,
      content: pocket.content || pocket.source_text,
      usage_hint: pocket.usage_hint || pocket.suggested_usage_hint,
      avoid_hint: pocket.avoid_hint || pocket.suggested_avoid_hint,
      source_refs: pocket.source_refs,
      source_excerpt: pocket.source_excerpt,
      source_model: pocket.generated_by_model || pocket.model_label || '',
      source_window: pocket.revision?.source_window || pocket.source_ref?.source_window || pocket.conversation_id || currentId(),
      source_time: pocket.created_at || new Date().toISOString(),
      ...(tag ? { tag, memory_tags: [tag] } : {}),
    });
    runtime.pockets.set(currentId(), currentPockets().filter((item) => item.id !== id));
    if (['memory', 'seed'].includes(action)) await fetchEntries(action);
    await router.refresh();
    toast(action === 'discard'
      ? '已经丢弃。'
      : action === 'seed'
        ? '已经写入种子库。'
        : '已经写入记忆库。');
  }

  async function handleAction(name, target) {
    if (name === 'open') {
      return openLibrary(target.dataset.scope || runtime.libraryTab);
    }
    if (name === 'soil-open') return openSoil({
      conversation_id: target.dataset.conversationId || '',
    });
    if (name === 'done') return router.back();
    if (name === 'soil-edit') return router.open('thought-soil-edit');
    if (name === 'pockets') return openPockets();
    if (name === 'soil-clear') {
      if (!await clearSoil()) return;
      return router.refresh();
    }
    if (name === 'soil-auto') {
      const data = await saveSoilRequest(currentId(), { manual_locked: false, auto_refresh_enabled: true });
      runtime.soils.set(currentId(), data.soil);
      chat.renderMessages();
      return router.refresh();
    }
    if (name === 'pocket-resolve') {
      const tag = q('[data-memory-tag]', target.closest('[data-pocket-id]'))?.value || '';
      return resolveCurrentPocket(target.dataset.id, target.dataset.destination, tag);
    }
    if (name === 'pocket-discard') return resolveCurrentPocket(target.dataset.id, 'discard');
    if (name === 'tab') {
      runtime.libraryTab = ['memory', 'seed', 'custom'].includes(target.dataset.scope)
        ? target.dataset.scope
        : 'memory';
      if (runtime.libraryTab === 'custom') await fetchCustomInstructions();
      else await Promise.all([fetchEntries(runtime.libraryTab), fetchPockets(currentId())]);
      return router.refresh({ preserveScroll: false });
    }
    if (name === 'filter-kind') {
      const kind = target.dataset.value;
      if (!availableFilterKinds().includes(kind)) return;
      runtime.filters.filterKind = kind;
      resetDimensionFilters(runtime);
      await fetchEntries(runtime.libraryTab);
      return router.refresh({ preserveScroll: false });
    }
    if (name === 'filter-value') {
      const kind = runtime.filters.filterKind;
      const config = MEMORY_FILTER_KINDS[kind] || MEMORY_FILTER_KINDS.tag;
      const value = target.dataset.value || '';
      if (value && !filterValues(kind, runtime.facets[runtime.libraryTab]).includes(value)) return;
      resetDimensionFilters(runtime);
      runtime.filters[config.stateKey] = value;
      await fetchEntries(runtime.libraryTab);
      return router.refresh({ preserveScroll: false });
    }
    if (name === 'entry-new') return router.open('memory-entry-edit', { scope: runtime.libraryTab });
    if (name === 'global-excerpt') {
      await fetchGlobalExcerpt();
      return router.open('global-excerpt');
    }
    if (name === 'global-excerpt-toggle') {
      await setGlobalExcerptWriteEnabledRequest(target.dataset.value === 'true');
      await fetchGlobalExcerpt();
      await router.refresh();
      toast(target.dataset.value === 'true' ? '全局摘录写入已开启。' : '全局摘录现在只读。');
      return;
    }
    if (name === 'global-excerpt-confirm') {
      await resolveGlobalExcerptCandidateRequest(target.dataset.id, { action: 'confirm', operator: 'user' });
      await fetchGlobalExcerpt();
      await router.refresh({ preserveScroll: true });
      toast('全局摘录已确认更新。');
      return;
    }
    if (name === 'global-excerpt-discard') {
      await discardGlobalExcerptCandidateRequest(target.dataset.id);
      await fetchGlobalExcerpt();
      await router.refresh({ preserveScroll: true });
      toast('这条候选已经消失，正式正文没有改变。');
      return;
    }
    if (name === 'global-excerpt-edit') return router.open('global-excerpt-edit', { id: target.dataset.id });
    if (name === 'vector-status') return showVectorStatus();
    if (name === 'vector-refresh') {
      await fetchVectorStatus();
      return router.refresh();
    }
    if (name === 'entry-edit') return router.open('memory-entry-edit', { id: target.dataset.id, scope: runtime.libraryTab });
    if (name === 'entry-delete') {
      await deleteEntryRequest(target.dataset.id);
      await fetchEntries(runtime.libraryTab);
      return router.refresh();
    }
  }

  async function handleSubmit(name, form) {
    const field = (fieldName) => q(`[name="${fieldName}"]`, form)?.value || '';
    if (name === 'search') {
      runtime.filters.query = field('query').trim();
      await fetchEntries(runtime.libraryTab);
      return router.refresh({ preserveScroll: false });
    }
    if (name === 'global-excerpt-edit-confirm') {
      const id = form.dataset.id;
      await resolveGlobalExcerptCandidateRequest(id, { action: 'confirm', edited_body: field('body'), operator: 'user' });
      await fetchGlobalExcerpt();
      await router.back();
      await router.refresh({ preserveScroll: true });
      toast('编辑后的全局摘录已确认。');
      return;
    }
    if (name === 'entry-save') {
      const id = form.dataset.id;
      const entryType = form.dataset.entryType === 'seed' ? 'seed' : 'memory';
      const payload = {
        entry_type: entryType,
        scope: 'global',
        conversation_id: null,
        title: field('title'),
        life_core: field('life_core'),
        usage_hint: field('usage_hint'),
        avoid_hint: field('avoid_hint'),
        status: entryType === 'seed' ? 'dormant' : 'active',
        source_model: field('source_model'),
        source_window: field('source_window'),
        source_time: field('source_time'),
        tag: field('tag'),
        memory_tags: [field('tag')],
      };
      if (id) await patchEntryRequest(id, payload);
      else await createEntryRequest(payload);
      runtime.libraryTab = entryType;
      await fetchEntries(entryType);
      await router.back();
      toast(entryType === 'seed' ? '种子已保存。' : '记忆已保存。');
      return;
    }
    if (name === 'custom-instructions-save') {
      const data = await saveCustomInstructionsRequest({
        content: field('content'), updated_by: 'xiaohan', source: '屋主手动编辑',
      });
      runtime.customInstructions = data.instructions;
      await router.refresh({ preserveScroll: true });
      toast('自定义指令已保存。');
      return;
    }
    if (name !== 'soil-save') return;
    const data = await saveSoilRequest(currentId(), {
      current_text: field('current_text'),
      hand_seeds: parseSeedLines(field('hand_seeds'), maxHandSeeds()),
      do_not_repeat: field('do_not_repeat'),
      pocket_candidates: parsePocketCandidateLines(field('pocket_candidates'), currentSoil().pocket_candidates),
      manual_locked: true,
    });
    runtime.soils.set(currentId(), data.soil);
    chat.renderMessages();
    await router.back();
    toast('整理当前对话的纸条已保存。');
  }

  return Object.freeze({
    openSoil,
    openPockets,
    openLibrary,
    showVectorStatus,
    clearSoil,
    resolveCurrentPocket,
    handleAction,
    handleSubmit,
  });
}
