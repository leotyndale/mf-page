const K = "mf-4";
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(x => x !== K).map(x => caches.delete(x)));
    await (await caches.open(K)).add("./index.html");
  })());
});
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const path = new URL(e.request.url).pathname;
  if (path.endsWith("mf-sw.js")) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
    return;
  }
  if (e.request.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request, { cache: "no-store" });
        if (res.ok) (await caches.open(K)).put("./index.html", res.clone());
        return res;
      } catch {
        return (await caches.open(K)).match("./index.html") || Response.error();
      }
    })());
    return;
  }
  e.respondWith(hit(e.request));
});
async function hit(req) {
  const cache = await caches.open(K);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
