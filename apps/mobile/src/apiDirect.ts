/**
 * "Direct" mode: the app talks straight to public OpenStreetMap services from the phone,
 * with no Darbna server. Used by the web preview so it works anywhere (on mobile data,
 * away from the PC).
 *
 * TESTING ONLY. These services allow light personal use, not a public app:
 *  - routing: FOSSGIS Valhalla (valhalla1.openstreetmap.de)
 *  - search:  Nominatim — results as you type after a 0.7 s pause, max 1 request/second
 *             (so Nominatim is queried only when the user presses Search; typing searches
 *             the built-in gazetteer)
 *  - map:     OpenFreeMap tiles
 * Community reports: shared with everyone through Supabase when EXPO_PUBLIC_SUPABASE_URL/KEY are
 * set at build time (rules live in supabase/schema.sql); otherwise kept on this device only.
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import {
  applyTraffic, arabicKey, searchIraq, mergePlaceResults, boxAround, haversine, latinKey, projectOnSegment, mapValhallaResponse, REPORT_TTL_MIN, reportConfidence, routingTreatment,
  valhallaErrorCode, valhallaRouteBody, type LngLat, type ReportCategory,
  type SpeedSample, type TrafficCell, type LearnedSignal, type StopEvent, IRAQ_BBOX,
} from "@darbna/core";
import gazetteer from "@darbna/core/data/gazetteer.seed.json";
import { createCachedSearch, createRequestGate, type SearchOptions } from "./searchClient";
import { ApiError } from "./apiError";
import { getInstallId } from "./storage";
import type { Place, PrizeState, PublicReport, RouteOpts, RouteResult, ServerConfig, SharedTrip } from "./types";

// Your own server (routing.darbna.com) when EXPO_PUBLIC_VALHALLA_URL is set at build time; else the public FOSSGIS one.
const VALHALLA = (process.env.EXPO_PUBLIC_VALHALLA_URL || "https://valhalla1.openstreetmap.de").replace(/\/$/, "");
// Your own server (search.darbna.com) when EXPO_PUBLIC_NOMINATIM_URL is set at build time; else the public one.
const NOMINATIM = (process.env.EXPO_PUBLIC_NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
/** Own search server: no one-request-per-second limit. */
const NOMINATIM_OWN = !!process.env.EXPO_PUBLIC_NOMINATIM_URL;
/** Self-hosted Photon (search-as-you-type), when set up. */
const PHOTON = (process.env.EXPO_PUBLIC_PHOTON_URL || "").replace(/\/$/, "") || undefined;
/** Esri place search alongside OpenStreetMap (finds businesses and misspellings OSM misses).
 *  On whenever the Esri key is set; GitHub variable ESRI_GEOCODE=0 turns it off. */
const ESRI_GEOCODE_KEY = process.env.EXPO_PUBLIC_ESRI_GEOCODE === "0" ? undefined : process.env.EXPO_PUBLIC_ESRI_KEY || undefined;
const STYLE = "https://tiles.openfreemap.org/styles/liberty";

async function getJson(url: string, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
  } catch {
    throw new ApiError(ctrl.signal.aborted ? "timeout" : "offline");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return Promise.reject(Object.assign(new ApiError("upstream", res.status), { body: data }));
  return data;
}

// ---------------------------------------------------------------- built-in gazetteer
interface SeedPlace {
  key: string; kind: string; parent?: string; lat: number; lng: number; importance: number;
  names: { ar?: string; ckb?: string; en?: string; alias?: string[] };
}
const SEED = (gazetteer as { places: SeedPlace[] }).places;
const BY_KEY = new Map(SEED.map((p) => [p.key, p]));
const INDEX = SEED.map((p) => {
  const all = [p.names.ar, p.names.ckb, p.names.en, ...(p.names.alias ?? [])].filter(Boolean) as string[];
  return { p, ar: all.map(arabicKey).filter(Boolean), la: all.map(latinKey).filter(Boolean) };
});

function displayName(p: SeedPlace, lang: string): string {
  return (lang === "en" ? p.names.en : lang === "ckb" ? p.names.ckb : p.names.ar) ?? p.names.ar ?? p.names.en ?? p.key;
}

function searchGazetteer(q: string, lang: string, near?: LngLat): (Place & { score: number })[] {
  const a = /[؀-ۿ]/.test(q) ? arabicKey(q) : "";
  const l = /[a-zA-Z]/.test(q) ? latinKey(q) : "";
  const hits: (Place & { score: number })[] = [];
  for (const { p, ar, la } of INDEX) {
    let s = 0;
    for (const k of ar) if (a) s = Math.max(s, k === a ? 1 : k.startsWith(a) ? 0.85 : k.includes(a) ? 0.6 : 0);
    for (const k of la) if (l) s = Math.max(s, k === l ? 0.95 : k.startsWith(l) ? 0.8 : k.includes(l) ? 0.55 : 0);
    if (!s) continue;
    const coord: LngLat = [p.lng, p.lat];
    let score = s * 0.8 + p.importance * 0.2;
    if (near) score += 0.15 * Math.exp(-haversine(near, coord) / 50_000);
    const parent = p.parent ? BY_KEY.get(p.parent) : undefined;
    hits.push({
      id: `gz:${p.key}`, name: displayName(p, lang), secondary: parent ? displayName(parent, lang) : "",
      kind: p.kind, coord, quality: "seed_unverified", source: "gazetteer", score,
    });
  }
  return hits.sort((x, y) => y.score - x.score).slice(0, 8);
}

// ---------------------------------------------------------------- Nominatim (≤ 1 req/s)
const waitForNominatim = createRequestGate(NOMINATIM_OWN ? 0 : 1100);
async function nominatim(path: string, params: Record<string, string>): Promise<any> {
  await waitForNominatim();
  const qs = new URLSearchParams({ format: "jsonv2", addressdetails: "1", namedetails: "1", ...params });
  return getJson(`${NOMINATIM}${path}?${qs}`, 8000);
}

function mapNominatim(it: any, lang: string, score: number): Place & { score: number } {
  const nd = it.namedetails ?? {};
  const a = it.address ?? {};
  const name = nd[`name:${lang}`] || nd["name:ar"] || it.name || it.display_name?.split(",")[0] || "";
  const secondary = [a.road && a.road !== name ? a.road : undefined, a.suburb ?? a.neighbourhood ?? a.city_district, a.city ?? a.town ?? a.village]
    .filter(Boolean).slice(0, 3).join("، ");
  return { id: `osm:${it.osm_type?.[0] ?? "x"}${it.osm_id ?? it.place_id}`, name, secondary, kind: it.type ?? "place",
    coord: [Number(it.lon), Number(it.lat)], source: "nominatim", score };
}

// ---------------------------------------------------------------- shared reports (Supabase)
const SB_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SB_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? "";
export const SHARED_REPORTS = !!(SB_URL && SB_KEY);

async function rpc<T>(fn: string, args: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers: Record<string, string> = { apikey: SB_KEY, "content-type": "application/json", accept: "application/json" };
  // Legacy anon keys are JWTs and go in Authorization too; new publishable keys only in apikey.
  if (SB_KEY.startsWith("eyJ")) headers.authorization = `Bearer ${SB_KEY}`;
  let res: Response;
  try {
    res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args), signal: ctrl.signal });
  } catch {
    throw new ApiError(ctrl.signal.aborted ? "timeout" : "offline");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Database rule violations come back as { code: "P0001", message: "rate_limited" | "own_report" | … }.
    // A function the database doesn't have yet (schema.sql not re-run) → "unsupported", not a vague error.
    const code = data?.code === "P0001" && typeof data.message === "string" ? data.message
      : data?.code === "PGRST202" ? "unsupported"
      : res.status >= 500 ? "server" : "generic";
    throw new ApiError(code, res.status, code === "rate_limited" ? 600 : undefined);
  }
  return data as T;
}

// ---------------------------------------------------------------- reports (this device only)
const REPORTS_KEY = "darbna:directReports";
async function loadReports(): Promise<PublicReport[]> {
  try {
    const all = JSON.parse((await AsyncStorage.getItem(REPORTS_KEY)) ?? "[]") as PublicReport[];
    return all.filter((r) => Date.parse(r.expiresAt) > Date.now());
  } catch {
    return [];
  }
}
const saveReports = (r: PublicReport[]) => AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(r)).catch(() => {});
function rescore(r: PublicReport): PublicReport {
  const confidence = reportConfidence("community", { confirms: r.confirms, gone: r.gone }, new Date(r.createdAt), new Date(r.expiresAt));
  return { ...r, confidence, treatment: routingTreatment(r.category, "community", confidence) };
}

// ---------------------------------------------------------------- the API, same shape as the server client
export const directApi = {
  config: async (): Promise<ServerConfig> => ({
    // "#light": the normal map, lightened, day and night (brand guide v1.0: white app, purple route).
    map: { styleDay: `${STYLE}#light`, styleNight: `${STYLE}#light`, attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" },
    routing: { provider: "valhalla", traffic: false, avoidsVerifiedClosures: false },
    features: { offlineMapDisplay: false, offlineRouting: false, liveTraffic: false },
    sampleData: false,
    mode: "direct",
    sharedReports: SHARED_REPORTS,
    sharedTraffic: SHARED_REPORTS,
    social: SHARED_REPORTS,
  }),

  search: createCachedSearch<Place & { score: number }>(async (q: string, lang: string, near: LngLat | undefined, opts: SearchOptions) => {
    const local = searchGazetteer(q, lang, near);
    if (!opts.remote || q.trim().length < 2) return { results: local, partial: false };
    try {
      // The public service forbids autocomplete. Submitted searches wait for their slot;
      // configured autocomplete providers can still suggest results while typing.
      const skipNominatim = !NOMINATIM_OWN && opts.autocomplete === true;
      const hits = await searchIraq(q, {
        lang, near, esriKey: ESRI_GEOCODE_KEY, skipNominatim, nominatimUrl: NOMINATIM, photonUrl: PHOTON,
        limit: 20,
        fetchJson: async (url) => {
          if (url.startsWith(`${NOMINATIM}/search?`)) await waitForNominatim();
          return getJson(url, 8000);
        },
      });
      const remote = hits.map((h) => ({ id: h.id, name: h.name, secondary: h.secondary, kind: h.kind, coord: h.coord, source: h.source, score: h.score }));
      return { results: mergePlaceResults<Place & { score: number }>(local, remote), partial: (hits.failed?.length ?? 0) > 0 };
    } catch (e) {
      if (!local.length) throw e instanceof ApiError ? e : new ApiError("search_unavailable");
      return { results: local, partial: true };
    }
  }),

  reverse: async (at: LngLat, lang: string) => {
    const it = await nominatim("/reverse", { lat: String(at[1]), lon: String(at[0]), zoom: "18", "accept-language": `${lang},ar,en` });
    return { result: it && !it.error ? (mapNominatim(it, lang, 1) as Place) : null };
  },

  route: async (origin: LngLat, destination: LngLat, opts: RouteOpts = {}): Promise<RouteResult> => {
    if (haversine(origin, destination) < 25) throw new ApiError("too_close", 422);
    const via = opts.via ?? [];
    if (opts.travel === "walk") return walkRoute(origin, destination, opts.alternatives ?? true, via);
    // Same policy as the server: verified closures are always avoided; others only when the driver asks.
    const [nearby, cells] = await Promise.all([reportsNear(origin, destination), trafficNear(origin, destination)]);
    const chosen = new Set(opts.avoidReportIds ?? []);
    const toAvoid = nearby.filter((r) => r.treatment === "avoid" || (chosen.has(r.id) && r.treatment !== "display")
      // "Avoid checkpoints": go around every checkpoint drivers reported.
      || (opts.avoid?.checkpoints && (r.category === "checkpoint" || r.category === "checkpoint_slow")));
    const excludePolygons = toAvoid.map((r) => boxAround(r.coord, r.category === "closure" || r.category === "flooding" ? 60 : r.category.startsWith("checkpoint") ? 120 : 35));
    const base = { origin, destination, originHeading: opts.heading, via, avoid: { highways: opts.avoid?.highways, unpaved: opts.avoid?.unpaved } };
    let trips: ReturnType<typeof mapValhallaResponse>;
    let avoidFailed = false;
    try {
      trips = await routeWithSnapFallbacks({ ...base, alternatives: opts.alternatives ?? true, excludePolygons });
    } catch (e) {
      // If avoiding made the trip impossible, fall back to the normal route and say so.
      if (!(e instanceof ApiError && e.code === "no_route" && excludePolygons.length)) throw e;
      trips = await routeWithSnapFallbacks({ ...base, alternatives: false });
      avoidFailed = true;
    }
    const avoided = avoidFailed ? [] : toAvoid.map((r) => r.id);
    const advisories = new Map<string, PublicReport>();
    const routes = trips.map((free) => {
      // Live traffic from Darbna drivers: slows the estimate where they're going slower now.
      const tr = applyTraffic(free, cells);
      const r = tr.route;
      const step = r.geometry.length > 4000 ? 3 : 1;
      const onRoute = nearby.filter((rep) => !avoided.includes(rep.id) && distanceToLine(rep.coord, r.geometry, step) < 60);
      onRoute.forEach((rep) => advisories.set(rep.id, rep));
      // Started from a nearby main road because the user's street isn't connected in the map data.
      const startGapM = r.geometry.length ? Math.round(haversine(origin, r.geometry[0])) : 0;
      return { ...r, travel: "car" as const, avoidedClosureIds: avoided, reportIdsOnRoute: onRoute.map((x) => x.id), trafficSpans: tr.spans, trafficExtraS: tr.extraS, startGapM };
    });
    // With traffic, an alternative may now be the fastest: list it first.
    routes.sort((a, b) => a.durationS - b.durationS);
    // Avoided reports are included too, so the app can say what was avoided.
    for (const r of toAvoid) if (!avoidFailed) advisories.set(r.id, r);
    return {
      routes, reports: [...advisories.values()],
      avoidance: { requested: avoided.length > 0 || avoidFailed, honoured: !avoidFailed, providerSupportsIt: true },
      generatedAt: new Date().toISOString(),
    };
  },

  reports: async (bbox: [number, number, number, number]) => {
    if (SHARED_REPORTS) {
      const r = await rpc<{ reports: PublicReport[]; serverTime: string }>("darbna_reports_for_install", { install: await getInstallId(), min_lng: bbox[0], min_lat: bbox[1], max_lng: bbox[2], max_lat: bbox[3] });
      return { reports: r.reports.map(rescore), serverTime: r.serverTime };
    }
    return localReports();
  },

  createReport: async (category: ReportCategory, coord: LngLat, heading?: number) => {
    if (!SHARED_REPORTS) return localCreate(category, coord, heading);
    const r = await rpc<{ report: PublicReport; duplicate: boolean }>("darbna_create_report", {
      install: await getInstallId(), category, lng: coord[0], lat: coord[1], heading: heading != null && heading >= 0 ? heading : null,
    });
    return { report: rescore(r.report), duplicate: r.duplicate };
  },

  blockReporter: async (id: string): Promise<{ hiddenIds: string[] }> => {
    if (!SHARED_REPORTS) throw new ApiError("unsupported");
    return rpc("darbna_block_reporter", { install: await getInstallId(), report_id: id });
  },

  vote: async (id: string, vote: "confirm" | "gone" | "flag") => {
    if (!SHARED_REPORTS) return localVote(id, vote);
    const r = await rpc<{ report: PublicReport }>("darbna_vote", { install: await getInstallId(), report_id: id, vote });
    return { report: rescore(r.report) };
  },

  /** Slow spots reported by Darbna drivers in the last 15 minutes (empty without shared data). */
  traffic: async (bbox: [number, number, number, number]): Promise<TrafficCell[]> => {
    if (!SHARED_REPORTS) return [];
    const r = await rpc<{ cells: [number, number, number, number, number, number, number][] }>("darbna_traffic", {
      min_lng: bbox[0], min_lat: bbox[1], max_lng: bbox[2], max_lat: bbox[3],
    });
    return r.cells.map(([cell, dir, ratio, trips, samples, lng, lat]) => ({ cell, dir, ratio, trips, samples, coord: [lng, lat] as LngLat }));
  },

  /** Anonymous speed samples from a trip (see core/traffic.ts for what is and isn't sent). */
  trafficSubmit: async (trip: string, samples: SpeedSample[]): Promise<void> => {
    if (!SHARED_REPORTS || !samples.length) return;
    await rpc("darbna_traffic_submit", { trip, samples });
  },

  /** Traffic lights learned from Darbna drivers (see core/signals.ts and darbna_signals). */
  signals: async (bbox: [number, number, number, number]): Promise<LearnedSignal[]> => {
    if (!SHARED_REPORTS) return [];
    const r = await rpc<{ signals: [number, number, number, number, number][] }>("darbna_signals", {
      min_lng: bbox[0], min_lat: bbox[1], max_lng: bbox[2], max_lat: bbox[3],
    });
    return r.signals.map(([lng, lat, dir, trips, waitS]) => ({ coord: [lng, lat] as LngLat, dir, trips, waitS }));
  },

  /** Anonymous red-light stops from a trip (see core/signals.ts for what is and isn't sent). */
  stopSubmit: async (trip: string, stops: StopEvent[]): Promise<void> => {
    if (!SHARED_REPORTS || !stops.length) return;
    await rpc("darbna_stop_submit", { trip, stops });
  },

  /** "Thanks" for a report: +2 points to whoever reported it. */
  thank: async (id: string) => {
    if (!SHARED_REPORTS) throw new ApiError("unsupported");
    const r = await rpc<{ report: PublicReport }>("darbna_thank", { install: await getInstallId(), report_id: id });
    return { report: rescore(r.report) };
  },

  /** Your helper points. */
  /** Prizes: one at every 10 levels, with a claim code for support (supabase/prizes.sql). */
  prizes: async (): Promise<PrizeState> => {
    if (!SHARED_REPORTS) throw new ApiError("unsupported");
    return rpc<PrizeState>("darbna_prizes", { install: await getInstallId() });
  },

  me: async () => {
    if (!SHARED_REPORTS) throw new ApiError("unsupported");
    return rpc<{ points: number; reports: number; thanks: number }>("darbna_me", { install: await getInstallId() });
  },

  /** Start a live "share my trip" link; only this phone (holding the secret) can move it. */
  shareStart: async (destName: string, dest: LngLat, travel: string) => {
    if (!SHARED_REPORTS) throw new ApiError("unsupported");
    return rpc<{ id: string; secret: string }>("darbna_share_start", { install: await getInstallId(), dest_name: destName, dest_lng: dest[0], dest_lat: dest[1], travel });
  },
  shareUpdate: async (id: string, secret: string, u: { coord: LngLat; heading: number | null; etaS: number; remainingM: number; ended?: boolean }) => {
    if (!SHARED_REPORTS) return;
    await rpc("darbna_share_update", {
      share_id: id, secret, lng: u.coord[0], lat: u.coord[1], heading: u.heading ?? -1,
      eta_s: Math.round(u.etaS), remaining_m: Math.round(u.remainingM), ended: !!u.ended,
    });
  },
  shareGet: async (id: string) => {
    if (!SHARED_REPORTS) throw new ApiError("unsupported");
    return rpc<SharedTrip>("darbna_share_get", { share_id: id });
  },

  deleteMe: async () => {
    if (SHARED_REPORTS) await rpc("darbna_delete_me", { install: await getInstallId() });
    await AsyncStorage.removeItem(REPORTS_KEY);
    return { deleted: true };
  },
};

// ---------------------------------------------------------------- routing helpers
/** Public OpenStreetMap routing, for trips that start or end outside Iraq (our own server covers Iraq only). */
const VALHALLA_PUBLIC = "https://valhalla1.openstreetmap.de";
const inIraqBox = ([x, y]: LngLat) => x >= IRAQ_BBOX[0] && x <= IRAQ_BBOX[2] && y >= IRAQ_BBOX[1] && y <= IRAQ_BBOX[3];
function routingBase(body: Record<string, unknown>): string {
  const locs = (body.locations as { lon: number; lat: number }[]) ?? [];
  return VALHALLA !== VALHALLA_PUBLIC && locs.some((l) => !inIraqBox([l.lon, l.lat])) ? VALHALLA_PUBLIC : VALHALLA;
}

async function valhallaRoute(body: Record<string, unknown>) {
  // GET with ?json= is a "simple" CORS request: no preflight needed.
  try {
    return mapValhallaResponse(await getJson(`${routingBase(body)}/route?json=${encodeURIComponent(JSON.stringify(body))}`, 20_000));
  } catch (e: any) {
    if (e?.body) throw new ApiError(valhallaErrorCode(e.body) === "unavailable" ? "generic" : valhallaErrorCode(e.body), e.status);
    throw e;
  }
}

/**
 * "No path" usually means a start or end point got attached to a road island (car park, private
 * lane, pedestrian zone). Try again attaching both ends to the connected network, then to
 * main streets only.
 */
/** On foot: footpaths and pedestrian streets, walking-speed times; no traffic or road-closure detours. */
async function walkRoute(origin: LngLat, destination: LngLat, alternatives: boolean, via: LngLat[]): Promise<RouteResult> {
  const trips = await routeWithSnapFallbacks({ origin, destination, alternatives, travel: "walk", via });
  const routes = trips
    .map((r) => ({ ...r, travel: "walk" as const, avoidedClosureIds: [], reportIdsOnRoute: [], trafficSpans: [], trafficExtraS: 0, startGapM: r.geometry.length ? Math.round(haversine(origin, r.geometry[0])) : 0 }))
    .sort((a, b) => a.durationS - b.durationS);
  return {
    routes, reports: [],
    avoidance: { requested: false, honoured: true, providerSupportsIt: true },
    generatedAt: new Date().toISOString(),
  };
}

async function routeWithSnapFallbacks(input: Parameters<typeof valhallaRouteBody>[0]) {
  let last: unknown;
  const snaps = input.travel === "walk" ? (["default", "connected"] as const) : (["default", "connected", "main", "major"] as const);
  for (const snap of snaps) {
    try {
      return await valhallaRoute(valhallaRouteBody({ ...input, snap }));
    } catch (e) {
      last = e;
      if (!(e instanceof ApiError && (e.code === "no_route" || e.code === "off_network"))) throw e;
    }
  }
  // Say which end is the problem: your position, or the place you picked.
  if (last instanceof ApiError && last.code === "off_network") {
    const body = valhallaRouteBody({ ...input, snap: "default" });
    const locs = body.locations as unknown[];
    const located = await getJson(`${routingBase(body)}/locate?json=${encodeURIComponent(JSON.stringify({ locations: [locs[0]], costing: body.costing }))}`, 10_000).catch(() => null) as { edges?: unknown[] | null }[] | null;
    if (Array.isArray(located) && located[0] && !(located[0].edges?.length)) throw new ApiError("off_network_start", 422);
  }
  throw last;
}

function distanceToLine(p: LngLat, line: LngLat[], step = 1): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += step) best = Math.min(best, projectOnSegment(p, line[i], line[Math.min(i + step, line.length - 1)]).distance);
  return best;
}

function tripBBox(a: LngLat, b: LngLat): [number, number, number, number] | null {
  const pad = 0.15;
  const bbox: [number, number, number, number] = [
    Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad,
  ];
  return bbox[2] - bbox[0] > 2 || bbox[3] - bbox[1] > 2 ? null : bbox;
}

/** Live traffic around a trip (none, or a failure, just means free-flow times). */
async function trafficNear(a: LngLat, b: LngLat): Promise<TrafficCell[]> {
  const bbox = tripBBox(a, b);
  if (!bbox || !SHARED_REPORTS) return [];
  try { return await directApi.traffic(bbox); } catch { return []; }
}

/** Active reports around a trip (missing reports never block routing). */
async function reportsNear(a: LngLat, b: LngLat): Promise<PublicReport[]> {
  const pad = 0.15;
  const bbox: [number, number, number, number] = [
    Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad,
  ];
  try {
    if (!SHARED_REPORTS) return (await localReports()).reports;
    if (bbox[2] - bbox[0] > 2 || bbox[3] - bbox[1] > 2) return [];
    return (await directApi.reports(bbox)).reports;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- device-only fallback
const localReports = async () => ({ reports: (await loadReports()).map(rescore), serverTime: new Date().toISOString() });

async function localCreate(category: ReportCategory, coord: LngLat, heading?: number) {
  const now = new Date();
  const r: PublicReport = rescore({
    id: Crypto.randomUUID(), category, source: "community", verified: false, coord, heading: heading ?? null,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + REPORT_TTL_MIN[category].initial * 60_000).toISOString(),
    confirms: 0, gone: 0, confidence: 0.4, treatment: "display", isSample: false,
  });
  await saveReports([...(await loadReports()), r]);
  return { report: r, duplicate: false };
}

async function localVote(id: string, vote: "confirm" | "gone" | "flag") {
  const all = await loadReports();
  const i = all.findIndex((r) => r.id === id);
  if (i < 0) throw new ApiError("report_not_active", 404);
  const r = { ...all[i], confirms: all[i].confirms + (vote === "confirm" ? 1 : 0), gone: all[i].gone + (vote === "gone" ? 1 : 0) };
  all[i] = rescore(r);
  await saveReports(vote === "confirm" ? all : all.filter((x) => x.id !== id));
  return { report: all[i] };
}
