/* Media Player Classic service worker.
 * - App shell: network-first navigation with offline fallback.
 * - Hashed build assets, icons and cover art: cache-first (they never change).
 * - API responses and audio streams are never cached here (HLS handles buffering).
 */
const VERSION = "mpc-v1";
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const COVERS = `${VERSION}-covers`;
const MAX_COVERS = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    cache.put(request, res.clone());
    if (cacheName === COVERS) trim(COVERS, MAX_COVERS);
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/", copy));
          return res;
        })
        .catch(async () => (await caches.match("/")) || Response.error()),
    );
    return;
  }

  if (url.pathname.includes("/covers/") && /\.(jpg|jpeg|png|webp)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, COVERS));
    return;
  }

  if (url.origin === location.origin && (url.pathname.startsWith("/assets/") || /^\/icon/.test(url.pathname))) {
    event.respondWith(cacheFirst(request, STATIC));
  }
});
