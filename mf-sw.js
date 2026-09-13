const K = "mf-8";
const TK = "mf-tiles";
const TILE_MAX = 1500;
const PRE = ["./index.html", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./manifest.webmanifest"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(K);
    await Promise.all(PRE.map(u => c.add(u).catch(() => {})));
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
  if (url.pathname.endsWith("mf-sw.js") || url.pathname.endsWith("mf-ver.txt")) {
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
  try { return await fetch(href, { mode: "no-cors", credentials: "omit" }); } catch { return undefined; }
}

async function keepTile(cache, href, res) {
  if (!res || (res.type !== "opaque" && !res.ok)) return;
  try { await cache.put(href, res.clone()); } catch { return; }
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

async function verChanged(cache) {
  try {
    const r = await fetch("./mf-ver.txt", { cache: "no-store" });
    if (!r.ok) return false;
    const remote = (await r.text()).trim();
    const hit = await cache.match("./mf-ver");
    const prev = hit ? (await hit.text()).trim() : "";
    if (remote && remote === prev) return false;
    if (remote) cache.put("./mf-ver", new Response(remote));
    return true;
  } catch {
    return false;
  }
}

function refreshIfNew(cache, req) {
  verChanged(cache).then(async yes => {
    if (!yes) return;
    const res = await fetch(req, { cache: "no-cache" });
    if (!res.ok) return;
    await putPage(cache, res);
    const list = await self.clients.matchAll({ type: "window" });
    list.forEach(c => c.postMessage({ type: "mf-ver" }));
  }).catch(() => {});
}

async function page(req) {
  const cache = await caches.open(K);
  const cached = await matchPage(cache);
  if (cached) {
    refreshIfNew(cache, req);
    return cached;
  }
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) {
      await putPage(cache, res);
      return res;
    }
  } catch {}
  return Response.error();
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
    if (osm) pullTile(osm).then(o => keepTile(cache, osm, o));
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
