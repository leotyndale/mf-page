const K = "mf";
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(K).then(c => c.addAll(["./index.html", "./mf-sw.js"])));
});
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(hit(e.request));
});
async function hit(req) {
  const cache = await caches.open(K);
  const cached = await cache.match(req);
  if (cached) {
    refresh(cache, req, cached);
    return cached;
  }
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
async function refresh(cache, req, cached) {
  try {
    const h = {};
    const tag = cached.headers.get("ETag") || cached.headers.get("etag");
    if (tag) h["If-None-Match"] = tag;
    const res = await fetch(req, { headers: h, cache: "no-store" });
    if (res.status === 304 || !res.ok) return;
    const next = await res.clone().text();
    if (next === await cached.text()) return;
    await cache.put(req, res);
  } catch {}
}
