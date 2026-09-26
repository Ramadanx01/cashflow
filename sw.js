/* Local-first app shell cache. User data is stored only in IndexedDB. */
const CACHE_NAME = 'cashflow-app-v10';
const CACHE_PREFIX = 'cashflow-app-';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './storage.js',
  './drive-backup.js',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/vendor/bootstrap/bootstrap.rtl.min.css',
  './assets/vendor/bootstrap/bootstrap.bundle.min.js',
  './assets/vendor/sweetalert2/sweetalert2.min.css',
  './assets/vendor/sweetalert2/sweetalert2.all.min.js',
  './assets/vendor/unicons/line.css',
  './assets/vendor/unicons/solid.css',
  './assets/vendor/fonts/cairo.css',
  './assets/vendor/fonts/cairo-400.ttf',
  './assets/vendor/fonts/cairo-600.ttf',
  './assets/vendor/fonts/cairo-700.ttf',
  './assets/vendor/fonts/cairo-800.ttf',
  ...Array.from({ length: 21 }, (_, index) => `./assets/vendor/fonts/line/unicons-${index}.woff2`),
  ...Array.from({ length: 4 }, (_, index) => `./assets/vendor/fonts/solid/unicons-${index}.woff2`)
];
const APP_ASSET_PATHS = new Set(APP_SHELL.map(asset => new URL(asset, self.location.href).pathname));
const TEXT_ASSETS_TO_CHECK = ['./index.html', './style.css', './app.js', './storage.js', './drive-backup.js', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(cacheName => {
      if (cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME) return caches.delete(cacheName);
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === 'CHECK_APP_SHELL' && event.ports[0]) {
    event.waitUntil(checkAppShellForChanges().then(changed => event.ports[0].postMessage({ changed })));
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  if (APP_ASSET_PATHS.has(requestUrl.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request, fallbackAsset) {
  try {
    const response = await fetch(new Request(request, { cache: 'no-store' }));
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
      return response;
    }
  } catch (error) {
    // Fall through to the last successfully cached app shell.
  }
  return (await caches.match(fallbackAsset)) || Response.error();
}

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return Response.error();
  }
}

async function checkAppShellForChanges() {
  const cache = await caches.open(CACHE_NAME);
  let changed = false;
  for (const asset of TEXT_ASSETS_TO_CHECK) {
    const assetUrl = new URL(asset, self.location.href).href;
    const freshResponse = await fetch(new Request(assetUrl, { cache: 'no-store' }));
    if (!freshResponse.ok) continue;
    const previousResponse = await cache.match(assetUrl);
    const freshText = await freshResponse.clone().text();
    const previousText = previousResponse ? await previousResponse.clone().text() : null;
    if (freshText !== previousText) changed = true;
    await cache.put(assetUrl, freshResponse.clone());
  }
  return changed;
}