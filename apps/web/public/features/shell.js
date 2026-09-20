import { q, qa } from '../core/dom.js';
import { THEME_PRESETS, normalizeThemeId, themeLabel } from '../core/themes.js';

const THEME_IDS = Object.freeze(THEME_PRESETS.map((item)=>item.id));
const THEME_LABELS = Object.freeze(Object.fromEntries(THEME_PRESETS.map((item)=>[item.id,item.label])));
const ROOTS = Object.freeze({
  sidebar: '#sidebar',
  scrim: '#scrim',
  conversations: '#chatConversationList',
});
const SIDEBAR_LOCAL_ACTIONS = new Set([
  'chat:menu',
  'chat:rename',
  'chat:delete-conversation',
]);
const DAILY_ROUTES = new Set([
  'daily-home', 'moments', 'moments-compose', 'diary', 'diary-compose', 'daily-placeholder',
]);

export function createShell({ storage }) {
  let viewportCleanup = null;

  function applyPreferences() {
    const preferences = storage.read().preferences;
    const theme = normalizeThemeId(preferences.theme);
    document.documentElement.dataset.theme = theme;
    if (preferences.userBubble) document.documentElement.style.setProperty('--user', preferences.userBubble);
    else document.documentElement.style.removeProperty('--user');
    if (preferences.accent) document.documentElement.style.setProperty('--accent', preferences.accent);
    else document.documentElement.style.removeProperty('--accent');
    const label = q('#themeLabel');
    if (label) label.textContent = themeLabel(theme);
    const themeMeta = q('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = ['navy-gold','aurora-night','retro-pixel','purple-tide'].includes(theme) ? '#101827' : '#ffffff';
  }

  function syncViewportHeight() {
    const windowRef = globalThis.window;
    const height = Math.round(
      windowRef?.visualViewport?.height
      || windowRef?.innerHeight
      || document.documentElement?.clientHeight
      || 0,
    );
    if (height > 0) document.documentElement.style.setProperty('--app-viewport-height', `${height}px`);
  }

  function bindViewportHeight() {
    viewportCleanup?.();
    const windowRef = globalThis.window;
    if (!windowRef) return;
    const viewport = windowRef.visualViewport;
    const onResize = () => syncViewportHeight();
    syncViewportHeight();
    windowRef.addEventListener?.('resize', onResize);
    viewport?.addEventListener?.('resize', onResize);
    viewportCleanup = () => {
      windowRef.removeEventListener?.('resize', onResize);
      viewport?.removeEventListener?.('resize', onResize);
      viewportCleanup = null;
    };
  }

  function openSidebar() {
    document.body.classList.add('sidebar-open');
    const scrim = q(ROOTS.scrim);
    if (scrim) scrim.hidden = false;
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    const scrim = q(ROOTS.scrim);
    if (scrim) scrim.hidden = true;
  }

  function cycleTheme() {
    storage.update((state) => {
      const current=normalizeThemeId(state.preferences.theme);
      const index=THEME_IDS.indexOf(current);
      state.preferences.theme=THEME_IDS[(index+1)%THEME_IDS.length];
    });
    applyPreferences();
  }

  function setTheme(theme) {
    const normalized=normalizeThemeId(theme);
    storage.update((state)=>{state.preferences.theme=normalized;});
    applyPreferences();
  }

  function filterSidebar(value) {
    const needle = String(value || '').trim().toLocaleLowerCase('zh-CN');
    qa(`${ROOTS.conversations} .conversation-row`).forEach((item) => {
      item.hidden = Boolean(needle) && !item.textContent.toLocaleLowerCase('zh-CN').includes(needle);
    });
  }

  function activeAction(route) {
    const name = route?.name || '';
    if (DAILY_ROUTES.has(name)) return 'daily:home';
    return '';
  }

  function updateActiveNavigation(route) {
    const active = activeAction(route);
    for (const item of qa(`${ROOTS.sidebar} [data-action="daily:home"]`)) {
      const selected = item.dataset.action === active;
      item.classList.toggle('is-active', selected);
      if (selected) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
  }

  function observeEvent(event, context) {
    if (event.type !== 'click' || !context.route || context.namespace === 'shell') return;
    if (!context.target?.closest?.(ROOTS.sidebar)) return;
    if (SIDEBAR_LOCAL_ACTIONS.has(context.route)) return;
    closeSidebar();
  }

  function handleAction(name) {
    if (name === 'open-sidebar') return openSidebar();
    if (name === 'close-sidebar') return closeSidebar();
    if (name === 'cycle-theme') return cycleTheme();
  }

  function handleInput(name, target) {
    if (name === 'filter-sidebar') filterSidebar(target.value);
  }

  function mount(context = {}) {
    bindViewportHeight();
    applyPreferences();
    updateActiveNavigation(context.router?.current?.());
  }

  function refresh(context = {}) {
    syncViewportHeight();
    const navigation = context.navigation;
    if (navigation?.current && navigation.reason !== 'refresh') closeSidebar();
    updateActiveNavigation(navigation?.current || context.router?.current?.());
  }

  function destroy() {
    viewportCleanup?.();
    viewportCleanup = null;
    document.documentElement.style.removeProperty('--app-viewport-height');
    closeSidebar();
    updateActiveNavigation(null);
  }

  function ownsEvent(_event, context) {
    if (context.namespace !== 'shell') return false;
    if (context.eventType === 'click') return { preventDefault: true };
    if (context.eventType === 'input') return true;
    return false;
  }

  function handleEvent(event, context) {
    if (context.eventType === 'click') return handleAction(context.name, context.target, event);
    if (context.eventType === 'input') return handleInput(context.name, context.target, event);
  }

  return Object.freeze({
    id: 'shell',
    priority: 90,
    mountOrder: 100,
    refreshOnNavigation: true,
    observeEvent,
    ownsEvent,
    handleEvent,
    mount,
    refresh,
    destroy,
    applyPreferences,
    openSidebar,
    closeSidebar,
    cycleTheme,
    setTheme,
    filterSidebar,
    handleAction,
    handleInput,
    themeLabels: THEME_LABELS,
  });
}
