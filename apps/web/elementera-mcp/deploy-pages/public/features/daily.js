import { escapeHtml } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { createDailyClient } from './daily-client.js';
import { DAILY_ROUTES } from './daily/daily-constants.js';
import { createDailyProfile } from './daily/daily-profile.js';
import { createDailyMomentsView } from './daily/daily-moments-view.js';
import { createDailyDiariesView } from './daily/daily-diaries-view.js';
import { createDailyActions } from './daily/daily-actions.js';

let dailyStylesInstalled = false;
function ensureDailyStyles() {
  if (dailyStylesInstalled || typeof document === 'undefined') return;
  dailyStylesInstalled = true;
  if (document.querySelector('link[data-daily-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/public/styles/daily.css';
  link.dataset.dailyStyles = 'true';
  document.head.append(link);
}

export function createDaily({ storage, router, toast, chat }) {
  ensureDailyStyles();
  const client = createDailyClient();
  const saved = storage.read().daily || {};
  const cached = saved.cache || {};
  const preferences = storage.read().preferences || {};
  const state = {
    moments: Array.isArray(cached.moments) ? cached.moments : [],
    diaries: Array.isArray(cached.diaries) ? cached.diaries : [],
    commentTarget: '',
    commentingMomentIds: new Set(),
    expandedMoments: new Set(),
    savingMoment: false,
    profile: {
      xiaohanAvatarDataurl: preferences.xiaohanAvatar || '',
      myriAvatarDataurl: chat?.getProfile?.()?.assistant_avatar_dataurl || preferences.myriAvatar || '',
      momentCoverDataurl: saved.momentCover || '',
      myriDisplayName: '另一位屋主',
      updatedAt: null,
    },
    loaded: false,
    loadPromise: null,
    sync: 'idle',
    syncError: '',
  };
  let root = null;

  function ownsRoute(route) { return DAILY_ROUTES.has(route?.name || ''); }
  function syncRoot(route) {
    root ||= globalThis.document?.querySelector?.('#overlayRoot') || null;
    if (!root) return;
    if (ownsRoute(route)) root.dataset.controllerOwner = 'daily';
    else if (root.dataset.controllerOwner === 'daily') delete root.dataset.controllerOwner;
  }

  function persistCache() {
    try {
      storage.update((local) => {
        local.daily.cache = {
          moments: state.moments,
          diaries: state.diaries,
          syncedAt: state.sync === 'server' ? Date.now() : Number(local.daily.cache?.syncedAt || 0),
        };
        local.daily.momentCover = state.profile.momentCoverDataurl;
        local.preferences.xiaohanAvatar = state.profile.xiaohanAvatarDataurl;
      });
    } catch (error) {
      console.warn('[daily-cache]', error);
    }
  }

  function currentDailyRoute() { return DAILY_ROUTES.has(router.current()?.name); }
  function startLoad(force = false) {
    if (state.loadPromise) return state.loadPromise;
    if (state.loaded && !force) return Promise.resolve();
    state.sync = 'loading';
    state.syncError = '';
    state.loadPromise = client.load()
      .then(async (data) => {
        state.moments = data.moments;
        state.diaries = data.diaries;
        const serverProfile = data.profile || {};
        const priorModelPartnerAvatar = serverProfile.myriAvatarDataurl || '';
        let canonicalModelPartnerAvatar = chat?.getProfile?.()?.assistant_avatar_dataurl || '';
        if (!canonicalModelPartnerAvatar && priorModelPartnerAvatar && chat?.updateProfile) {
          try {
            const promoted = await chat.updateProfile({ assistant_avatar_dataurl: priorModelPartnerAvatar });
            canonicalModelPartnerAvatar = promoted.assistant_avatar_dataurl || priorModelPartnerAvatar;
          } catch (error) {
            console.warn('[daily-myri-avatar-migration]', error);
          }
        }
        state.profile = {
          xiaohanAvatarDataurl: serverProfile.xiaohanAvatarDataurl || state.profile.xiaohanAvatarDataurl || '',
          myriAvatarDataurl: canonicalModelPartnerAvatar || priorModelPartnerAvatar || state.profile.myriAvatarDataurl || '',
          momentCoverDataurl: serverProfile.momentCoverDataurl || state.profile.momentCoverDataurl || '',
          myriDisplayName: serverProfile.myriDisplayName || state.profile.myriDisplayName || '另一位屋主',
          updatedAt: serverProfile.updatedAt || state.profile.updatedAt || null,
        };
        state.loaded = true;
        state.sync = 'server';
        persistCache();
      })
      .catch((error) => {
        state.loaded = true;
        state.sync = 'cache';
        state.syncError = error?.message || '服务器暂不可用。';
      })
      .finally(() => {
        state.loadPromise = null;
        if (currentDailyRoute()) router.refresh().catch(() => undefined);
      });
    return state.loadPromise;
  }
  function ensureLoad() { if (!state.loaded && !state.loadPromise) void startLoad(); }

  function syncNotice() {
    if (state.sync === 'loading' || state.sync === 'idle') {
      return '<section class="daily-sync-note"><strong>正在同步小组件</strong><p>朋友圈与日记正在从服务器送来。</p></section>';
    }
    if (state.sync === 'cache') {
      return `<section class="daily-sync-note is-offline"><strong>当前显示本机缓存</strong><p>${escapeHtml(state.syncError)}</p><button type="button" data-action="daily:reload">重新载入</button></section>`;
    }
    return '';
  }

  const profile = createDailyProfile({ state, client, chat, persistCache, router, toast });
  const moments = createDailyMomentsView({ state, ensureLoad, syncNotice, profile });
  const diaries = createDailyDiariesView({ state, ensureLoad, syncNotice });

  function replaceMoment(next) {
    state.moments = state.moments.map((entry) => entry.id === next.id ? next : entry);
    persistCache();
  }
  function replaceDiary(next) {
    state.diaries = state.diaries.map((entry) => entry.id === next.id ? next : entry);
    persistCache();
  }

  const actions = createDailyActions({
    state,
    client,
    router,
    toast,
    startLoad,
    persistCache,
    replaceMoment,
    replaceDiary,
    profile,
  });

  function dailyHomeView() {
    ensureLoad();
    const entries = [
      ['moments', '碳硅圈', '海岸内部朋友圈', 'heart'],
      ['diary', '日记', '留下今天的纸页', 'edit'],
      ['pets', '宠物系统', '还在准备休憩箱', 'heart'],
      ['widgets', '未来小组件', '以后再慢慢长出来', 'plus'],
    ];
    return {
      title: '小组件',
      subtitle: state.sync === 'server' ? '朋友圈与日记' : '正在同步日常岛',
      className: 'daily-panel',
      body: `${syncNotice()}<section class="daily-grid">${entries.map(([route, title, subtitle, iconName]) => `<button type="button" data-action="daily:${route}"><span>${icon(iconName)}</span><strong>${title}</strong><small>${subtitle}</small></button>`).join('')}</section>`,
    };
  }

  function placeholderView({ title = '未上线' } = {}) {
    return {
      title,
      subtitle: '小组件',
      className: 'daily-placeholder',
      body: `<section class="feature-card feature-prose"><h2>${escapeHtml(title)}</h2><p>这里先留一块干净空地，等真正需要时再长模块。</p></section>`,
    };
  }

  router.register('daily-home', dailyHomeView);
  router.register('moments', moments.momentsView);
  router.register('moments-compose', moments.momentComposeView);
  router.register('diary', diaries.diaryView);
  router.register('diary-compose', diaries.diaryComposeView);
  router.register('daily-placeholder', placeholderView);

  function ownsEvent(_event, context) {
    if (context.eventType !== 'click' || context.namespace !== 'daily') return false;
    return { preventDefault: true };
  }
  function handleEvent(_event, context) { return actions.handleAction(context.name, context.target); }
  function mount(context = {}) {
    root = context.overlayRoot || globalThis.document?.querySelector?.('#overlayRoot') || null;
    const current = router.current?.();
    syncRoot(current);
    if (ownsRoute(current)) ensureLoad();
  }
  function refresh(context = {}) {
    const current = context.navigation?.current || router.current?.();
    syncRoot(current);
    if (ownsRoute(current)) ensureLoad();
    else state.commentTarget = '';
  }
  function destroy() {
    state.commentTarget = '';
    state.commentingMomentIds.clear();
    state.savingMoment = false;
    if (root?.dataset.controllerOwner === 'daily') delete root.dataset.controllerOwner;
    root = null;
  }

  return Object.freeze({
    id: 'daily',
    priority: 70,
    mountOrder: 65,
    ownsRoute,
    ownsEvent,
    handleEvent,
    mount,
    refresh,
    destroy,
    handleAction: actions.handleAction,
    startLoad,
  });
}
