const VERSION = "v8.1.0-question-shards";
const STATIC_CACHE = `taleela-static-${VERSION}`;
const PAGE_CACHE = `taleela-pages-${VERSION}`;

// Keep the initial shell small. The 10k+ question bank is intentionally not
// precached; only the host downloads it when a round actually needs it.
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/ui.js",
  "./js/firebase.js",
  "./js/categories.js",
  "./js/room-store.js",
  "./assets/home.webp",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => ![STATIC_CACHE, PAGE_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function putIfUsable(cacheName, request, response) {
  if (!response || !response.ok || response.type === "opaque") return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, timeoutMs = 3000) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("NETWORK_TIMEOUT")), timeoutMs));
  try {
    const response = await Promise.race([fetch(request), timeout]);
    return putIfUsable(PAGE_CACHE, request, response);
  } catch {
    const cached = await caches.match(request, {ignoreSearch: true});
    if (cached) return cached;
    if (request.mode === "navigate") return caches.match("./index.html");
    throw new Error("OFFLINE_RESOURCE_UNAVAILABLE");
  }
}


async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  return putIfUsable(STATIC_CACHE, request, response);
}

async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => putIfUsable(STATIC_CACHE, request, response))
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const response = await network;
  if (response) return response;
  throw new Error("OFFLINE_RESOURCE_UNAVAILABLE");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // HTML must check the network so deployments are discovered quickly.
  if (request.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/manifest.webmanifest")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Never serve the service worker itself from its own cache.
  if (url.pathname.endsWith("/sw.js")) {
    event.respondWith(fetch(request, {cache: "no-store"}));
    return;
  }

  // Versioned question JSON is immutable. After the first request it should
  // never wait for the network again on this device.
  if (url.pathname.includes("/questions/v8.1.0/") && url.pathname.endsWith(".json")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // JS/CSS/images/fonts respond immediately from cache after first use while
  // a fresh copy is checked in the background.
  if (["script", "style", "image", "font"].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }

  event.respondWith(networkFirst(request));
});
