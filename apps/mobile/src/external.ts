/**
 * Public services the app talks to directly in every mode:
 *  - Overpass (OpenStreetMap) for "nearby fuel / mosque / hospital …" quick searches,
 *  - OpenStreetMap Notes for "a road is missing here" (anonymous; mappers fix the map for everyone),
 *  - Valhalla /trace_attributes for the speed limits along a route.
 */
import { haversine, speedLimitSpans, type LngLat, type SpeedLimitSpan } from "@darbna/core";
import { ApiError } from "./apiError";
import type { Place } from "./types";

const OVERPASS = "https://overpass-api.de/api/interpreter";
const OSM_API = "https://api.openstreetmap.org/api/0.6";
const VALHALLA = "https://valhalla1.openstreetmap.de";

export const NEARBY_KINDS = ["fuel", "mosque", "hospital", "pharmacy", "restaurant", "atm"] as const;
export type NearbyKind = (typeof NEARBY_KINDS)[number];

const FILTERS: Record<NearbyKind, string[]> = {
  fuel: ['["amenity"="fuel"]'],
  mosque: ['["amenity"="place_of_worship"]["religion"="muslim"]'],
  hospital: ['["amenity"~"^(hospital|clinic)$"]'],
  pharmacy: ['["amenity"="pharmacy"]', '["healthcare"="pharmacy"]'],
  restaurant: ['["amenity"~"^(restaurant|fast_food|cafe)$"]'],
  atm: ['["amenity"~"^(atm|bank)$"]'],
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    throw new ApiError(ctrl.signal.aborted ? "timeout" : "offline");
  } finally {
    clearTimeout(timer);
  }
}

const OVERPASS_MIRRORS = [
  OVERPASS,
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const NOMINATIM = "https://nominatim.openstreetmap.org";
/** Search radius per kind: small where places are dense (food, ATMs), wide where they're sparse. */
const RADIUS_M: Record<NearbyKind, number> = { fuel: 10_000, mosque: 6_000, hospital: 12_000, pharmacy: 4_000, restaurant: 2_000, atm: 3_000 };
/** Nominatim "special phrases": the place kind in English finds e.g. every fuel station in an area. */
const NOMINATIM_PHRASE: Record<NearbyKind, string> = {
  fuel: "fuel", mosque: "mosque", hospital: "hospital", pharmacy: "pharmacy", restaurant: "restaurant", atm: "atm",
};

/** The first of several requests to succeed; the others are cancelled. */
function firstOk<T>(makers: ((signal: AbortSignal) => Promise<T>)[], timeoutMs: number): Promise<T> {
  const ctrls = makers.map(() => new AbortController());
  return new Promise<T>((resolve, reject) => {
    let left = makers.length, done = false;
    const timer = setTimeout(() => { if (!done) { done = true; ctrls.forEach((c) => c.abort()); reject(new ApiError("timeout")); } }, timeoutMs);
    makers.forEach((make, i) => {
      make(ctrls[i].signal).then((v) => {
        if (done) return;
        done = true; clearTimeout(timer);
        ctrls.forEach((c, j) => j !== i && c.abort());
        resolve(v);
      }, () => {
        if (--left === 0 && !done) { done = true; clearTimeout(timer); reject(new ApiError("generic")); }
      });
    });
  });
}

function toPlaces(els: any[], kind: NearbyKind, at: LngLat, lang: string, label: string): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const e of els) {
    const lat = Number(e.lat ?? e.center?.lat), lon = Number(e.lon ?? e.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tg = e.tags ?? e.namedetails ?? {};
    const name = tg[`name:${lang}`] || tg.name || tg["name:ar"] || tg["name:en"] || tg.brand || e.name || label;
    const key = `${name}|${Math.round(lat * 2000)}|${Math.round(lon * 2000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const street = tg["addr:street"] ?? e.address?.road ?? "";
    const secondary = [tg.brand && tg.brand !== name ? tg.brand : "", street, tg.opening_hours === "24/7" ? "24/7" : ""].filter(Boolean).join(" · ");
    out.push({ id: `osm:${(e.type ?? e.osm_type ?? "x")[0]}${e.id ?? e.osm_id}`, name, secondary: secondary || undefined, kind: `nearby_${kind}`, coord: [lon, lat], source: "osm" });
  }
  return out.sort((a, b) => haversine(at, a.coord) - haversine(at, b.coord)).slice(0, 25);
}

const cache = new Map<string, { at: number; places: Place[] }>();

/**
 * Places of one kind around you (2–12 km depending on the kind), nearest first. Asks several OpenStreetMap servers at
 * once and keeps the first answer; if none answers within a few seconds, falls back to Nominatim.
 * Results are kept for 10 minutes per area.
 */
export async function nearby(kind: NearbyKind, at: LngLat, lang: string, label: string): Promise<Place[]> {
  const key = `${kind}|${at[0].toFixed(2)}|${at[1].toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.places;

  const parts = FILTERS[kind].map((f) => `nwr${f}(around:${RADIUS_M[kind]},${at[1]},${at[0]});`).join("");
  const q = `[out:json][timeout:8];(${parts});out center tags 200;`;
  const overpass = () => firstOk(OVERPASS_MIRRORS.map((ep) => async (signal: AbortSignal) => {
    const res = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded" }, signal });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return toPlaces(data.elements ?? [], kind, at, lang, label);
  }), 8000);

  const d = 0.12; // ~13 km box
  const nominatim = async () => {
    const qs = new URLSearchParams({
      q: NOMINATIM_PHRASE[kind], format: "jsonv2", limit: "30", bounded: "1", namedetails: "1", addressdetails: "1",
      viewbox: `${at[0] - d},${at[1] + d},${at[0] + d},${at[1] - d}`, "accept-language": `${lang},en`,
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${NOMINATIM}/search?${qs}`, { headers: { accept: "application/json" }, signal: ctrl.signal });
      if (!res.ok) throw new ApiError("generic", res.status);
      return toPlaces((await res.json()) as any[], kind, at, lang, label);
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError(ctrl.signal.aborted ? "timeout" : "offline");
    } finally {
      clearTimeout(timer);
    }
  };

  // Both at once; the first with results wins (the public OpenStreetMap servers are often busy).
  const places = await new Promise<Place[]>((resolve, reject) => {
    let left = 2, empty: Place[] | null = null, err: unknown = null;
    const settle = (p: Promise<Place[]>) => p.then((r) => {
      if (r.length) return resolve(r);
      empty = r;
      if (--left === 0) resolve(empty);
    }, (e) => {
      err = e;
      if (--left === 0) (empty ? resolve(empty) : reject(err));
    });
    settle(overpass());
    settle(nominatim());
  });
  if (places.length) cache.set(key, { at: Date.now(), places });
  return places;
}

/** "A road is missing / wrong here": an anonymous OpenStreetMap note mappers will see. */
export async function reportMapProblem(at: LngLat, text: string): Promise<void> {
  const body = `${text.trim().slice(0, 900)}\n\n(#Darbna app — a driver reported this spot)`;
  const qs = new URLSearchParams({ lat: at[1].toFixed(6), lon: at[0].toFixed(6), text: body });
  const res = await fetchWithTimeout(`${OSM_API}/notes.json?${qs}`, { method: "POST" }, 15_000);
  if (!res.ok) throw new ApiError(res.status === 429 ? "rate_limited" : "generic", res.status);
}

/** Speed limits along a car route (only where the map knows them). Never throws. */
export async function routeSpeedLimits(geometry: LngLat[]): Promise<SpeedLimitSpan[]> {
  if (geometry.length < 2 || geometry.length > 6000) return [];
  try {
    const body = {
      shape: geometry.map(([lon, lat]) => ({ lat: +lat.toFixed(6), lon: +lon.toFixed(6) })),
      costing: "auto", shape_match: "edge_walk",
      filters: { attributes: ["edge.speed_limit", "edge.begin_shape_index", "edge.end_shape_index"], action: "include" },
    };
    // text/plain keeps it a "simple" request (no CORS preflight); Valhalla reads the JSON anyway.
    const res = await fetchWithTimeout(`${VALHALLA}/trace_attributes`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "text/plain" } }, 20_000);
    if (!res.ok) return [];
    return speedLimitSpans(await res.json());
  } catch {
    return [];
  }
}
