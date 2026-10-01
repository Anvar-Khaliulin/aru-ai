/*
---ARU-LAB.SPACE---ALMATY---2026---
Progressive Web App Service Worker for offline caching and resource management.
---chat.aru-lab.space---PWA---
*/
const APP_VERSION = '0.9.5';
const CACHE_PREFIX = 'aru-ai';
const CACHE_NAME = `${CACHE_PREFIX}-${APP_VERSION}`;

// Pre-cache all local runtime assets that participate in the app shell.
// This prevents "mixed versions" when a new release is installed.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './rules.html',
  './css/style.css',
  './data/info_en.html',
  './data/info_kz.html',
  './data/info_ru.html',
  './js/app.js',
  './js/modules/aruState.js',
  './js/modules/auth.js',
  './js/modules/canvas.js',
  './js/modules/chatController.js',
  './js/modules/db.js',
  './js/modules/files.js',
  './js/modules/heuristics.js',
  './js/modules/library.js',
  './js/modules/llm.js',
  './js/modules/network.js',
  './js/modules/pluginManager.js',
  './js/modules/remoteStorage.js',
  './js/modules/search.js',
  './js/modules/semantics.js',
  './js/modules/settingsController.js',
  './js/modules/tools.js',
  './js/modules/transferController.js',
  './js/modules/triggers.js',
  './js/modules/ui.js',
  './js/modules/wizardController.js',
  './lang/en.json',
  './lang/kk.json',
  './lang/plugins.json',
  './lang/ru.json',
  './plugins/task/task.css',
  './plugins/task/task.html',
  './plugins/task/task.js',
  './media/emotions/angry.png',
  './media/emotions/cool.png',
  './media/emotions/crazy.png',
  './media/emotions/cry.png',
  './media/emotions/geek.png',
  './media/emotions/happy.png',
  './media/emotions/love.png',
  './media/emotions/normal.png',
  './media/emotions/oh.png',
  './media/emotions/please.png',
  './media/emotions/rock.png',
  './media/emotions/sad.png',
  './media/emotions/sleep.png',
  './media/emotions/thinking.png',
  './media/emotions/wow.png',
  './media/int/apple-touch-icon.png',
  './media/int/aru.png',
  './media/int/favicon-96x96.png',
  './media/int/favicon.ico',
  './media/int/favicon.svg',
  './media/int/web-app-manifest-192x192.png',
  './media/int/web-app-manifest-512x512.png'
];

const APP_PATH_PREFIXES = [
  '/css/',
  '/data/',
  '/js/',
  '/lang/',
  '/media/',
  '/plugins/'
];

async function putInCache(cache, request, response) {
  if (!response || !response.ok || response.type === 'error') return;
  await cache.put(request, response.clone());
}

async function precacheAssets() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.all(ASSETS_TO_CACHE.map(async (assetUrl) => {
    try {
      const request = new Request(assetUrl, { cache: 'reload' });
      const response = await fetch(request);
      await putInCache(cache, assetUrl, response);
    } catch (error) {
      console.warn(`SW: Failed to pre-cache ${assetUrl}`, error);
    }
  }));
}

function isSameOriginAppRequest(requestUrl) {
  if (requestUrl.origin !== self.location.origin) return false;
  if (requestUrl.pathname === '/sw.js') return false;
  if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html' || requestUrl.pathname === '/manifest.json' || requestUrl.pathname === '/rules.html') {
    return true;
  }
  return APP_PATH_PREFIXES.some(prefix => requestUrl.pathname.startsWith(prefix));
}

async function getOfflineShell() {
  return (
    await caches.match('./index.html') ||
    await caches.match('/index.html') ||
    await caches.match('./')
  );
}

async function networkFirst(request, { isNavigation = false } = {}) {
  try {
    const freshResponse = await fetch(request, { cache: 'no-cache' });
    if (freshResponse && freshResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      await putInCache(cache, request, freshResponse);
    }
    return freshResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    if (isNavigation) {
      const offlineShell = await getOfflineShell();
      if (offlineShell) return offlineShell;
    }

    throw error;
  }
}

// Handles the Service Worker installation process
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precacheAssets());
});

// Handles the Service Worker activation and stale cache cleanup process
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames.map((cacheName) => {
        if (cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME) {
          return caches.delete(cacheName);
        }
        return Promise.resolve();
      })
    );

    await self.clients.claim();
  })());
});

// Intercepts local app requests and always tries the network first.
// This keeps browser-tab users and installed PWA users on the same fresh version.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (!isSameOriginAppRequest(requestUrl)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, { isNavigation: true }));
    return;
  }

  event.respondWith(networkFirst(event.request));
});
