/**
 * Public services the app talks to directly in every mode:
 *  - Esri category search for "nearby fuel / mosque / hospital …" (fast, licensed key), with public
 *    Overpass (OpenStreetMap) only as a fallback — the public Overpass servers were timing out / refusing
 *    requests on 18 Oct 2026, which showed up in the app as "no internet",
 *  - OpenStreetMap Notes for "a road is missing here" (anonymous; mappers fix the map for everyone),
 *  - Valhalla /trace_attributes for the speed limits along a route.
 */
import { haversine, speedLimitSpans, type LngLat, type SpeedLimitSpan } from "@darbna/core";
import { ApiError } from "./apiError";
import type { Place } from "./types";

const OVERPASS = "https://overpass-api.de/api/interpreter";
const ESRI_GEOCODE = "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";
const ESRI_KEY = process.env.EXPO_PUBLIC_ESRI_GEOCODE === "0" ? "" : process.env.EXPO_PUBLIC_ESRI_KEY || "";
const ESRI_CATEGORY: Record<string, string> = { fuel: "Gas Station", mosque: "Mosque", hospital: "Hospital", pharmacy: "Pharmacy", restaurant: "Restaurant", atm: "ATM,Bank" };
const OSM_API = "https://api.openstreetmap.org/api/0.6";
// Your own server (routing.darbna.com) when EXPO_PUBLIC_VALHALLA_URL is set at build time; else the public FOSSGIS one.
const VALHALLA = (process.env.EXPO_PUBLIC_VALHALLA_URL || "https://valhalla1.openstreetmap.de").replace(/\/$/, "");

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

/** Search radius per kind, in metres. */
const RADIUS_M: Record<NearbyKind, number> = { fuel: 10_000, mosque: 6_000, hospital: 12_000, pharmacy: 4_000, restaurant: 2_000, atm: 3_000 };

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

/** Esri category search around a point, nearest first, within the kind's radius. */
async function esriNearby(kind: NearbyKind, at: LngLat, lang: string, label: string): Promise<Place[]> {
  const q = new URLSearchParams({
    category: ESRI_CATEGORY[kind], location: `${at[0]},${at[1]}`, maxLocations: "50",
    outFields: "PlaceName,Place_addr,Type,Distance", langCode: lang === "en" ? "EN" : "AR", f: "json", token: ESRI_KEY,
  });
  const res = await fetchWithTimeout(`${ESRI_GEOCODE}?${q}`, { headers: { accept: "application/json" } }, 8_000);
  if (!res.ok) throw new ApiError("upstream", res.status);
  const data = await res.json();
  if (data?.error) throw new ApiError("upstream", Number(data.error.code) || 0);
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const c of data?.candidates ?? []) {
    const lon = Number(c.location?.x), lat = Number(c.location?.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (haversine(at, [lon, lat]) > RADIUS_M[kind]) continue;
    const a = c.attributes ?? {};
    const name = a.PlaceName || c.address || label;
    const k = `${name}|${Math.round(lat * 2000)}|${Math.round(lon * 2000)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const addr = typeof a.Place_addr === "string" && a.Place_addr !== name ? a.Place_addr : "";
    out.push({ id: `esri:${kind}:${lat.toFixed(5)},${lon.toFixed(5)}`, name, secondary: addr || undefined, kind: `nearby_${kind}`, coord: [lon, lat], source: "esri" });
  }
  return out.sort((x, y) => haversine(at, x.coord) - haversine(at, y.coord)).slice(0, 25);
}

/** Nearby places of one kind (Esri first, Overpass as fallback), cached per area and language for ten minutes. */
export async function nearby(kind: NearbyKind, at: LngLat, lang: string, label: string): Promise<Place[]> {
  const key = `${kind}|${at[0].toFixed(2)}|${at[1].toFixed(2)}|${lang}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.places;
  if (ESRI_KEY) {
    try {
      const places = await esriNearby(kind, at, lang, label);
      // Esri's coverage can be thin in places; only an empty answer falls through to OpenStreetMap.
      if (places.length) { cache.set(key, { at: Date.now(), places }); return places; }
    } catch (e) {
      if (e instanceof ApiError && e.code === "offline") throw e;
    }
  }
  const parts = FILTERS[kind].map((f) => `nwr${f}(around:${RADIUS_M[kind]},${at[1]},${at[0]});`).join("");
  const q = `[out:json][timeout:8];(${parts});out center tags 200;`;
  const res = await fetchWithTimeout(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded" } }, 12_000);
  if (!res.ok) throw new ApiError(res.status === 429 ? "rate_limited" : "upstream", res.status);
  const data = await res.json();
  const places = toPlaces(data.elements ?? [], kind, at, lang, label);
  cache.set(key, { at: Date.now(), places });
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
