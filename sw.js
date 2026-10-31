/*
---ARU-LAB.SPACE---ALMATY---2026---
Progressive Web App Service Worker for offline caching and resource management.
---chat.aru-lab.space---PWA---
*/
const APP_VERSION = '1.0.6';
const CACHE_PREFIX = 'aru-ai';
const CACHE_NAME = `${CACHE_PREFIX}-${APP_VERSION}`;
const CDN_CACHE_PREFIX = `${CACHE_PREFIX}-cdn`;
const CDN_CACHE = `${CDN_CACHE_PREFIX}-v1`;
const CDN_NETWORK_TIMEOUT = 3500;

// Third-party runtime dependencies stay on their CDNs: vendoring them would add
// ~6 MB to the repo. They are cached in the browser on first use instead, so a
// network-first strategy still gives fresh versions and a working offline mode.
const CDN_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'cdn.sheetjs.com',
  'accounts.google.com'
]);

// Loaded lazily (only when a PDF is opened, the DB starts or math is rendered),
// so a plain page load does not put them into the cache. Warming them up makes
// offline mode complete without shipping them inside the repository.
const KATEX_FONT_VARIANTS = [
  'AMS-Regular', 'Caligraphic-Bold', 'Caligraphic-Regular', 'Fraktur-Bold',
  'Fraktur-Regular', 'Main-Bold', 'Main-BoldItalic', 'Main-Italic', 'Main-Regular',
  'Math-BoldItalic', 'Math-Italic', 'SansSerif-Bold', 'SansSerif-Italic',
  'SansSerif-Regular', 'Script-Regular', 'Size1-Regular', 'Size2-Regular',
  'Size3-Regular', 'Size4-Regular', 'Typewriter-Regular'
];
const CDN_WARMUP_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  ...KATEX_FONT_VARIANTS.map(name => `https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_${name}.woff2`)
];

// Pre-cache all local runtime assets that participate in the app shell.
// This prevents "mixed versions" when a new release is installed.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './rules.html',
  './css/style.css',
  './css/desktop.css',
  './css/desktop-notes.css',
  './data/info_en.html',
  './data/info_kz.html',
  './data/info_ru.html',
  './js/app.js',
  './js/modules/aruState.js',
  './js/modules/auth.js',
  './js/modules/canvas.js',
  './js/modules/chatController.js',
  './js/modules/db.js',
  './js/modules/desktop.js',
  './js/modules/desktopNotes.js',
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
  './js/vendor/purify.min.js',
  './lang/en.json',
  './lang/desktop.json',
  './lang/kk.json',
  './lang/plugins.json',
  './lang/ru.json',
  './plugins/task/task.css',
  './plugins/task/task.html',
  './plugins/task/task.js',
  './plugins/fit-care/fit-care.css',
  './plugins/fit-care/fit-care.html',
  './plugins/fit-care/fit-care.js',
  './plugins/fit-care/fit-care-calendar.js',
  './plugins/fit-care/fit-care-dashboard.js',
  './plugins/fit-care/fit-care-plan.js',
  './plugins/fit-care/fit-care-health.js',
  './plugins/fit-care/fit-care-settings.js',
  './plugins/fit-care/fit-care-i18n.json',
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

// Opaque (no-cors) CDN responses have ok === false but are still valid assets.
async function putRuntimeCache(cache, request, response) {
  if (!response || response.type === 'error') return;
  if (!response.ok && response.type !== 'opaque') return;
  try {
    await cache.put(request, response.clone());
  } catch (error) {
    console.warn('SW: runtime cache write failed', request.url, error);
  }
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

function isCdnRequest(requestUrl) {
  return CDN_HOSTS.has(requestUrl.hostname);
}

// Network-first for CDN assets: online users always get the current version,
// offline or slow networks fall back to the cached copy.
async function networkFirstCdn(request) {
  // Range requests (PDF.js) must not be cached: partial responses are rejected.
  if (request.headers.has('range')) return fetch(request);

  const cache = await caches.open(CDN_CACHE);
  const cachedResponse = await cache.match(request);

  const networkRequest = fetch(request).then(async (response) => {
    await putRuntimeCache(cache, request, response);
    return response;
  });
  // Avoid an unhandled rejection when the timeout wins the race.
  networkRequest.catch(() => {});

  if (!cachedResponse) return networkRequest;

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), CDN_NETWORK_TIMEOUT));
  try {
    const winner = await Promise.race([networkRequest, timeout]);
    if (!winner) return cachedResponse;
    if (winner.ok || winner.type === 'opaque') return winner;
    return cachedResponse;
  } catch (error) {
    return cachedResponse;
  }
}

async function warmCdnCache() {
  const connection = self.navigator && self.navigator.connection;
  // The app shell already loads several megabytes of libraries; only a really
  // constrained connection should skip the extra ~1.9 MB offline pack.
  if (connection && (connection.saveData || /^(slow-)?2g$/.test(connection.effectiveType || ''))) {
    return;
  }

  const cache = await caches.open(CDN_CACHE);
  for (const url of CDN_WARMUP_URLS) {
    try {
      if (await cache.match(url)) continue;
      const response = await fetch(url, { mode: 'cors' });
      await putRuntimeCache(cache, url, response);
    } catch (error) {
      console.warn(`SW: warm-up failed for ${url}`, error);
    }
  }
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
        // Runtime CDN cache outlives app releases so offline mode survives updates.
        if (cacheName.startsWith(CDN_CACHE_PREFIX)) return Promise.resolve();
        if (cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME) {
          return caches.delete(cacheName);
        }
        return Promise.resolve();
      })
    );

    await self.clients.claim();
    await warmCdnCache();
  })());
});

// Intercepts local app requests and always tries the network first.
// This keeps browser-tab users and installed PWA users on the same fresh version.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);

  if (isCdnRequest(requestUrl)) {
    event.respondWith(networkFirstCdn(event.request));
    return;
  }

  if (!isSameOriginAppRequest(requestUrl)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, { isNavigation: true }));
    return;
  }

  event.respondWith(networkFirst(event.request));
});
