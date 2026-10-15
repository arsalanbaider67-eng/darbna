/**
 * Darbna's place search for Iraq: asks several search services at once and merges what they find.
 *  - Nominatim (OpenStreetMap's own search): exact names, addresses, streets.
 *  - Photon (OpenStreetMap, search-as-you-type), only with a self-hosted server: the public one
 *    timed out on 50 of 53 queries in the audit (docs/search-audit.md).
 *  - Esri World Geocoder (only with an API key that has the Geocoding privilege): commercial POI
 *    and address data on top of OpenStreetMap.
 * Results are scored on how well the name matches what was typed (Arabic, Sorani and Latin
 * spellings folded together, small typos forgiven), the service's own ranking, and distance from
 * you — nearby results first, but results in other cities are never dropped.
 * Pure code with the fetcher injected, so the app and scripts/search-audit.mjs run the same thing.
 */
import { haversine, type LngLat } from "./geo";
import { arabicKey, latinKey } from "./normalize";

export type SearchSource = "nominatim" | "photon" | "esri";
export interface SearchHit {
  id: string;
  name: string;
  secondary: string;
  coord: LngLat;
  kind: string;
  source: SearchSource;
  score: number;
}
export interface SearchEnv {
  lang: string;
  near?: LngLat;
  esriKey?: string;
  fetchJson: (url: string, init?: { headers?: Record<string, string> }) => Promise<any>;
  nominatimUrl?: string;
  photonUrl?: string;
  /** Skip Nominatim (e.g. it was asked less than a second ago: its usage policy is 1 request/s). */
  skipNominatim?: boolean;
  limit?: number;
}

/** Iraq's bounding box (lon/lat), used to keep results inside Iraq. */
export const IRAQ_BBOX: [number, number, number, number] = [38.7, 29.0, 48.9, 37.5];
const inIraq = ([x, y]: LngLat) => x >= IRAQ_BBOX[0] && x <= IRAQ_BBOX[2] && y >= IRAQ_BBOX[1] && y <= IRAQ_BBOX[3];

// ---------------------------------------------------------------- name matching
const AR = /[؀-ۿ]/;
/** Folded key for any script (Arabic and Sorani share the Arabic fold; Latin uses a consonant skeleton). */
export function nameKey(s: string): string {
  return AR.test(s) ? arabicKey(s) : latinKey(s);
}
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** 0..1: how well a place name matches what was typed (prefix, word overlap, small typos). */
export function nameMatch(query: string, name: string): number {
  const q = nameKey(query), n = nameKey(name);
  if (!q || !n) return 0;
  if (n === q) return 1;
  if (n.startsWith(q)) return 0.92;
  const qw = q.split(" "), nw = n.split(" ");
  let words = 0;
  for (const w of qw) {
    if (nw.some((x) => x === w || x.startsWith(w))) words += 1;
    else if (w.length >= 4 && nw.some((x) => lev(w, x.slice(0, w.length + 1)) <= (w.length >= 7 ? 2 : 1))) words += 0.8;
  }
  const overlap = words / qw.length;
  const whole = 1 - lev(q, n.slice(0, q.length + 2)) / Math.max(q.length, 1);
  return Math.max(overlap * 0.88, whole * 0.8, n.includes(q) ? 0.7 : 0);
}

// ---------------------------------------------------------------- providers
async function nominatim(q: string, env: SearchEnv): Promise<SearchHit[]> {
  const p: Record<string, string> = {
    q, format: "jsonv2", countrycodes: "iq", limit: "10", addressdetails: "1", namedetails: "1",
    "accept-language": `${env.lang},ar,en`,
  };
  if (env.near) p.viewbox = `${env.near[0] - 0.5},${env.near[1] + 0.5},${env.near[0] + 0.5},${env.near[1] - 0.5}`; // bias only, not a limit
  const items = (await env.fetchJson(`${env.nominatimUrl ?? "https://nominatim.openstreetmap.org"}/search?${new URLSearchParams(p)}`)) as any[];
  return (items ?? []).map((it, i) => {
    const nd = it.namedetails ?? {}, a = it.address ?? {};
    const name = nd[`name:${env.lang}`] || nd.name || it.name || String(it.display_name ?? "").split(",")[0];
    const alt = [nd["name:ar"], nd["name:en"], nd["name:ckb"], nd["name:ku"], nd.alt_name, nd.old_name].filter(Boolean) as string[];
    const secondary = [a.road && a.road !== name ? a.road : "", a.suburb ?? a.neighbourhood ?? a.city_district ?? "", a.city ?? a.town ?? a.village ?? a.state ?? ""]
      .filter(Boolean).slice(0, 3).join("، ");
    return { id: `osm:${it.osm_type?.[0] ?? "x"}${it.osm_id}`, name, secondary, coord: [Number(it.lon), Number(it.lat)] as LngLat,
      kind: it.type ?? it.category ?? "place", source: "nominatim" as const, score: 1 - i * 0.05, alt };
  });
}

async function photon(q: string, env: SearchEnv): Promise<SearchHit[]> {
  const p: Record<string, string> = { q, limit: "10", bbox: IRAQ_BBOX.join(",") };
  if (env.near) { p.lat = String(env.near[1]); p.lon = String(env.near[0]); }
  const j = await env.fetchJson(`${env.photonUrl}/api/?${new URLSearchParams(p)}`);
  return ((j?.features ?? []) as any[]).map((f, i) => {
    const pr = f.properties ?? {};
    const secondary = [pr.street && pr.street !== pr.name ? pr.street : "", pr.district ?? "", pr.city ?? pr.county ?? pr.state ?? ""]
      .filter(Boolean).slice(0, 3).join("، ");
    return { id: `osm:${String(pr.osm_type ?? "x").toLowerCase()[0]}${pr.osm_id}`, name: pr.name ?? pr.street ?? "", secondary,
      coord: f.geometry.coordinates as LngLat, kind: pr.osm_value ?? pr.type ?? "place", source: "photon" as const, score: 1 - i * 0.05, alt: [] as string[] };
  });
}

async function esri(q: string, env: SearchEnv): Promise<SearchHit[]> {
  if (!env.esriKey) return [];
  const p: Record<string, string> = { SingleLine: q, countryCode: "IRQ", maxLocations: "10", outFields: "PlaceName,Place_addr,Type,City", f: "json", token: env.esriKey, langCode: env.lang === "en" ? "EN" : "AR" };
  if (env.near) p.location = `${env.near[0]},${env.near[1]}`;
  const j = await env.fetchJson(`https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${new URLSearchParams(p)}`);
  if (j?.error) throw new Error(`esri ${j.error.code}`);
  return ((j?.candidates ?? []) as any[]).map((c, i) => ({
    id: `esri:${c.location.x.toFixed(5)},${c.location.y.toFixed(5)}`, name: c.attributes?.PlaceName || String(c.address ?? "").split(",")[0],
    secondary: c.attributes?.Place_addr || c.attributes?.City || "", coord: [c.location.x, c.location.y] as LngLat,
    kind: c.attributes?.Type || "place", source: "esri" as const, score: (c.score ?? 80) / 100 - i * 0.03, alt: [] as string[],
  }));
}

// ---------------------------------------------------------------- merge
const SOURCE_WEIGHT: Record<SearchSource, number> = { nominatim: 1, photon: 0.95, esri: 0.9 };

/**
 * Searches Iraq for `query`. Never throws for one failing service; throws only when every service
 * failed (so the app can say "offline"). Returns up to `limit` hits, best first.
 */
export async function searchIraq(query: string, env: SearchEnv): Promise<SearchHit[] & { failed?: SearchSource[] }> {
  const q = query.trim();
  if (q.length < 2) return [];
  const tasks: [SearchSource, Promise<(SearchHit & { alt?: string[] })[]>][] = [];
  if (!env.skipNominatim) tasks.push(["nominatim", nominatim(q, env)]);
  // Photon only when a server is configured: the public one timed out on 50 of 53 audit queries.
  if (env.photonUrl) tasks.push(["photon", photon(q, env)]);
  if (env.esriKey) tasks.push(["esri", esri(q, env)]);
  // Arabic typed with a different hamza / ta marbuta / alif maqsura than the map uses: Photon gets
  // the folded spelling too, so "اربيل", "قلعه", "البصره" still find the place.
  const folded = AR.test(q) ? foldedArabic(q) : "";
  if (folded && folded !== q) {
    if (env.photonUrl) tasks.push(["photon", photon(folded, env)]);
    else if (env.esriKey) tasks.push(["esri", esri(folded, env)]);
  }
  const settled = await Promise.allSettled(tasks.map(([, p]) => p));
  const failed = tasks.filter((_, i) => settled[i].status === "rejected").map(([s]) => s);
  if (failed.length === tasks.length) throw new Error(`all search services failed (${failed.join(", ")})`);

  const all: (SearchHit & { alt?: string[] })[] = [];
  settled.forEach((s) => { if (s.status === "fulfilled") all.push(...s.value); });
  const scored = all
    .filter((h) => h.name && Number.isFinite(h.coord[0]) && inIraq(h.coord))
    .map((h) => {
      const match = Math.max(nameMatch(q, h.name), ...(h.alt ?? []).map((a) => nameMatch(q, a)));
      const near = env.near ? Math.exp(-haversine(env.near, h.coord) / 40_000) : 0;
      return { ...h, score: match * 0.55 + h.score * SOURCE_WEIGHT[h.source] * 0.3 + near * 0.15 };
    })
    .sort((a, b) => b.score - a.score);
  // The same place from two services (same name and close, or practically the same spot): keep the best.
  const out: SearchHit[] = [];
  for (const h of scored) {
    const k = nameKey(h.name);
    if (out.some((o) => haversine(o.coord, h.coord) < 60 || (haversine(o.coord, h.coord) < 400 && nameKey(o.name) === k))) continue;
    const { alt: _alt, ...hit } = h as SearchHit & { alt?: string[] };
    out.push(hit);
    if (out.length >= (env.limit ?? 10)) break;
  }
  return Object.assign(out, { failed });
}

/** Common Arabic spelling differences folded the way Iraqi names are usually written on the map. */
export function foldedArabic(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, "") // harakat, tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ه(?=\s|$)/g, "ة") // البصره → البصرة
    .replace(/ى(?=\s|$)/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/ی/g, "ي")
    .trim();
}
