// SwasthyaSetu AI — Privacy-Preserving Offline App Shell Service Worker
// Caches ONLY static application shell assets.
// NEVER caches /api/* routes or sensitive patient health records in CacheStorage.

const SHELL_CACHE_NAME = 'swasthyasetu-shell-v1';
const STATIC_ASSETS = ['/', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== SHELL_CACHE_NAME) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // PRIVACY GUARD: Never cache API routes, auth endpoints, or non-GET requests in Service Worker CacheStorage
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('firestore') ||
    url.pathname.includes('googleapis')
  ) {
    return;
  }

  // Network-first with static shell fallback for navigation & static assets
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (
          response &&
          response.status === 200 &&
          (url.pathname === '/' ||
            url.pathname.startsWith('/_next/static/') ||
            url.pathname.endsWith('.svg') ||
            url.pathname.endsWith('.png'))
        ) {
          const cloned = response.clone();
          caches.open(SHELL_CACHE_NAME).then((cache) => cache.put(request, cloned));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const rootShell = await caches.match('/');
          if (rootShell) return rootShell;
        }
        return new Response('Offline — Application shell active', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      })
  );
});
