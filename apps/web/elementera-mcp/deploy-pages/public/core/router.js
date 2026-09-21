import { escapeHtml } from './dom.js';
import { icon } from './icons.js';

export function createRouter(root, { onOpen = () => {}, onClose = () => {} } = {}) {
  const renderers = new Map();
  const subscribers = new Set();
  const stack = [];
  let renderToken = 0;
  let renderedRoute = null;

  async function notify(reason, current, previous) {
    const navigation = Object.freeze({ reason, current, previous });
    for (const listener of subscribers) await listener(navigation);
  }

  async function render({ preserveScroll = false, reason = 'refresh' } = {}) {
    const token = ++renderToken;
    const current = stack.at(-1) || null;
    const previous = renderedRoute;
    const scrollTop = preserveScroll ? root.querySelector('.feature-body')?.scrollTop || 0 : 0;
    if (!current) {
      root.hidden = true;
      root.replaceChildren();
      delete root.dataset.route;
      root.className = 'app-overlay';
      renderedRoute = null;
      onClose();
      await notify(reason, null, previous);
      return;
    }

    const renderer = renderers.get(current.name);
    if (!renderer) throw new Error(`route_not_registered:${current.name}`);
    const view = await renderer(current.params || {});
    if (token !== renderToken) return;
    root.hidden = false;
    root.dataset.route = current.name;
    root.className = `app-overlay ${view.className || ''}`.trim();
    root.innerHTML = `<section class="feature-panel">
      <header class="feature-head">
        <button class="feature-back" type="button" data-action="router:back" aria-label="返回">${icon('back')}</button>
        <div><h1>${escapeHtml(view.title || '')}</h1><p>${escapeHtml(view.subtitle || '')}</p></div>
        ${view.headerAction || ''}
      </header>
      <main class="feature-body">${view.body || ''}</main>
      ${view.footer || ''}
    </section>`;
    onOpen(current);
    view.afterRender?.(root);
    if (preserveScroll) {
      const body = root.querySelector('.feature-body');
      if (body) body.scrollTop = scrollTop;
    }
    renderedRoute = current;
    await notify(reason, current, previous);
  }

  return Object.freeze({
    register(name, renderer) {
      if (renderers.has(name)) throw new Error(`duplicate_route:${name}`);
      renderers.set(name, renderer);
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('router_subscriber_must_be_function');
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    async open(name, params = {}, { replace = false } = {}) {
      if (replace && stack.length) stack[stack.length - 1] = { name, params };
      else stack.push({ name, params });
      await render({ reason: replace ? 'replace' : 'open' });
    },
    async back() {
      stack.pop();
      await render({ reason: 'back' });
    },
    async close() {
      stack.length = 0;
      await render({ reason: 'close' });
    },
    async refresh(options = {}) {
      await render({ preserveScroll: options.preserveScroll !== false, reason: 'refresh' });
    },
    current: () => stack.at(-1) || null,
  });
}
