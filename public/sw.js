// Hand-rolled, no build step — deliberately outside `.next/static/chunks`, so
// `scripts/verify-build.mjs`'s parse-check never touches this file.
//
// Deploy safety without extra bookkeeping: `/_next/static/*` is cache-first but content-hashed
// per build, so a new deploy is always a cache MISS there, never stale. Every navigation is
// network-first, so the cache is only a fallback when the network is actually down. An old SW
// left running across a deploy is fine — its logic doesn't know or care about hashes.
//
// Deliberately NOT covered: soft client-side <Link> navigation while offline. Next's RSC
// transition fetches use `mode: "same-origin"`, not `"navigate"`, so they're untouched here and
// fail the same way they do with no service worker at all. Only hard loads / reopens of a
// previously-visited URL are made offline-capable.
const SW_VERSION = "v1";
const STATIC_CACHE = `tripmate-static-${SW_VERSION}`;
const PAGES_CACHE = `tripmate-pages-${SW_VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PAGES_CACHE).then((cache) => cache.addAll([OFFLINE_URL])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([STATIC_CACHE, PAGES_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept POST/PATCH/DELETE (trip edits, generation, ...)

  const url = new URL(request.url);

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  // Everything else (API calls, map tiles, images) is left untouched — this app's existing
  // fail-soft conventions already degrade those gracefully when the network is down.
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match(OFFLINE_URL));
  }
}
