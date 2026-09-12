const K = "mf-7";
const TK = "mf-tiles";
const TILE_MAX = 1500;
const PAGE_MS = 6 * 3600 * 1000;
const PRE = ["./index.html", "./icon-512.png", "./apple-touch-icon.png", "./manifest.webmanifest"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(K);
    await Promise.all(PRE.map(u => c.add(u).catch(() => {})));
    c.put("./mf-checked", new Response(String(Date.now())));
  })());
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
  if (isPage(e.request, url)) {
    e.respondWith(page(e.request));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(asset(e.request));
    return;
  }
  if (isTile(url)) e.respondWith(tile(e.request));
});

function isPage(req, url) {
  if (req.mode === "navigate") return true;
  const p = url.pathname;
  return p.endsWith("/") || p.endsWith("/index.html");
}

function isTile(u) {
  return u.hostname === "tile.openstreetmap.org"
    || (u.hostname.startsWith("mt") && u.hostname.endsWith(".google.com"));
}

function tileKey(href) {
  const u = new URL(href);
  if (u.hostname.startsWith("mt") && u.hostname.endsWith(".google.com")) u.hostname = "mt0.google.com";
  return u.href;
}

function osmOf(href) {
  const u = new URL(href);
  if (!(u.hostname.startsWith("mt") && u.hostname.endsWith(".google.com"))) return "";
  const x = u.searchParams.get("x"), y = u.searchParams.get("y"), z = u.searchParams.get("z");
  return x == null ? "" : "https://tile.openstreetmap.org/" + z + "/" + x + "/" + y + ".png";
}

async function pullTile(href) {
  try {
    const r = await fetch(href, { mode: "cors", credentials: "omit" });
    if (r.ok) return r;
  } catch {}
  try { return await fetch(href, { credentials: "omit" }); } catch { return undefined; }
}

async function keepTile(cache, href, res) {
  if (!res || !res.ok || res.type === "opaque") return;
  await cache.put(href, res.clone());
  const keys = await cache.keys();
  if (keys.length > TILE_MAX) {
    await Promise.all(keys.slice(0, keys.length - TILE_MAX).map(k => cache.delete(k)));
  }
}

async function matchPage(cache) {
  const here = new URL("./index.html", location.href).href;
  const root = new URL("./", location.href).href;
  for (const k of ["./index.html", here, "./", root]) {
    const hit = await cache.match(k, { ignoreSearch: true });
    if (hit) return hit;
  }
  return undefined;
}

async function putPage(cache, res) {
  const html = new URL("./index.html", location.href).href;
  const root = new URL("./", location.href).href;
  await cache.put("./index.html", res.clone());
  await cache.put(html, res.clone());
  await cache.put(root, res.clone());
}

async function due(cache) {
  const m = await cache.match("./mf-checked");
  if (!m) return true;
  return Date.now() - +(await m.text()) > PAGE_MS;
}

function mark(cache) {
  cache.put("./mf-checked", new Response(String(Date.now())));
}

function stale(cache, req, cached) {
  const etag = cached && cached.headers.get("etag");
  const headers = etag ? { "If-None-Match": etag } : {};
  fetch(req, { headers, cache: "no-cache" }).then(res => {
    if (res.ok) putPage(cache, res);
  }).catch(() => {});
}

async function page(req) {
  const cache = await caches.open(K);
  const cached = await matchPage(cache);
  if (cached) {
    if (await due(cache)) {
      mark(cache);
      stale(cache, req, cached);
    }
    return cached;
  }
  const res = await fetch(req);
  if (res.ok) await putPage(cache, res);
  return res;
}

async function asset(req) {
  const cache = await caches.open(K);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function tile(req) {
  const cache = await caches.open(TK);
  const key = tileKey(req.url);
  const osm = osmOf(key);
  const hit = await cache.match(key) || (osm && await cache.match(osm));
  if (hit) return hit;
  const res = await pullTile(key);
  if (res && (res.ok || res.type === "opaque")) {
    await keepTile(cache, key, res);
    return res;
  }
  if (osm) {
    const o = await cache.match(osm) || await pullTile(osm);
    if (o && o.ok) {
      await keepTile(cache, osm, o);
      return o;
    }
  }
  return res || Response.error();
}
