const CACHE = 'elementera-coast-source-v05';
const ASSETS = [
  "/",
  "/manifest.json",
  "/public/app.js",
  "/public/content/island-letter.js",
  "/public/core/api.js",
  "/public/core/dom.js",
  "/public/core/event-spine.js",
  "/public/core/icons.js",
  "/public/core/model-format.js",
  "/public/core/router.js",
  "/public/core/storage.js",
  "/public/core/stream-format.js",
  "/public/core/themes.js",
  "/public/features/chat-state.js",
  "/public/features/chat.js",
  "/public/features/chat/chat-actions.js",
  "/public/features/chat/chat-attachments.js",
  "/public/features/chat/chat-context.js",
  "/public/features/chat/chat-conversations.js",
  "/public/features/chat/chat-generation.js",
  "/public/features/chat/chat-local-time.js",
  "/public/features/chat/chat-model-metadata.js",
  "/public/features/chat/chat-profile.js",
  "/public/features/chat/chat-render.js",
  "/public/features/chat/chat-request-context.js",
  "/public/features/chat/chat-stream-flow.js",
  "/public/features/chat/chat-stream.js",
  "/public/features/chat/chat-title-landing.js",
  "/public/features/chat/chat-tool-status.js",
  "/public/features/chat/chat-tools.js",
  "/public/features/desk.js",
  "/public/features/dev-hands.js",
  "/public/features/external-entry.js",
  "/public/features/human-thought.js",
  "/public/features/memory.js",
  "/public/features/memory/memory-actions.js",
  "/public/features/memory/memory-client.js",
  "/public/features/memory/memory-constants.js",
  "/public/features/memory/memory-custom-view.js",
  "/public/features/memory/memory-format.js",
  "/public/features/memory/memory-global-excerpt-view.js",
  "/public/features/memory/memory-library-view.js",
  "/public/features/memory/memory-pocket-view.js",
  "/public/features/memory/memory-soil-view.js",
  "/public/features/models.js",
  "/public/features/models/models-actions.js",
  "/public/features/models/models-client.js",
  "/public/features/models/models-constants.js",
  "/public/features/models/models-format.js",
  "/public/features/models/models-quick-picker.js",
  "/public/features/models/models-view.js",
  "/public/features/shell.js",
  "/public/features/source-pages.js",
  "/public/features/toolroom.js",
  "/public/features/widgets.js",
  "/public/mailbox-entry.js",
  "/public/mailbox.js",
  "/public/styles/chat.css",
  "/public/styles/daily.css",
  "/public/styles/desk.css",
  "/public/styles/dev-hands.css",
  "/public/styles/external-entry.css",
  "/public/styles/features.css",
  "/public/styles/mailbox.css",
  "/public/styles/model-metadata.css",
  "/public/styles/shell.css",
  "/public/styles/source-pages.css",
  "/public/styles/tokens.css",
  "/public/styles/toolroom.css"
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => undefined));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone())).catch(() => undefined);
    return response;
  }).catch(() => caches.match(event.request)));
});
