const K = "mf-5";
const TK = "mf-tiles";
const TILE_MAX = 200;

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(K).then(c => c.addAll([
    "./index.html",
    "./icon-512.png",
    "./apple-touch-icon.png",
    "./manifest.webmanifest",
  ])));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(x => x !== K && x !== TK).map(x => caches.delete(x)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.endsWith("mf-sw.js")) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
    return;
  }
  if (e.request.mode === "navigate") {
    e.respondWith(page(e.request));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(asset(e.request));
    return;
  }
  if (isTile(url)) e.respondWith(tile(e.request));
});

function isTile(u) {
  return u.hostname === "tile.openstreetmap.org"
    || (u.hostname.startsWith("mt") && u.hostname.endsWith(".google.com"));
}

async function page(req) {
  const cache = await caches.open(K);
  const cached = await cache.match("./index.html");
  const fresh = fetch(req).then(res => {
    if (res.ok) cache.put("./index.html", res.clone());
    return res;
  }).catch(() => cached);
  return cached || fresh;
}

async function asset(req) {
  const cache = await caches.open(K);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function tile(req) {
  const cache = await caches.open(TK);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") {
    cache.put(req, res.clone());
    const keys = await cache.keys();
    if (keys.length > TILE_MAX) {
      await Promise.all(keys.slice(0, keys.length - TILE_MAX).map(k => cache.delete(k)));
    }
  }
  return res;
}
