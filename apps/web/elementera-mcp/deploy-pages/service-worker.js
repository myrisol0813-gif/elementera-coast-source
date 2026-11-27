// PWA shell cache for the current Coast application surface.
const CACHE_NAME = 'elementera-coast-source-app-43';
const CORE = Object.freeze([
  '/',
  '/index.html',
  '/manifest.json',
  '/public/styles/tokens.css?v=coast-source-app-43',
  '/public/styles/shell.css?v=coast-source-app-43',
  '/public/styles/chat.css?v=coast-source-app-43',
  '/public/styles/calendar.css?v=coast-source-app-43',
  '/public/styles/library.css?v=coast-source-app-43',
  '/public/styles/mcp-letter.css?v=coast-source-app-43',
  '/public/styles/rikkahub.css?v=coast-source-app-43',
  '/public/styles/features.css?v=coast-source-app-43',
  '/public/styles/cross-window.css',
  '/public/styles/desk.css?v=coast-source-app-43',
  '/public/styles/dev-hands.css?v=coast-source-app-43',
  '/public/styles/daily.css',
  '/public/styles/model-metadata.css',
  '/public/app.js?v=coast-source-app-43',
  '/public/core/api.js',
  '/public/core/danger.js',
  '/public/core/dom.js',
  '/public/core/event-spine.js',
  '/public/core/icons.js',
  '/public/core/model-format.js',
  '/public/core/router.js',
  '/public/core/feature-guide.js',
  '/public/core/stream-format.js',
  '/public/core/storage.js',
  '/public/content/island-letter.js',
  '/public/features/chat-state.js',
  '/public/features/chat.js',
  '/public/features/chat/chat-actions.js',
  '/public/features/chat/chat-window-settings.js',
  '/public/features/chat/chat-voice.js',
  '/public/features/chat/chat-treasures.js',
  '/public/features/chat/chat-attachments.js',
  '/public/features/chat/chat-context.js',
  '/public/features/chat/chat-furniture.js',
  '/public/features/chat/chat-conversations.js',
  '/public/features/chat/chat-generation.js',
  '/public/features/chat/chat-reply-sequence.js',
  '/public/features/chat/chat-reply-sequence-generation.js',
  '/public/features/chat/chat-manual-image.js',
  '/public/features/chat/chat-local-time.js',
  '/public/features/chat/chat-title-landing.js',
  '/public/features/chat/chat-model-metadata.js',
  '/public/features/chat/chat-profile.js',
  '/public/features/chat/chat-render.js',
  '/public/features/chat/chat-request-context.js',
  '/public/features/chat/chat-rikkahub.js',
  '/public/features/chat/chat-stream.js',
  '/public/features/chat/chat-stream-flow.js',
  '/public/features/chat/chat-tool-status.js',
  '/public/features/daily-client.js',
  '/public/features/calendar.js',
  '/public/features/library.js',
  '/public/features/library-import.js',
  '/public/features/library-upload.js',
  '/public/features/library-cover.js',
  '/public/features/library-pages.js',
  '/public/features/library-reader.js',
  '/public/features/daily.js',
  '/public/features/daily/daily-actions.js',
  '/public/features/daily/daily-constants.js',
  '/public/features/daily/daily-diaries-view.js',
  '/public/features/daily/daily-format.js',
  '/public/features/daily/daily-moments-view.js',
  '/public/features/daily/daily-profile.js',
  '/public/features/dev-hands.js',
  '/public/features/dogtalk.js',
  '/public/features/letters.js',
  '/public/features/memory.js',
  '/public/features/memory/memory-actions.js',
  '/public/features/memory/memory-client.js',
  '/public/features/memory/memory-constants.js',
  '/public/features/memory/memory-custom-view.js',
  '/public/features/memory/memory-format.js',
  '/public/features/memory/memory-library-view.js',
  '/public/features/memory/memory-global-excerpt-view.js',
  '/public/features/memory/memory-pocket-view.js',
  '/public/features/memory/memory-soil-view.js',
  '/public/features/models.js',
  '/public/features/models/models-actions.js',
  '/public/features/models/models-client.js',
  '/public/features/models/models-constants.js',
  '/public/features/models/models-format.js',
  '/public/features/models/models-quick-picker.js',
  '/public/features/models/models-view.js',
  '/public/features/settings.js',
  '/public/features/offline-archive.js',
  '/public/features/offline-v2-archive.js',
  '/public/features/settings-transfer.js',
  '/public/core/archive-v2-collect.js',
  '/public/core/archive-v2-device-settings.js',
  '/public/core/archive-v2-read.js',
  '/public/core/archive-v2-save.js',
  '/public/core/archive-v2-transport.js',
  '/public/core/archive-v2-zip.js',
  '/public/features/settings-archive-v2.js',
  '/public/features/shell.js',
  '/public/features/sidebar-search.js',
  '/public/features/vault.js',
  '/public/features/tools.js',
  '/public/features/desk.js',
  '/public/features/toolroom.js',
  '/public/icons/icon-16.png',
  '/public/icons/icon-32.png',
  '/public/icons/apple-touch-icon.png',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
  '/public/icons/icon-maskable-512.png',
  '/public/media/model-partner-default-avatar.jpg',
  // Independent bundled studio, including every original SVG and its manifests.
  '/public/rest-box/room-lab.html',
  '/public/rest-box/room-lab.mjs',
  '/public/rest-box/room-state.mjs',
  '/public/rest-box/room-renderer.mjs',
  '/public/rest-box/creature-state.mjs',
  '/public/rest-box/creature-renderer.mjs',
  '/public/rest-box/creature-editor.mjs',
  '/public/rest-box/art/v1/index.json',
  '/public/rest-box/art/v1/rooms/living.json',
  '/public/rest-box/art/v1/rooms/study.json',
  '/public/rest-box/art/v1/rooms/bedroom.json',
  '/public/rest-box/art/v1/extras/afternoon.json',
  '/public/rest-box/art/v1/extras/stationery.json',
  '/public/rest-box/art/v1/creatures/index.json',
  '/public/rest-box/art/v1/accessories/index.json',
  '/public/rest-box/art/v1/props/anchors.json',
  '/public/rest-box/art/v1/color-presets.json',
  '/public/rest-box/art/v1/creatures/appearance.json',
  '/public/rest-box/art/v1/props/mounts.json',
  '/public/rest-box/art/v1/accessories/badges.json',
  '/public/rest-box/art/v1/assets/living-window.svg',
  '/public/rest-box/art/v1/assets/living-curtains.svg',
  '/public/rest-box/art/v1/assets/living-chime.svg',
  '/public/rest-box/art/v1/assets/living-picture.svg',
  '/public/rest-box/art/v1/assets/living-bookcase.svg',
  '/public/rest-box/art/v1/assets/living-vase.svg',
  '/public/rest-box/art/v1/assets/living-lamp.svg',
  '/public/rest-box/art/v1/assets/living-sofa.svg',
  '/public/rest-box/art/v1/assets/living-rug.svg',
  '/public/rest-box/art/v1/assets/living-table.svg',
  '/public/rest-box/art/v1/assets/living-plant.svg',
  '/public/rest-box/art/v1/assets/living-nest.svg',
  '/public/rest-box/art/v1/assets/living-books.svg',
  '/public/rest-box/art/v1/assets/study-bookcase.svg',
  '/public/rest-box/art/v1/assets/study-globe.svg',
  '/public/rest-box/art/v1/assets/study-window.svg',
  '/public/rest-box/art/v1/assets/study-curtain.svg',
  '/public/rest-box/art/v1/assets/study-picture.svg',
  '/public/rest-box/art/v1/assets/study-clock.svg',
  '/public/rest-box/art/v1/assets/study-rug.svg',
  '/public/rest-box/art/v1/assets/study-desk.svg',
  '/public/rest-box/art/v1/assets/study-lamp.svg',
  '/public/rest-box/art/v1/assets/study-open-book.svg',
  '/public/rest-box/art/v1/assets/study-ink.svg',
  '/public/rest-box/art/v1/assets/study-cup.svg',
  '/public/rest-box/art/v1/assets/study-chair.svg',
  '/public/rest-box/art/v1/assets/study-cushion.svg',
  '/public/rest-box/art/v1/assets/study-plant.svg',
  '/public/rest-box/art/v1/assets/study-scrolls.svg',
  '/public/rest-box/art/v1/assets/bedroom-picture.svg',
  '/public/rest-box/art/v1/assets/bedroom-mobile.svg',
  '/public/rest-box/art/v1/assets/bedroom-window.svg',
  '/public/rest-box/art/v1/assets/bedroom-curtains.svg',
  '/public/rest-box/art/v1/assets/bedroom-chest.svg',
  '/public/rest-box/art/v1/assets/bedroom-lamp.svg',
  '/public/rest-box/art/v1/assets/bedroom-books.svg',
  '/public/rest-box/art/v1/assets/bedroom-rug.svg',
  '/public/rest-box/art/v1/assets/bedroom-bed.svg',
  '/public/rest-box/art/v1/assets/bedroom-nest.svg',
  '/public/rest-box/art/v1/assets/bedroom-slippers.svg',
  '/public/rest-box/art/v1/assets/bedroom-plant.svg',
  '/public/rest-box/art/v1/rooms/living-environment.svg',
  '/public/rest-box/art/v1/rooms/living-overlay.svg',
  '/public/rest-box/art/v1/rooms/study-environment.svg',
  '/public/rest-box/art/v1/rooms/bedroom-environment.svg',
  '/public/rest-box/art/v1/creatures/wolf.svg',
  '/public/rest-box/art/v1/creatures/cat.svg',
  '/public/rest-box/art/v1/creatures/fox.svg',
  '/public/rest-box/art/v1/creatures/rabbit.svg',
  '/public/rest-box/art/v1/creatures/bear.svg',
  '/public/rest-box/art/v1/creatures/deer.svg',
  '/public/rest-box/art/v1/creatures/lion.svg',
  '/public/rest-box/art/v1/creatures/tiger.svg',
  '/public/rest-box/art/v1/creatures/bird.svg',
  '/public/rest-box/art/v1/creatures/snake.svg',
  '/public/rest-box/art/v1/creatures/fish.svg',
  '/public/rest-box/art/v1/creatures/puppy.svg',
  '/public/rest-box/art/v1/creatures/dog.svg',
  '/public/rest-box/art/v1/creatures/stoatA.svg',
  '/public/rest-box/art/v1/creatures/stoat.svg',
  '/public/rest-box/art/v1/creatures/redPanda.svg',
  '/public/rest-box/art/v1/props/book.svg',
  '/public/rest-box/art/v1/props/flower.svg',
  '/public/rest-box/art/v1/props/cookie.svg',
  '/public/rest-box/art/v1/props/tea.svg',
  '/public/rest-box/art/v1/props/letter.svg',
  '/public/rest-box/art/v1/assets/extra-rocker.svg',
  '/public/rest-box/art/v1/assets/extra-telescope.svg',
  '/public/rest-box/art/v1/assets/extra-lace-table.svg',
  '/public/rest-box/art/v1/assets/extra-teapot.svg',
  '/public/rest-box/art/v1/assets/extra-letter-shelf.svg',
  '/public/rest-box/art/v1/assets/extra-moon-cushion.svg',
  '/public/rest-box/art/v1/assets/extra-gramophone.svg',
  '/public/rest-box/art/v1/assets/extra-laptop.svg',
  '/public/rest-box/art/v1/assets/extra-computer.svg',
  '/public/rest-box/art/v1/assets/extra-pen.svg',
  '/public/rest-box/art/v1/assets/extra-pencilcup.svg',
  '/public/rest-box/art/v1/assets/extra-notebook.svg',
  '/public/rest-box/art/v1/assets/extra-typewriter.svg',
  '/public/rest-box/art/v1/assets/extra-radio.svg',
]);

async function putCurrentCache(request, response) {
  if (!response?.ok) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await putCurrentCache(request, response);
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
  )));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/mcp')
    || url.pathname.startsWith('/.well-known/')
    || ['/login', '/logout', '/mailbox'].includes(url.pathname)) return;

  if (url.pathname.startsWith('/public/rest-box/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (
      await caches.match(request) || caches.match('/index.html')
    )));
    return;
  }

  const generationSensitiveAsset = url.pathname.startsWith('/public/')
    && (request.destination === 'script' || request.destination === 'style');
  if (generationSensitiveAsset) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) void putCurrentCache(request, response);
    return response;
  })));
});
