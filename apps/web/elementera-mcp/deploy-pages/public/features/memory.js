import { MEMORY_FILTER_KINDS, MEMORY_ROUTES } from './memory/memory-constants.js';
import {
  fetchCustomInstructionsRequest,
  fetchGlobalExcerptRequest,
  fetchEntriesRequest,
  fetchPocketsRequest,
  fetchSoilRequest,
  fetchVectorStatusRequest,
  organizeSoilRequest,
} from './memory/memory-client.js';
import { createMemoryActions } from './memory/memory-actions.js';
import { createLibraryViews, normalizeFilterState } from './memory/memory-library-view.js';
import { createGlobalExcerptViews } from './memory/memory-global-excerpt-view.js';
import { createPocketViews } from './memory/memory-pocket-view.js';
import { createSoilViews, emptySoil } from './memory/memory-soil-view.js';

export function createMemory({ chat, router, toast, storage }) {
  const runtime = {
    soils: new Map(),
    pockets: new Map(),
    entries: { memory: [], seed: [] },
    libraryTab: 'memory',
    filters: { query: '', filterKind: 'tag', sourceModel: '', sourceWindow: '', tag: '', sourceTime: '' },
    facets: {
      memory: { models: [], windows: [], tags: [], times: [] },
      seed: { models: [], windows: [], tags: [], times: [] },
    },
    customInstructions: null,
    globalExcerpt: null,
    vectorStatus: null,
    soilChains: new Map(),
  };
  let root = null;

  function ownsRoute(route) {
    return MEMORY_ROUTES.has(route?.name || '');
  }

  function syncRoot(route) {
    root ||= globalThis.document?.querySelector?.('#overlayRoot') || null;
    if (!root) return;
    if (ownsRoute(route)) root.dataset.controllerOwner = 'memory';
    else if (root.dataset.controllerOwner === 'memory') delete root.dataset.controllerOwner;
  }

  function currentId() {
    return chat.getCurrentConversationId();
  }

  function settings() {
    return storage.read().runControl;
  }

  function maxHandSeeds() {
    const value = Number(settings().maxHandSeeds);
    return Number.isFinite(value) ? Math.min(7, Math.max(1, Math.trunc(value))) : 7;
  }

  function currentSoil() {
    const conversationId = currentId();
    return runtime.soils.get(conversationId) || emptySoil(conversationId);
  }

  function currentPockets() {
    return runtime.pockets.get(currentId()) || [];
  }

  async function fetchSoil(conversationId) {
    const data = await fetchSoilRequest(conversationId);
    const soil = data.soil || emptySoil(conversationId);
    runtime.soils.set(conversationId, soil);
    return soil;
  }

  async function fetchPockets(conversationId) {
    const data = await fetchPocketsRequest(conversationId);
    const pockets = Array.isArray(data.pockets) ? data.pockets : [];
    runtime.pockets.set(conversationId, pockets);
    return pockets;
  }

  async function fetchEntries(entryType = runtime.libraryTab) {
    const tab = entryType === 'seed' ? 'seed' : 'memory';
    const requestEntries = async () => {
      const params = new URLSearchParams({ entry_type: tab, library: '1', limit: '100' });
      if (runtime.filters.query) params.set('q', runtime.filters.query);
      const config = MEMORY_FILTER_KINDS[runtime.filters.filterKind] || MEMORY_FILTER_KINDS.tag;
      const activeValue = runtime.filters[config.stateKey];
      if (activeValue) params.set(config.param, activeValue);
      return fetchEntriesRequest(params);
    };
    let data = await requestEntries();
    runtime.entries[tab] = Array.isArray(data.entries) ? data.entries : [];
    runtime.facets[tab] = data.facets || { models: [], windows: [], tags: [], times: [] };
    if (normalizeFilterState(runtime, runtime.facets[tab])) {
      data = await requestEntries();
      runtime.entries[tab] = Array.isArray(data.entries) ? data.entries : [];
      runtime.facets[tab] = data.facets || { models: [], windows: [], tags: [], times: [] };
    }
    return runtime.entries[tab];
  }

  async function fetchCustomInstructions() {
    const data = await fetchCustomInstructionsRequest();
    runtime.customInstructions = data.instructions || null;
    return runtime.customInstructions;
  }

  async function fetchGlobalExcerpt() {
    runtime.globalExcerpt = await fetchGlobalExcerptRequest();
    return runtime.globalExcerpt;
  }

  async function fetchVectorStatus() {
    runtime.vectorStatus = await fetchVectorStatusRequest();
    return runtime.vectorStatus;
  }

  async function onConversationChanged(conversationId) {
    if (!conversationId) return;
    try {
      await Promise.all([fetchSoil(conversationId), fetchPockets(conversationId)]);
      if (currentId() === conversationId) chat.renderMessages();
    } catch (error) {
      console.warn('[memory:load]', error);
    }
  }

  const soilViews = createSoilViews({ runtime, currentId, maxHandSeeds, currentSoil });
  const pocketViews = createPocketViews({ currentPockets });
  const libraryViews = createLibraryViews({ runtime, currentId, currentPockets, chat });
  const globalExcerptViews = createGlobalExcerptViews({ runtime });

  router.register('thought-soil', soilViews.soilView);
  router.register('thought-soil-edit', soilViews.soilEditView);
  router.register('memory-pockets', pocketViews.pocketsView);
  router.register('memory', libraryViews.memoryView);
  router.register('memory-entry-edit', libraryViews.entryEditView);
  router.register('memory-vector-status', libraryViews.vectorStatusView);
  router.register('global-excerpt', globalExcerptViews.globalExcerptView);
  router.register('global-excerpt-edit', globalExcerptViews.globalExcerptEditView);

  const actions = createMemoryActions({
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
  });

  async function organizeAfterReply(conversationId, trigger, modelId) {
    const landing = trigger === 'landing';
    try {
      const data = await organizeSoilRequest({
        conversation_id: conversationId,
        model: modelId,
        force: true,
        trigger,
        settings: settings(),
      });
      if (data.soil) runtime.soils.set(conversationId, data.soil);
      await Promise.all([fetchSoil(conversationId), fetchPockets(conversationId)]);
      if (currentId() === conversationId) chat.renderMessages();
      return {
        ok: !data.degraded,
        degraded: Boolean(data.degraded),
        skipped: Boolean(data.skipped),
        reason: data.reason || '',
        soil: runtime.soils.get(conversationId) || data.soil || emptySoil(conversationId),
      };
    } catch (error) {
      if (!['soil_locked'].includes(error?.type)) console.warn('[memory:soil-auto]', error);
      try {
        await Promise.all([fetchSoil(conversationId), fetchPockets(conversationId)]);
        if (currentId() === conversationId) chat.renderMessages();
      } catch (fetchError) {
        console.warn(landing ? '[memory:landing-readback]' : '[memory:reply-readback]', fetchError);
      }
      const locked = error?.type === 'soil_locked';
      return {
        ok: locked,
        skipped: locked,
        reason: locked ? 'manual_locked' : (error?.type || 'soil_organize_failed'),
        soil: runtime.soils.get(conversationId) || emptySoil(conversationId),
      };
    }
  }

  function onReplyCompleted(conversationId, { trigger = 'reply', modelId = '' } = {}) {
    const previous = runtime.soilChains.get(conversationId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(() => organizeAfterReply(conversationId, trigger, modelId));
    runtime.soilChains.set(conversationId, next);
    const cleanup = () => {
      if (runtime.soilChains.get(conversationId) === next) runtime.soilChains.delete(conversationId);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  function ownsEvent(_event, context) {
    if (context.namespace !== 'memory') return false;
    if (context.eventType === 'click') return { preventDefault: true };
    if (context.eventType === 'submit') return { preventDefault: true };
    return false;
  }

  function handleEvent(event, context) {
    if (context.eventType === 'click') return actions.handleAction(context.name, context.target, event);
    if (context.eventType === 'submit') return actions.handleSubmit(context.name, context.target, event);
  }

  function mount(context = {}) {
    root = context.overlayRoot || globalThis.document?.querySelector?.('#overlayRoot') || null;
    syncRoot(router.current?.());
  }

  function refresh(context = {}) {
    syncRoot(context.navigation?.current || router.current?.());
  }

  function destroy() {
    if (root?.dataset.controllerOwner === 'memory') delete root.dataset.controllerOwner;
    root = null;
  }

  return Object.freeze({
    id: 'memory',
    priority: 60,
    mountOrder: 60,
    ownsRoute,
    ownsEvent,
    handleEvent,
    mount,
    refresh,
    destroy,
    clearSoil: actions.clearSoil,
    handleAction: actions.handleAction,
    handleSubmit: actions.handleSubmit,
    onConversationChanged,
    onReplyCompleted,
    openPockets: actions.openPockets,
    showVectorStatus: actions.showVectorStatus,
    renderSoilEntry: soilViews.renderSoilEntry,
  });
}
