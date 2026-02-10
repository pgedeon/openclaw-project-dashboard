// service-worker.js - Simple service worker for project-dashboard
const CACHE_NAME = 'project-dashboard-v1';
const ASSETS = [
  '/',
  '/project-dashboard.html',
  '/project-dashboard.css',
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {});
    })
  );
  // Force a skip waiting to activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cache) => {
            return cache !== CACHE_NAME;
          })
          .map((cache) => {
            return caches.delete(cache);
          })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - serve cached content when possible
self.addEventListener('fetch', (event) => {
  if (!event.request.url.includes('chrome-extension://')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          // Only cache if status is OK and content-type is HTML or CSS
          if (
            networkResponse.ok &&
            (event.request.url.endsWith('.html') || event.request.url.endsWith('.css'))
          ) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
            });
          }
          return networkResponse;
        });

        return cached || fetchPromise;
      })
    );
  }
});

// Message event - allow communication between pages
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});