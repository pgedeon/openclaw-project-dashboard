/**
 * Enhanced Service Worker for OpenClaw Dashboard
 * 
 * Features:
 * - Cache static assets (HTML, CSS, JS, fonts)
 * - Cache API responses (task data) with appropriate TTL
 * - Background sync for offline mutations
 * - Network-first strategy for API calls, cache-first for static assets
 * - Handle update notifications
 */

const CACHE_NAME = 'openclaw-dashboard-v2';
const RUNTIME_CACHE = 'openclaw-dashboard-runtime-v2';
const API_CACHE = 'openclaw-dashboard-api-v2';

// Static assets to precache on install
const STATIC_ASSETS = [
  '/',
  // CSS will be inlined in HTML but we add fonts
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap'
];

// API endpoints to cache (with TTL in milliseconds)
const API_CACHE_CONFIG = {
  '/api/tasks': {
    ttl: 30000, // 30 seconds
    cacheName: API_CACHE
  },
  '/api/agents': {
    ttl: 60000, // 1 minute
    cacheName: API_CACHE
  }
};

// Background sync queue name
const SYNC_QUEUE = 'background-sync-queue';

self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Precaching static assets');
        return cache.addAll(STATIC_ASSETS).catch(err => {
          console.warn('[ServiceWorker] Failed to precache some assets:', err);
          // Still complete installation even if some assets fail (e.g., fonts offline)
        });
      })
      .then(() => {
        // Activate immediately
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating...');
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              return name !== CACHE_NAME &&
                     name !== RUNTIME_CACHE &&
                     name !== API_CACHE &&
                     name.startsWith('openclaw-dashboard-');
            })
            .map((name) => {
              console.log('[ServiceWorker] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      }),
      // Claim clients
      self.clients.claim()
    ])
  );
});

/**
 * Fetch event - main routing logic
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip chrome-extension and non-GET requests
  if (request.url.includes('chrome-extension://') || request.method !== 'GET') {
    return;
  }

  // Route based on URL pattern
  if (url.pathname.startsWith('/api/')) {
    // API requests - network first, falling back to cache
    event.respondWith(handleApiFetch(request));
  } else if (isStaticAsset(url)) {
    // Static assets - cache first, falling back to network
    event.respondWith(handleStaticFetch(request));
  } else {
    // HTML pages - network first, falling back to cache
    event.respondWith(handlePageFetch(request));
  }
});

/**
 * Determine if URL is a static asset
 */
function isStaticAsset(url) {
  const path = url.pathname;
  return (
    path.endsWith('.css') ||
    path.endsWith('.js') ||
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.jpeg') ||
    path.endsWith('.gif') ||
    path.endsWith('.svg') ||
    path.endsWith('.woff') ||
    path.endsWith('.woff2') ||
    path.endsWith('.ttf') ||
    path.endsWith('.eot') ||
    (url.hostname.includes('googleapis') && path.includes('fonts')) ||
    (url.hostname.includes('gstatic') && path.includes('fonts'))
  );
}

/**
 * Handle API fetches - network first with runtime caching
 */
async function handleApiFetch(request) {
  const cacheName = API_CACHE;
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  // If we're online, try network first
  if (navigator.onLine) {
    try {
      const networkResponse = await fetch(request);

      if (networkResponse.ok) {
        // Cache successful responses
        cache.put(request, networkResponse.clone()).catch(() => {});
        return networkResponse;
      }

      // If network fails but we have cached, return cached
      if (cachedResponse) {
        return cachedResponse;
      }

      return networkResponse; // Return error response
    } catch (error) {
      console.warn('[ServiceWorker] API fetch failed, using cache:', error);
      if (cachedResponse) {
        return cachedResponse;
      }
      // Return offline fallback
      return createOfflineResponse();
    }
  }

  // Offline - use cache if available
  if (cachedResponse) {
    return cachedResponse;
  }

  return createOfflineResponse();
}

/**
 * Handle static asset fetches - cache first, network fallback
 */
async function handleStaticFetch(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch (error) {
    console.warn('[ServiceWorker] Static fetch failed:', error);
    // Return empty response or fallback
    return new Response('Resource not available offline', { status: 503 });
  }
}

/**
 * Handle page fetches - network first, cache fallback
 */
async function handlePageFetch(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch (error) {
    console.warn('[ServiceWorker] Page fetch failed, using cache:', error);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    return createOfflinePage();
  }
}

/**
 * Create an offline response for API calls
 */
function createOfflineResponse() {
  return new Response(
    JSON.stringify({
      error: 'offline',
      message: 'You are currently offline. Changes will be synced when you reconnect.',
      tasks: []
    }),
    {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

/**
 * Create an offline page for navigation
 */
function createOfflinePage() {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Offline - OpenClaw Dashboard</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: #f4f1ff;
            color: #1f1f2b;
          }
          .container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 12px 40px rgba(27,30,49,0.12);
            max-width: 400px;
          }
          h1 { margin: 0 0 16px; color: #ef4444; }
          p { color: #6b7280; margin: 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>You're Offline</h1>
          <p>Some features may be limited. Don't worry - your changes are queued and will sync when you reconnect.</p>
        </div>
      </body>
    </html>
  `;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' }
  });
}

/**
 * Background sync event
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync-tasks') {
    console.log('[ServiceWorker] Background sync triggered');
    event.waitUntil(handleBackgroundSync());
  }
});

/**
 * Handle background sync operations
 */
async function handleBackgroundSync() {
  const syncQueue = await getSyncQueue();
  
  for (const item of syncQueue) {
    try {
      const response = await fetch(item.request);
      if (response.ok) {
        await removeSyncItem(item.id);
        console.log('[ServiceWorker] Synced queued operation:', item.method, item.url);
      } else if (response.status >= 500) {
        // Server error - keep in queue for retry later
        console.warn('[ServiceWorker] Server error, will retry:', response.status);
      } else if (response.status === 409) {
        // Conflict - keep in queue for conflict resolution
        console.warn('[ServiceWorker] Conflict detected, waiting for resolution');
      } else {
        // Other errors - could be removed or kept depending on policy
        await removeSyncItem(item.id);
        console.warn('[ServiceWorker] Failed with status', response.status, 'removed from queue');
      }
    } catch (error) {
      console.error('[ServiceWorker] Sync failed:', error);
      // Keep item for next retry
    }
  }
}

/**
 * Get all items from IndexedDB sync queue
 */
async function getSyncQueue() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('openclaw-dashboard-sync', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sync')) {
        db.createObjectStore('sync', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('sync', 'readonly');
      const store = tx.objectStore('sync');
      const getAll = store.getAll();
      getAll.onsuccess = () => resolve(getAll.result || []);
      getAll.onerror = () => reject(getAll.error);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove a sync item from the queue
 */
async function removeSyncItem(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('openclaw-dashboard-sync', 1);
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('sync', 'readwrite');
      const store = tx.objectStore('sync');
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Push a sync item to the queue (used by page)
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'REGISTER_BACKGROUND_SYNC') {
    const { method, url, body } = event.data;
    event.waitUntil(
      (async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('openclaw-dashboard-sync', 1);
          request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('sync')) {
              db.createObjectStore('sync', { keyPath: 'id', autoIncrement: true });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const item = {
          method,
          url,
          body: body || null,
          timestamp: Date.now()
        };
        await new Promise((resolve, reject) => {
          const tx = db.transaction('sync', 'readwrite');
          tx.objectStore('sync').add(item);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      })()
    );
  }

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
