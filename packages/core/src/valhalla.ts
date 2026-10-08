import { decodePolyline, type LngLat } from "./geo";
import type { ManeuverKind, Route, RouteStep } from "./route";

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
export interface ValhallaTrip {
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


export interface ValhallaRouteInput {
  origin: LngLat;
  destination: LngLat;
  originHeading?: number;
  alternatives: boolean;
  excludePolygons?: LngLat[][];
}

/** Request body for Valhalla's /route (used by the server and by the server-less web build). */
export function valhallaRouteBody(r: ValhallaRouteInput): Record<string, unknown> {
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
  if (r.excludePolygons?.length) body.exclude_polygons = r.excludePolygons.map((ring) => ring.map(([lng, lat]) => [lng, lat]));
  return body;
}

/** Map a Valhalla error body to Darbna's routing error codes. */
export function valhallaErrorCode(err: { error_code?: number }): "no_route" | "off_network" | "unavailable" {
  if (err.error_code === 442 || err.error_code === 443) return "no_route";
  if (err.error_code === 171 || err.error_code === 170) return "off_network";
  return "unavailable";
}

export function mapValhallaResponse(data: ValhallaResponse): Route[] {
  const trips = [data.trip, ...(data.alternates ?? []).map((a) => a.trip)];
  return trips.map((t, i) => mapValhallaTrip(t, `v${Date.now().toString(36)}-${i}`));
}
