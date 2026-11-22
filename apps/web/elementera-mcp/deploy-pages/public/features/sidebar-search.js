import { API, requestJson } from '../core/api.js';
import { q } from '../core/dom.js';

const MIN_QUERY = 1;
const DEBOUNCE_MS = 260;

export function createSidebarSearch({ chat, shell }) {
  let timer = null;
  let requestSequence = 0;
  let currentQuery = '';
  let results = [];
  let cursor = null;
  let loading = false;

  function root() { return q('#sidebarSearchResults'); }

  function clear() {
    const panel = root();
    if (panel) { panel.hidden = true; panel.replaceChildren(); }
    results = [];
    cursor = null;
    loading = false;
  }

  function line(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
  }

  function render(error = '') {
    const panel = root();
    if (!panel) return;
    panel.hidden = !currentQuery;
    panel.replaceChildren();
    if (!currentQuery) return;
    panel.append(line('p', 'coast-search-title', '原文检索'));
    if (error) panel.append(line('p', 'coast-search-error', error));
    for (let index = 0; index < results.length; index += 1) {
      const item = results[index];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'coast-search-result';
      button.dataset.action = 'sidebar-search:open';
      button.dataset.index = String(index);
      button.append(
        line('strong', 'coast-search-result-title', item.conversation_title || '未命名窗口'),
        line('span', 'coast-search-result-context',
          item.kind === 'conversation' ? '窗口标题' : item.role === 'user' ? '用户 · 原文' : '助手 · 原文'),
        line('span', 'coast-search-result-snippet', item.snippet || ''),
      );
      panel.append(button);
    }
    if (loading) panel.append(line('p', 'coast-search-hint', '正在查找原文…'));
    else if (cursor) {
      const more = line('button', 'coast-search-more', '继续查找');
      more.type = 'button';
      more.dataset.action = 'sidebar-search:more';
      panel.append(more);
    } else if (!results.length && !error) {
      panel.append(line('p', 'coast-search-hint', '暂时没找到匹配的原文。'));
    }
  }

  async function search(nextPage = false) {
    const query = currentQuery;
    const seq = ++requestSequence;
    const startCursor = nextPage ? cursor : '';
    if (!nextPage) results = [];
    loading = true;
    render();
    try {
      const url = API.chatSearch + '?q=' + encodeURIComponent(query)
        + (startCursor ? '&cursor=' + encodeURIComponent(startCursor) : '');
      const response = await requestJson(url);
      if (seq !== requestSequence || query !== currentQuery) return;
      results.push(...(response.results || []));
      cursor = response.next_cursor || null;
      loading = false;
      render();
    } catch (error) {
      if (seq !== requestSequence) return;
      loading = false;
      render('搜索失败：' + (error.message || '请稍后再试'));
    }
  }

  function onQuery(value) {
    currentQuery = String(value || '').trim().slice(0, 100);
    shell.filterSidebar(currentQuery);
    requestSequence += 1;
    if (timer != null) clearTimeout(timer);
    if (currentQuery.length < MIN_QUERY) { clear(); return; }
    render();
    timer = setTimeout(() => { void search(); }, DEBOUNCE_MS);
  }

  async function open(index) {
    const item = results[index];
    if (!item) return;
    const opened = await chat.openSearchResult(item);
    if (opened) shell.closeSidebar();
  }

  return Object.freeze({
    id: 'sidebar-search',
    priority: 96,
    mountOrder: 65,
    ownsEvent(_event, context) {
      if (context.namespace !== 'sidebar-search') return false;
      return { preventDefault: context.eventType === 'click' };
    },
    handleEvent(_event, context) {
      if (context.eventType === 'input' && context.name === 'query') return onQuery(context.target.value);
      if (context.eventType === 'click' && context.name === 'open') return open(Number(context.target.dataset.index));
      if (context.eventType === 'click' && context.name === 'more' && cursor && !loading) return search(true);
    },
    mount() {
      const input = q('#sidebarSearch');
      if (input?.value) onQuery(input.value);
      else clear();
    },
    refresh() {},
    destroy() { requestSequence++; if (timer != null) clearTimeout(timer); clear(); },
  });
}
