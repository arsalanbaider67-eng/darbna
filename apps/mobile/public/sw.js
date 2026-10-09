/*
 * Darbna web app — offline support.
 *  - The app itself (page, scripts, icons) is cached so it opens with no internet.
 *  - Map tiles, fonts and icons from OpenFreeMap are cached as you look at the map, and in bulk
 *    by "Download area on screen" (Settings). Tile URLs contain a weekly data version; cache keys
 *    drop that version so downloaded areas keep working after OpenFreeMap updates. When online
 *    and a newer map version exists, the new tile is fetched (so new roads appear within days of
 *    being added to OpenStreetMap); the stored tile is used when offline or the network is slow.
 *  - Routes, search, reports and traffic are never cached here (they must be live).
 */
const SHELL = "darbna-shell-v1";
const MAP = "darbna-map-v1";
const MAP_HOST = "tiles.openfreemap.org";
// Arabic/Kurdish label shaping for the map, loaded from a CDN.
const RTL_PLUGIN = "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js";
const MAX_MAP_ENTRIES = 20000;
const REFRESH_AFTER_MS = 3 * 24 * 3600 * 1000; // fonts/icons (no version in their URL)
const NET_WAIT_MS = 2500;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(async (c) => {
    await c.addAll(["./", "./manifest.json", "./apple-touch-icon.png"]).catch(() => {});
    await c.add(RTL_PLUGIN).catch(() => {}); // separate: a CDN hiccup mustn't block the rest
  }));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("darbna-shell-") && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

/** https://tiles.openfreemap.org/planet/20251001_001001_pt/14/1/2.pbf → …/planet/14/1/2.pbf */
function mapKey(url) {
  const u = new URL(url);
  u.pathname = u.pathname.replace(/^\/(planet|monaco)\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/, "/$1/$2");
  return u.toString();
}

async function stamp(res, src) {
  const headers = new Headers(res.headers);
  headers.set("x-darbna-cached-at", String(Date.now()));
  headers.set("x-darbna-src", src);
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

let puts = 0;
async function putMap(key, res, src) {
  const cache = await caches.open(MAP);
  await cache.put(key, await stamp(res, src));
  if (++puts % 300 === 0) {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_MAP_ENTRIES; i++) await cache.delete(keys[i]); // oldest first
  }
}

async function mapRequest(req) {
  const url = new URL(req.url);
  const isData = /\.pbf$|\.png$|sprites\//.test(url.pathname);
  const key = mapKey(req.url);
  const cache = await caches.open(MAP);
  if (isData) {
    const hit = await cache.match(key);
    const fresh = () => fetch(req).then(async (r) => { if (r.ok) await putMap(key, r.clone(), req.url); return r; });
    if (!hit) return fresh();
    const versioned = key !== req.url; // a map tile (its URL names the map data version)
    if (versioned) {
      // Same map version as stored: use it. A newer version: fetch it, unless offline or slow.
      if (hit.headers.get("x-darbna-src") === req.url) return hit;
      const net = fresh().then((r) => (r.ok || r.status === 204 ? r : hit)).catch(() => hit);
      const slow = new Promise((ok) => setTimeout(() => ok(hit), NET_WAIT_MS));
      return Promise.race([net, slow]);
    }
    // Fonts, icons: stored copy, refreshed in the background every few days.
    const age = Date.now() - Number(hit.headers.get("x-darbna-cached-at") || 0);
    if (age > REFRESH_AFTER_MS) fresh().catch(() => {});
    return hit;
  }
  // Style and tile index (JSON): network first so the map stays current, cache when offline.
  try {
    const res = await fetch(req);
    if (res.ok) await putMap(key, res.clone(), req.url);
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function shellRequest(req, isPage) {
  const cache = await caches.open(SHELL);
  if (isPage) {
    // The page: network first (to get new versions), cached copy when offline.
    try {
      const res = await fetch(req);
      if (res.ok) await cache.put("./", res.clone());
      return res;
    } catch (err) {
      return (await cache.match("./")) || Promise.reject(err);
    }
  }
  // Scripts, fonts, images: file names change with every build, so cache first is safe.
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.host === MAP_HOST) return e.respondWith(mapRequest(req));
  if (req.url === RTL_PLUGIN) return e.respondWith(shellRequest(req, false));
  if (url.origin !== self.location.origin) return; // routes, search, reports, traffic: always live
  if (req.mode === "navigate") return e.respondWith(shellRequest(req, true));
  if (/\/_expo\/static\/|\/assets\/|\.(png|ico|json|ttf|otf|woff2?)$/.test(url.pathname)) e.respondWith(shellRequest(req, false));
});
