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

  // Original traced compose icon. It remains inline so this module is
  // still the sole icon owner; there is no parallel image-asset fallback.
  'new-chat': solid('<path fill-rule="evenodd" d="M3.62 4.40 L3.50 4.83 L3.50 27.41 L3.66 27.83 L3.93 28.11 L4.20 28.22 L27.52 28.22 L27.80 28.11 L28.07 27.83 L28.22 27.41 L28.18 20.98 L28.22 20.05 L28.30 19.97 L28.34 18.61 L28.30 17.87 L28.22 17.79 L28.22 17.48 L28.11 17.21 L28.07 16.86 L27.87 16.43 L27.52 16.12 L27.06 16.12 L26.74 16.35 L26.51 16.78 L26.47 17.09 L26.39 17.13 L26.39 17.32 L26.32 17.40 L26.28 18.76 L26.16 18.80 L26.12 26.59 L5.61 26.59 L5.57 5.61 L11.87 5.57 L11.95 5.64 L13.51 5.68 L14.29 5.45 L14.48 5.22 L14.56 4.91 L14.33 4.55 L13.98 4.40 L13.94 4.32 L13.35 4.17 L13.27 4.09 L12.69 4.05 L12.61 3.97 L12.15 3.97 L12.07 3.89 L11.37 3.89 L11.29 3.97 L11.06 3.97 L10.98 3.89 L10.71 3.89 L10.63 3.97 L10.43 3.89 L10.16 3.89 L10.08 3.97 L9.89 3.89 L9.62 3.89 L9.54 3.97 L9.50 3.89 L9.42 3.97 L9.23 3.89 L9.07 3.89 L9.03 3.97 L8.84 3.89 L8.76 3.97 L8.72 3.89 L8.56 3.89 L8.49 3.97 L8.25 3.97 L8.18 3.89 L8.02 3.89 L7.94 3.97 L7.71 3.97 L7.63 3.89 L7.36 3.89 L7.28 3.97 L7.09 3.89 L6.81 3.89 L6.73 3.97 L6.54 3.89 L6.27 3.89 L6.19 3.97 L6.15 3.89 L6.07 3.97 L6.03 3.89 L5.96 3.97 L5.88 3.89 L5.72 3.89 L5.68 3.97 L5.49 3.89 L5.41 3.97 L5.37 3.89 L5.22 3.89 L5.14 3.97 L4.91 3.97 L4.83 3.89 L4.67 3.89 L4.59 3.97 L4.09 3.97 Z M26.20 4.52 L25.81 4.40 L25.77 4.32 L25.58 4.28 L25.54 4.20 L25.11 4.01 L25.07 4.05 L24.64 3.85 L24.37 3.85 L24.33 3.78 L22.70 3.78 L22.66 3.85 L22.35 3.85 L22.19 3.97 L22.03 3.97 L14.13 11.87 L14.13 11.95 L14.01 11.99 L14.01 12.07 L11.56 14.52 L11.25 15.14 L11.09 19.19 L11.13 20.75 L11.33 20.98 L11.52 21.10 L13.27 21.14 L15.61 21.06 L15.65 20.98 L17.17 20.94 L17.21 20.87 L17.36 20.87 L17.44 20.75 L17.60 20.75 L28.18 10.28 L28.34 9.89 L28.34 9.62 L28.42 9.58 L28.46 8.91 L28.42 7.82 L28.34 7.75 L28.30 7.32 L28.22 7.28 L28.07 6.73 L27.87 6.50 L27.83 6.27 L27.68 6.00 Z M24.88 6.00 L25.34 6.35 L25.93 6.93 L26.36 7.59 L26.32 7.63 L26.47 7.82 L26.51 8.29 L26.59 8.37 L26.59 8.95 L26.51 8.99 L26.51 9.27 L17.05 18.65 L16.86 18.57 L15.53 17.56 L14.83 16.90 L14.36 16.23 L14.17 16.08 L13.59 15.18 L22.73 6.00 L22.89 5.76 L23.01 5.68 L23.47 5.64 L24.14 5.68 Z"/>', { viewBox: '0 0 32 32' }),

  more: solid('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
  image: outline('<rect x="4" y="5" width="16" height="14" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="m6 17 4-4 3 3 2-2 3 3"/>'),
  file: outline('<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  mic: outline('<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6"/>'),
  send: outline('<path d="m4 11 16-7-6.5 16-2.2-6.2Z"/><path d="m11.3 13.8 4.4-4.4"/>'),
  stop: solid('<rect x="7" y="7" width="10" height="10" rx="2"/>'),
  call: outline('<path d="M7.2 4.5 10 8.2 8.4 10c1.2 2.5 3.1 4.4 5.6 5.6l1.8-1.6 3.7 2.8-.9 2.4c-.4 1-1.5 1.5-2.5 1.2C9.9 18.6 5.4 14.1 3.6 7.9c-.3-1 .2-2.1 1.2-2.5Z"/>'),
  back: outline('<path d="m14.5 5-7 7 7 7"/>'),

  // Restored from the original hand-drawn action SVG set.
  copy: outline('<path d="M12.2 6.4H25.2V19.4H21.3"/><path d="M12.2 6.4V10.2"/><path d="M6.8 11.4H20.4V25H6.8Z"/>', { viewBox: '0 0 32 32', strokeWidth: 2.05 }),
  edit: outline('<path d="M8 24l2-6 11-11c1-1 3-1 4 0s1 3 0 4L14 22z"/><path d="M19 9l4 4"/><path d="M10 18l4 4"/>', { viewBox: '0 0 32 32', strokeWidth: 2.1 }),
  heart: outline('<circle cx="16" cy="16" r="10.7"/><path class="reaction-fill" d="M16 21.2 C15.4 20.8 10.8 17.9 10.8 14.4 C10.8 12.5 12.1 11.4 13.7 11.4 C14.8 11.4 15.6 12 16 12.9 C16.4 12 17.2 11.4 18.3 11.4 C19.9 11.4 21.2 12.5 21.2 14.4 C21.2 17.9 16.6 20.8 16 21.2Z"/>', { viewBox: '0 0 32 32', strokeWidth: 2.15 }),
  like: outline('<path d="M9.5 27H6.5A2.2 2.2 0 0 1 4.3 24.8v-9.2a2.2 2.2 0 0 1 2.2-2.2h3z"/><path class="reaction-fill" d="M9.5 13.4c3.3-2.6 4.8-6.2 5.2-8.3.1-.8.9-1.2 1.6-.9 1.7.7 2.3 2.4 1.9 4.4l-.7 3.6h5.5c2.1 0 3.5 1.9 3 3.9l-1.7 7.4a4.1 4.1 0 0 1-4 3.2H9.5z"/>', { viewBox: '0 0 32 32', strokeWidth: 2.25 }),
  refresh: outline('<path d="M23.8 13.3a8 8 0 0 0-14.2-3.1"/><path d="M9 6.9v4.3h4.3"/><path d="M8.2 18.7a8 8 0 0 0 14.2 3.1"/><path d="M23 25.1v-4.3h-4.3"/>', { viewBox: '0 0 32 32', strokeWidth: 2.35 }),
  trash: outline('<path d="M10.4 10.8h11.2"/><path d="M14.1 10.8l1.1-2h1.6l1.1 2"/><path d="M11.4 12.2l.9 11.1c.06.8.72 1.4 1.52 1.4h4.4c.8 0 1.46-.6 1.52-1.4l.9-11.1"/><path d="M13 24.7c2 .45 4 .45 6 0"/>', { viewBox: '0 0 32 32', strokeWidth: 2.05 }),

  plus: outline('<path d="M12 5v14M5 12h14"/>', { strokeWidth: 2 }),
  wolf: outline('<path d="M22 58 C18 45 22 30 34 27 C45 24 55 31 64 41 C73 31 83 24 94 27 C106 30 110 45 106 58 L113 58 C113 67 108 75 99 80 L108 85 L97 92 L102 100 L82 100 C76 106 70 109 64 109 C58 109 52 106 46 100 L26 100 L31 92 L20 85 L29 80 C20 75 15 67 15 58 Z"/><path d="M35 39 C41 37 49 42 52 50 C49 57 42 60 35 56 C31 50 31 43 35 39 Z" fill="currentColor" stroke="none"/><path d="M93 39 C87 37 79 42 76 50 C79 57 86 60 93 56 C97 50 97 43 93 39 Z" fill="currentColor" stroke="none"/><path d="M39 70 C45 67 51 68 55 72"/><path d="M89 70 C83 67 77 68 73 72"/><path d="M55 84 C59 89 63 89 64 84"/><path d="M64 84 C65 89 69 89 73 84"/><path d="M60 91 C60 98 62 102 64 105"/><path d="M68 91 C68 98 66 102 64 105"/>', { viewBox: '0 0 128 128', strokeWidth: 7 }),
  serpent: outline('<path d="M24 67 L26 28 C26 18 32 15 41 20 C49 25 56 34 60 47"/><path d="M104 67 L102 28 C102 18 96 15 87 20 C79 25 72 34 68 47"/><path d="M20 70 C34 56 49 48 64 44 C79 48 94 56 108 70 L114 80 L108 96 C109 105 101 112 90 118 C81 122 72 124 64 124 C56 124 47 122 38 118 C27 112 19 105 20 96 L14 80 Z"/><path d="M34 87 C40 84 47 84 51 88"/><path d="M94 87 C88 84 81 84 77 88"/><path d="M64 124 C64 131 61 137 57 143"/><path d="M64 124 C64 131 67 137 71 143"/>', { viewBox: '0 0 128 154', strokeWidth: 8 }),
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
