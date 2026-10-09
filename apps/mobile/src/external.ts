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

/** Places of one kind around you, nearest first (5 km, widened to 15 km if there are few). */
export async function nearby(kind: NearbyKind, at: LngLat, lang: string, label: string): Promise<Place[]> {
  const run = async (radius: number) => {
    const parts = FILTERS[kind].map((f) => `nwr${f}(around:${radius},${at[1]},${at[0]});`).join("");
    const q = `[out:json][timeout:15];(${parts});out center 60;`;
    const res = await fetchWithTimeout(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded" } }, 20_000);
    if (!res.ok) throw new ApiError(res.status === 429 ? "rate_limited" : "generic", res.status);
    const data = await res.json();
    return (data.elements ?? []) as any[];
  };
  let els = await run(5000);
  if (els.length < 5) els = await run(15000);
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const e of els) {
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) continue;
    const tg = e.tags ?? {};
    const name = tg[`name:${lang}`] || tg.name || tg["name:ar"] || tg["name:en"] || tg.brand || label;
    const key = `${name}|${Math.round(lat * 2000)}|${Math.round(lon * 2000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const secondary = [tg.brand && tg.brand !== name ? tg.brand : "", tg["addr:street"] ?? "", tg.opening_hours === "24/7" ? "24/7" : ""].filter(Boolean).join(" · ");
    out.push({ id: `osm:${e.type[0]}${e.id}`, name, secondary: secondary || undefined, kind: `nearby_${kind}`, coord: [lon, lat], source: "osm" });
  }
  return out.sort((a, b) => haversine(at, a.coord) - haversine(at, b.coord)).slice(0, 25);
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
