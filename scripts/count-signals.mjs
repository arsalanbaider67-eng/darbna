// How many traffic lights does each map provider know about in Iraq's cities?
// Run by .github/workflows/count-signals.yml (needs network). Writes docs/signals-count.md.
//
//  - OpenStreetMap: every node tagged highway=traffic_signals in each city (Overpass).
//  - Mapbox (MAPBOX_TOKEN): Mapbox has no "list all traffic lights" API, but its driving directions
//    mark every intersection that has a traffic light (intersections[].traffic_signal). We drive
//    the same cross-town routes through each city with Mapbox and count lights on them, and count
//    OpenStreetMap's lights on exactly the same route lines: the ratio says who knows more.
//  - HERE (HERE_KEY): HERE Map Attributes API, TRAFFIC_SIGN_FC1–5 layers on the tiles covering
//    each city centre. Reports every sign type found (HERE does not document which code is a
//    traffic light in the public docs, so the raw breakdown is kept for checking).
import fs from "node:fs";

const CITIES = {
  baghdad: { c: [44.366, 33.315], r: 0.09 },
  erbil: { c: [44.009, 36.191], r: 0.07 },
  basra: { c: [47.783, 30.508], r: 0.06 },
  mosul: { c: [43.130, 36.340], r: 0.06 },
  sulaymaniyah: { c: [45.437, 35.561], r: 0.05 },
  najaf: { c: [44.330, 31.996], r: 0.04 },
  karbala: { c: [44.024, 32.616], r: 0.04 },
  kirkuk: { c: [44.392, 35.468], r: 0.05 },
  duhok: { c: [42.988, 36.867], r: 0.04 },
};
const UA = "Darbna/1.0 traffic-light count (+https://github.com/arsalanbaider67-eng/darbna)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const m = (a, b) => {
  const R = 6371000, t = Math.PI / 180, dLat = (b[1] - a[1]) * t, dLon = (b[0] - a[0]) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
async function get(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(90000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}
const bboxOf = ({ c, r }) => [c[0] - r * 1.2, c[1] - r, c[0] + r * 1.2, c[1] + r]; // w,s,e,n
/** Point-to-polyline distance (approx, metres) for "is this light on the route?". */
function nearLine(p, line, tol) {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const kx = 111320 * Math.cos(p[1] * Math.PI / 180), ky = 110540;
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    if (Math.hypot(ax + t * dx, ay + t * dy) <= tol) return true;
  }
  return false;
}
function dedupe(pts, d = 30) {
  const out = [];
  for (const p of pts) if (!out.some((o) => m(o, p) < d)) out.push(p);
  return out;
}

// ---------------------------------------------------------------- OpenStreetMap
async function osmSignals(city) {
  const [w, s, e, n] = bboxOf(city);
  const q = `[out:json][timeout:60];node["highway"="traffic_signals"](${s},${w},${n},${e});out skel;`;
  for (const host of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    try {
      const j = await get(host, { method: "POST", body: new URLSearchParams({ data: q }), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      return j.elements.map((el) => [el.lon, el.lat]);
    } catch (err) { console.log(`overpass ${host}: ${err.message}`); await sleep(5000); }
  }
  throw new Error("Overpass unavailable");
}

// ---------------------------------------------------------------- Mapbox (route probe)
function probeRoutes({ c, r }) {
  // 6 cross-town drives: N–S, W–E, both diagonals, and two offset W–E lines.
  const P = (dx, dy) => [c[0] + dx * r * 1.2, c[1] + dy * r];
  return [[P(0, -0.9), P(0, 0.9)], [P(-0.9, 0), P(0.9, 0)], [P(-0.7, -0.7), P(0.7, 0.7)], [P(-0.7, 0.7), P(0.7, -0.7)],
    [P(-0.8, 0.4), P(0.8, 0.4)], [P(-0.8, -0.4), P(0.8, -0.4)]];
}
async function mapboxProbe(city, token, osm) {
  let lines = [], mb = [];
  for (const [a, b] of probeRoutes(city)) {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${a.join(",")};${b.join(",")}?geometries=geojson&steps=true&overview=full&access_token=${token}`;
    const j = await get(url);
    const route = j.routes?.[0];
    if (!route) continue;
    lines.push(route.geometry.coordinates);
    for (const leg of route.legs) for (const st of leg.steps) for (const x of st.intersections ?? []) if (x.traffic_signal) mb.push(x.location);
    await sleep(250);
  }
  mb = dedupe(mb);
  const osmOn = dedupe(osm.filter((p) => lines.some((l) => nearLine(p, l, 25))));
  const km = lines.reduce((s, l) => s + l.reduce((d, p, i) => d + (i ? m(l[i - 1], p) : 0), 0), 0) / 1000;
  return { km: Math.round(km), mapbox: mb.length, osm: osmOn.length };
}

// ---------------------------------------------------------------- HERE (attribute tiles)
const HERE_LEVEL = { 1: 9, 2: 10, 3: 11, 4: 12, 5: 13 };
function hereTiles(bbox, level) {
  const size = 180 / 2 ** level, ids = [];
  for (let x = Math.floor((bbox[0] + 180) / size); x <= Math.floor((bbox[2] + 180) / size); x++)
    for (let y = Math.floor((bbox[1] + 90) / size); y <= Math.floor((bbox[3] + 90) / size); y++) ids.push(y * 2 ** (level + 1) + x);
  return ids;
}
async function hereSigns(city, key) {
  const types = {}; let total = 0, withSignalLoc = 0;
  for (const fc of [1, 2, 3, 4, 5]) {
    const tiles = hereTiles(bboxOf(city), HERE_LEVEL[fc]);
    for (let i = 0; i < tiles.length; i += 20) {
      const url = `https://smap.hereapi.com/v8/maps/attributes?layers=TRAFFIC_SIGN_FC${fc}&in=tile:${tiles.slice(i, i + 20).join(",")}&apiKey=${key}`;
      const j = await get(url);
      for (const t of j.Tiles ?? j.tiles ?? []) for (const row of t.Rows ?? t.rows ?? []) {
        total++;
        const ty = row.TRAFFIC_SIGN_TYPE ?? "?";
        types[ty] = (types[ty] ?? 0) + 1;
        if (row.SIGNAL_SIGN_LOCATION) withSignalLoc++;
      }
      await sleep(200);
    }
  }
  return { total, withSignalLoc, types };
}

// ---------------------------------------------------------------- run
const out = [`# Traffic lights per provider (${new Date().toISOString().slice(0, 10)})`, ""];
const MAPBOX = process.env.MAPBOX_TOKEN, HERE = process.env.HERE_KEY;
const rows = [];
for (const [name, city] of Object.entries(CITIES)) {
  const row = { name };
  try { row.osmPts = await osmSignals(city); row.osm = row.osmPts.length; } catch (e) { row.osm = `error: ${e.message}`; row.osmPts = []; }
  if (MAPBOX) { try { row.mb = await mapboxProbe(city, MAPBOX, row.osmPts); } catch (e) { row.mb = { error: e.message.slice(0, 120) }; } }
  if (HERE) { try { row.here = await hereSigns(city, HERE); } catch (e) { row.here = { error: e.message.slice(0, 120) }; } }
  rows.push(row);
  console.log(name, JSON.stringify({ osm: row.osm, mb: row.mb, here: row.here && { total: row.here.total, withSignalLoc: row.here.withSignalLoc } }));
  await sleep(2000);
}

out.push("## OpenStreetMap (whole city area)", "", "| City | Traffic lights |", "|---|---|");
for (const r of rows) out.push(`| ${r.name} | ${r.osm} |`);
out.push("");
if (MAPBOX) {
  out.push("## Mapbox vs OpenStreetMap on the same 6 cross-town drives per city", "",
    "Lights counted along identical route lines (25 m either side). Mapbox ÷ OSM is how many more lights Mapbox knows.", "",
    "| City | Driven km | Mapbox | OSM | Mapbox ÷ OSM | Estimated Mapbox city total |", "|---|---|---|---|---|---|");
  for (const r of rows) {
    if (r.mb?.error) { out.push(`| ${r.name} | error: ${r.mb.error} | | | | |`); continue; }
    const ratio = r.mb.osm ? r.mb.mapbox / r.mb.osm : null;
    out.push(`| ${r.name} | ${r.mb.km} | ${r.mb.mapbox} | ${r.mb.osm} | ${ratio == null ? (r.mb.mapbox ? "∞" : "–") : ratio.toFixed(2)} | ${ratio != null && typeof r.osm === "number" ? Math.round(r.osm * ratio) : "–"} |`);
  }
  out.push("");
} else out.push("_Mapbox: not counted (add a MAPBOX_TOKEN variable)._", "");
if (HERE) {
  out.push("## HERE traffic-sign layers (TRAFFIC_SIGN_FC1–5, whole city area)", "", "| City | Signs | With signal location | Sign types (code: count) |", "|---|---|---|---|");
  for (const r of rows) {
    if (r.here?.error) { out.push(`| ${r.name} | error: ${r.here.error} | | |`); continue; }
    out.push(`| ${r.name} | ${r.here.total} | ${r.here.withSignalLoc} | ${Object.entries(r.here.types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ")} |`);
  }
  out.push("");
} else out.push("_HERE: not counted (add a HERE_KEY variable)._", "");

fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/signals-count.md", out.join("\n") + "\n");
const tot = (f) => rows.reduce((s, r) => s + (typeof f(r) === "number" ? f(r) : 0), 0);
console.log(`::notice title=OpenStreetMap::${tot((r) => r.osm)} traffic lights in ${rows.length} cities`);
if (MAPBOX) console.log(`::notice title=Mapbox (route probe)::${tot((r) => r.mb?.mapbox)} lights vs OSM ${tot((r) => r.mb?.osm)} on the same ${tot((r) => r.mb?.km)} km`);
if (HERE) console.log(`::notice title=HERE::${tot((r) => r.here?.total)} traffic signs, ${tot((r) => r.here?.withSignalLoc)} with a signal location`);
