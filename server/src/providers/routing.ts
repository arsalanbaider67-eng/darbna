import { decodePolyline, type LngLat, type ManeuverKind, type Route, type RouteStep } from "@darbna/core";

export interface RouteRequest {
  origin: LngLat;
  destination: LngLat;
  /** Current heading at origin (degrees), used on reroute so the engine doesn't start with a U-turn. */
  originHeading?: number;
  alternatives: boolean;
  /** Closed rings to route around (verified closures, or reports the driver chose to avoid). */
  excludePolygons: LngLat[][];
}

export type RoutingErrorCode = "no_route" | "off_network" | "unavailable" | "timeout";
export class RoutingError extends Error {
  constructor(public code: RoutingErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface RoutingProvider {
  readonly name: string;
  /** Whether excludePolygons is honoured. */
  readonly supportsExclusions: boolean;
  route(req: RouteRequest): Promise<Route[]>;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if ((e as Error).name === "TimeoutError") throw new RoutingError("timeout");
    throw new RoutingError("unavailable", (e as Error).message);
  }
}

// ---------------------------------------------------------------- Valhalla
// https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/
const VALHALLA_TYPES: Record<number, ManeuverKind> = {
  1: "depart", 2: "depart", 3: "depart",
  4: "arrive", 5: "arrive", 6: "arrive",
  7: "straight", 8: "straight",
  9: "slight_right", 10: "right", 11: "sharp_right",
  12: "uturn", 13: "uturn",
  14: "sharp_left", 15: "left", 16: "slight_left",
  17: "ramp_straight", 18: "ramp_right", 19: "ramp_left",
  20: "exit_right", 21: "exit_left",
  22: "keep_straight", 23: "keep_right", 24: "keep_left",
  25: "merge", 26: "roundabout", 27: "roundabout_exit",
  28: "ferry", 29: "ferry",
  37: "merge", 38: "merge",
};

interface ValhallaManeuver {
  type: number;
  street_names?: string[];
  begin_street_names?: string[];
  length: number; // km (we request kilometers)
  time: number; // s
  begin_shape_index: number;
  roundabout_exit_count?: number;
}
interface ValhallaTrip {
  summary: { length: number; time: number };
  legs: { shape: string; maneuvers: ValhallaManeuver[] }[];
}
export interface ValhallaResponse {
  trip: ValhallaTrip;
  alternates?: { trip: ValhallaTrip }[];
}

export function mapValhallaTrip(trip: ValhallaTrip, id: string): Route {
  const geometry: LngLat[] = [];
  const steps: RouteStep[] = [];
  for (const leg of trip.legs) {
    const offset = geometry.length ? geometry.length - 1 : 0;
    const shape = decodePolyline(leg.shape, 6);
    geometry.push(...(geometry.length ? shape.slice(1) : shape));
    for (const m of leg.maneuvers) {
      const kind = VALHALLA_TYPES[m.type] ?? "straight";
      // Intermediate "arrive"/"depart" between legs are noise for a single-destination trip.
      if (steps.length && kind === "depart") continue;
      const shapeIndex = m.begin_shape_index + offset;
      steps.push({
        index: steps.length,
        kind,
        shapeIndex,
        location: geometry[Math.min(shapeIndex, geometry.length - 1)],
        distanceM: Math.round(m.length * 1000),
        durationS: Math.round(m.time),
        streetName: (m.street_names ?? m.begin_street_names)?.[0],
        roundaboutExit: m.roundabout_exit_count,
      });
    }
  }
  // Main roads: longest named steps, up to 2.
  const via = [...steps]
    .filter((s) => s.streetName)
    .sort((a, b) => b.distanceM - a.distanceM)
    .map((s) => s.streetName!)
    .filter((n, i, a) => a.indexOf(n) === i)
    .slice(0, 2);
  return {
    id,
    provider: "valhalla",
    distanceM: Math.round(trip.summary.length * 1000),
    durationS: Math.round(trip.summary.time),
    durationSource: "engine_no_traffic",
    geometry,
    steps,
    via,
  };
}

export class ValhallaProvider implements RoutingProvider {
  readonly name = "valhalla";
  readonly supportsExclusions = true;
  constructor(private baseUrl: string, private timeoutMs: number) {}

  async route(r: RouteRequest): Promise<Route[]> {
    const body: Record<string, unknown> = {
      locations: [
        { lon: r.origin[0], lat: r.origin[1], ...(r.originHeading !== undefined ? { heading: Math.round(r.originHeading), heading_tolerance: 45 } : {}) },
        { lon: r.destination[0], lat: r.destination[1] },
      ],
      costing: "auto",
      units: "kilometers",
      directions_type: "maneuvers",
      alternates: r.alternatives ? 2 : 0,
    };
    if (r.excludePolygons.length) body.exclude_polygons = r.excludePolygons.map((ring) => ring.map(([lng, lat]) => [lng, lat]));
    const res = await fetchWithTimeout(`${this.baseUrl}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, this.timeoutMs);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error_code?: number; error?: string };
      if (err.error_code === 442 || err.error_code === 443) throw new RoutingError("no_route", err.error);
      if (err.error_code === 171 || err.error_code === 170) throw new RoutingError("off_network", err.error);
      throw new RoutingError("unavailable", `valhalla ${res.status} ${err.error ?? ""}`);
    }
    const data = (await res.json()) as ValhallaResponse;
    const trips = [data.trip, ...(data.alternates ?? []).map((a) => a.trip)];
    return trips.map((t, i) => mapValhallaTrip(t, `v${Date.now().toString(36)}-${i}`));
  }
}

// ---------------------------------------------------------------- OSRM
// Drop-in alternative. Note: OSRM cannot exclude arbitrary polygons, so verified
// closures are NOT avoided with this provider — the route response says so.
const OSRM_MOD: Record<string, ManeuverKind> = {
  "straight": "straight", "slight right": "slight_right", "right": "right", "sharp right": "sharp_right",
  "uturn": "uturn", "sharp left": "sharp_left", "left": "left", "slight left": "slight_left",
};
export class OsrmProvider implements RoutingProvider {
  readonly name = "osrm";
  readonly supportsExclusions = false;
  constructor(private baseUrl: string, private timeoutMs: number) {}
  async route(r: RouteRequest): Promise<Route[]> {
    const coords = `${r.origin[0]},${r.origin[1]};${r.destination[0]},${r.destination[1]}`;
    const url = `${this.baseUrl}/route/v1/driving/${coords}?overview=full&geometries=polyline6&steps=true&alternatives=${r.alternatives}`;
    const res = await fetchWithTimeout(url, {}, this.timeoutMs);
    const data = (await res.json().catch(() => ({}))) as any;
    if (data.code === "NoRoute") throw new RoutingError("no_route");
    if (data.code === "NoSegment") throw new RoutingError("off_network");
    if (!res.ok || data.code !== "Ok") throw new RoutingError("unavailable", `osrm ${res.status}`);
    return data.routes.map((rt: any, i: number) => {
      const geometry = decodePolyline(rt.geometry, 6);
      const steps: RouteStep[] = [];
      let cursor = 0;
      for (const s of rt.legs[0].steps) {
        const sg = decodePolyline(s.geometry, 6);
        const t = s.maneuver.type as string;
        const kind: ManeuverKind =
          t === "depart" ? "depart" : t === "arrive" ? "arrive" :
          t === "roundabout" || t === "rotary" ? "roundabout" :
          t === "merge" ? "merge" :
          OSRM_MOD[s.maneuver.modifier] ?? "straight";
        steps.push({
          index: steps.length, kind, shapeIndex: cursor,
          location: [s.maneuver.location[0], s.maneuver.location[1]],
          distanceM: Math.round(s.distance), durationS: Math.round(s.duration),
          streetName: s.name || undefined, roundaboutExit: s.maneuver.exit,
        });
        cursor += Math.max(0, sg.length - 1);
      }
      return {
        id: `o${Date.now().toString(36)}-${i}`, provider: "osrm",
        distanceM: Math.round(rt.distance), durationS: Math.round(rt.duration),
        durationSource: "engine_no_traffic", geometry, steps,
        via: [...new Set(steps.filter((s) => s.streetName).sort((a, b) => b.distanceM - a.distanceM).map((s) => s.streetName!))].slice(0, 2),
      } satisfies Route;
    });
  }
}
