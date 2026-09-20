const CACHE = 'elementera-coast-source-v01';
const ASSETS = [
  '/', '/manifest.json', '/public/app.js',
  '/public/core/dom.js', '/public/core/event-spine.js', '/public/core/icons.js',
  '/public/core/router.js', '/public/core/storage.js',
  '/public/styles/tokens.css', '/public/styles/shell.css', '/public/styles/chat.css',
  '/public/styles/features.css', '/public/styles/desk.css'
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
