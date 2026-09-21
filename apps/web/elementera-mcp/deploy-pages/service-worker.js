// PWA shell cache for the current Coast application surface.
const CACHE_NAME = 'elementera-coast-app-87';
const CORE = Object.freeze([
  '/',
  '/index.html',
  '/manifest.json',
  '/public/styles/tokens.css?v=coast-app-87',
  '/public/styles/shell.css?v=coast-app-87',
  '/public/styles/chat.css?v=coast-app-87',
  '/public/styles/mcp-letter.css?v=coast-app-87',
  '/public/styles/rikkahub.css?v=coast-app-87',
  '/public/styles/features.css?v=coast-app-87',
  '/public/styles/cross-window.css',
  '/public/styles/desk.css?v=coast-app-87',
  '/public/styles/dev-hands.css?v=coast-app-87',
  '/public/styles/daily.css',
  '/public/styles/model-metadata.css',
  '/public/app.js?v=coast-app-87',
  '/public/core/api.js',
  '/public/core/danger.js',
  '/public/core/dom.js',
  '/public/core/event-spine.js',
  '/public/core/icons.js',
  '/public/core/model-format.js',
  '/public/core/router.js',
  '/public/core/stream-format.js',
  '/public/core/storage.js',
  '/public/content/island-letter.js',
  '/public/features/chat-state.js',
  '/public/features/chat.js',
  '/public/features/chat/chat-actions.js',
  '/public/features/chat/chat-attachments.js',
  '/public/features/chat/chat-context.js',
  '/public/features/chat/chat-furniture.js',
  '/public/features/chat/chat-conversations.js',
  '/public/features/chat/chat-generation.js',
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
  '/public/features/shell.js',
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
