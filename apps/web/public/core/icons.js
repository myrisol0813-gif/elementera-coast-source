import { escapeAttribute } from './dom.js';

function outline(body, { viewBox = '0 0 24 24', strokeWidth = 1.8 } = {}) {
  return Object.freeze({ body, viewBox, fill: 'none', stroke: 'currentColor', strokeWidth });
}

function solid(body, { viewBox = '0 0 24 24' } = {}) {
  return Object.freeze({ body, viewBox, fill: 'currentColor', stroke: 'none', strokeWidth: 0 });
}

const ICONS = Object.freeze({
  menu: outline('<path d="M4 7h16M4 12h16M4 17h16"/>', { strokeWidth: 2 }),
  close: outline('<path d="m6 6 12 12M18 6 6 18"/>', { strokeWidth: 2 }),
  search: outline('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'),
  theme: outline('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16Z" fill="currentColor" stroke="none"/>'),
  'new-chat': outline('<path d="M5 5h10l4 4v10H5Z"/><path d="M9 13h6M12 10v6"/>'),
  more: solid('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
  image: outline('<rect x="4" y="5" width="16" height="14" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="m6 17 4-4 3 3 2-2 3 3"/>'),
  file: outline('<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  mic: outline('<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6"/>'),
  send: outline('<path d="m4 11 16-7-6.5 16-2.2-6.2Z"/><path d="m11.3 13.8 4.4-4.4"/>'),
  stop: solid('<rect x="7" y="7" width="10" height="10" rx="2"/>'),
  call: outline('<path d="M7.2 4.5 10 8.2 8.4 10c1.2 2.5 3.1 4.4 5.6 5.6l1.8-1.6 3.7 2.8-.9 2.4c-.4 1-1.5 1.5-2.5 1.2C9.9 18.6 5.4 14.1 3.6 7.9c-.3-1 .2-2.1 1.2-2.5Z"/>'),
  back: outline('<path d="m14.5 5-7 7 7 7"/>'),
  copy: outline('<path d="M9 7h10v12H9Z"/><path d="M5 5h10v2M5 5v12h4"/>'),
  edit: outline('<path d="M5 19l3-1 10-10-2-2L6 16Z"/><path d="m14 8 2 2"/>'),
  heart: outline('<path d="M12 20s-7-4.2-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.8-7 9-7 9Z"/>'),
  like: outline('<path d="M8 11v9H4v-9Zm0 0 4-7c2 0 3 1 2.5 3L14 10h4c2 0 3 1.8 2.4 3.5L18 20H8"/>'),
  refresh: outline('<path d="M19 8V4l-2 2a8 8 0 1 0 2 9"/>'),
  trash: outline('<path d="M5 7h14M9 7V5h6v2M8 10l1 9h6l1-9"/>'),
  plus: outline('<path d="M12 5v14M5 12h14"/>', { strokeWidth: 2 }),
  home: outline('<path d="m4 11 8-7 8 7v9h-6v-6h-4v6H4Z"/>'),
  settings: outline('<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>'),
  tool: outline('<path d="M14 5a4 4 0 0 0 5 5l-9 9-5-5 9-9Z"/>'),
  radio: outline('<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13"/>'),
  letter: outline('<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="m5 8 7 5 7-5"/>'),
  memory: outline('<path d="M7 5.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 5-.5c2 1 2.5 3.5 1.4 5.2 1.1 1.8.4 4.2-1.5 5.1A4.5 4.5 0 0 1 12 18a4.5 4.5 0 0 1-4.9-2.2c-1.9-.9-2.6-3.3-1.5-5.1C4.5 9 5 6.5 7 5.5Z"/><path d="M12 6v12M8.5 9.5H12M12 14.5h3.5"/>'),
  daily: outline('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 9h16M8 13h3M8 16h6"/>'),
  check: outline('<path d="m5 12 4 4 10-10"/>'),
  download: outline('<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>'),
});

export function icon(name, className = '') {
  const glyph = ICONS[name];
  if (!glyph) throw new Error(`unknown_icon:${name}`);
  const strokeAttributes = glyph.stroke === 'none'
    ? ''
    : ` stroke-width="${glyph.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg class="icon ${escapeAttribute(className)}" data-icon-name="${escapeAttribute(name)}" viewBox="${escapeAttribute(glyph.viewBox)}" aria-hidden="true" focusable="false" fill="${glyph.fill}" stroke="${glyph.stroke}"${strokeAttributes}>${glyph.body}</svg>`;
}

export function hydrateIconSlots(root = document) {
  root.querySelectorAll('[data-icon]').forEach((slot) => {
    slot.replaceChildren();
    slot.insertAdjacentHTML('afterbegin', icon(slot.dataset.icon));
  });
}
