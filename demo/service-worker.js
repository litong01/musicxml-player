const CACHE_NAME = 'musicxml-player-v2b5b149';
const urlsToCache = [
  '/',
  '/demo.mjs',
  '/build/musicxml-player.mjs',
  '/build/musicxml-player.css',
  '/icon-192.png',
  '/icon-512.png',
];

// Install service worker and cache resources
self.addEventListener('install', (event) => {
  // Skip waiting to activate new service worker immediately
  self.skipWaiting();

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(
          urlsToCache.map((url) => {
            return new Request(url, { credentials: 'same-origin' });
          }),
        );
      })
      .catch((error) => {
        console.log('Cache addAll error:', error);
      }),
  );
});

// Fetch from cache first, then network
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Don't cache external resources (like CORS proxies, Google Drive, etc.)
  // Only cache same-origin requests
  if (requestUrl.origin !== location.origin) {
    // For external URLs, just fetch without caching
    event.respondWith(fetch(event.request));
    return;
  }

  // Use network-first for HTML to always get latest version
  if (
    event.request.headers.get('accept')?.includes('text/html') ||
    requestUrl.pathname.endsWith('.html') ||
    requestUrl.pathname === '/'
  ) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Update cache with latest HTML
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fall back to cache if network fails
          return caches.match(event.request);
        }),
    );
    return;
  }

  // For same-origin requests (non-HTML), use cache-first strategy
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Cache hit - return response
      if (response) {
        return response;
      }
      return fetch(event.request);
    }),
  );
});

// Clean up old caches
self.addEventListener('activate', (event) => {
  // Take control of all clients immediately
  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          }),
        );
      }),
      self.clients.claim(),
    ]),
  );
});
