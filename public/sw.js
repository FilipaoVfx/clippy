/**
 * Clippy Service Worker
 *
 * Update strategy designed so a NEW DEPLOY never requires the user to
 * reinstall the PWA:
 *   - install:  precache the app shell, then skipWaiting() so the new SW
 *               activates immediately instead of waiting for all tabs to close.
 *   - activate: delete stale caches and clients.claim() so the new SW controls
 *               open pages right away.
 *   - fetch:    navigations use network-first (always pick up fresh HTML after
 *               a deploy, fall back to cache when offline); same-origin static
 *               assets use stale-while-revalidate (instant load + background
 *               refresh). WebSocket/health/cross-origin requests are bypassed.
 *
 * BUILD_ID is replaced at deploy time with the commit SHA (see the deploy
 * workflow). When it changes, the browser sees new SW bytes, installs the new
 * version, and swaps it in transparently — the home-screen icon stays put.
 */
const BUILD_ID = '__BUILD_ID__';
const CACHE = `clippy-${BUILD_ID}`;

// App shell: everything needed to render the UI offline.
const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/ws.js',
  '/js/ui.js',
  '/js/app.js',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individual failures (e.g. a missing optional asset) must not abort install.
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('clippy-') && k !== CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Allow the page to trigger an immediate activation of a waiting SW.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GETs. Never touch WebSocket upgrades, the health
  // probe, POST/relay traffic, or cross-origin (fonts) requests.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/ws' || url.pathname === '/health') return;

  // Navigations → network-first so a fresh deploy is always served when online.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match(req)) || (await cache.match('/index.html'));
        }
      })()
    );
    return;
  }

  // Static assets → stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })()
  );
});
