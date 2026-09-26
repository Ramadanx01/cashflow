/* ==========================================================================
   Axis & Fawry Cashflow Manager - PWA Service Worker (Offline & Cache)
   ========================================================================== */

// This cache stores the last working offline copy of the application.
const CACHE_NAME = 'cashflow-app-v3';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png'
];

const OPTIONAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.rtl.min.css',
  'https://unicons.iconscout.com/release/v4.0.8/css/line.css',
  'https://unicons.iconscout.com/release/v4.0.8/css/solid.css',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL).then(() => Promise.all(
        OPTIONAL_ASSETS.map(asset => cache.add(asset).catch(err => {
          console.warn('Optional asset could not be cached:', asset, err);
        }))
      ));
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data && event.data.type === 'CHECK_APP_SHELL') {
    event.waitUntil(
      checkAppShellForChanges().then(changed => {
        if (event.ports[0]) event.ports[0].postMessage({ changed });
      })
    );
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, './index.html'));
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isAppShellAsset = APP_SHELL.some(asset => {
    return new URL(asset, self.location.href).pathname === requestUrl.pathname;
  });

  event.respondWith(isAppShellAsset ? networkFirst(event.request) : cacheFirst(event.request));
});

async function networkFirst(request, fallbackRequest) {
  try {
    const freshRequest = new Request(request, { cache: 'no-store' });
    const response = await fetch(freshRequest);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(fallbackRequest || request, response.clone());
    }
    return response;
  } catch (error) {
    return caches.match(fallbackRequest || request).then(response => response || Response.error());
  }
}

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
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
  const filesToCheck = ['./index.html', './style.css', './app.js', './manifest.json'];

  for (const asset of filesToCheck) {
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
