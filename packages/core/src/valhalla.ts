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
  trip.legs.forEach((leg, li) => {
    const lastLeg = li === trip.legs.length - 1;
    const offset = geometry.length ? geometry.length - 1 : 0;
    const shape = decodePolyline(leg.shape, 6);
    geometry.push(...(geometry.length ? shape.slice(1) : shape));
    for (const m of leg.maneuvers) {
      let kind = VALHALLA_TYPES[m.type] ?? "straight";
      if (kind === "arrive" && !lastLeg) kind = "waypoint";
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
  });
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
  /**
   * How to attach the start/end points to the road network.
   *  - "default": nearest road.
   *  - "connected": only roads that connect to a large part of the network (skips car parks,
   *    private lanes and other small islands that make Valhalla answer "no path").
   *  - "main": like "connected", and ignore service roads entirely.
   *  - "major": start from the nearest tertiary-or-bigger road (last resort, for streets the map
   *    data leaves disconnected from the network); the destination keeps "main" snapping.
   * The heading hint is dropped for the fallbacks (a wrong heading can also cause "no path").
   */
  snap?: "default" | "connected" | "main" | "major";
  /** "walk": footpaths, pedestrian streets, crossings, both directions of one-way streets. */
  travel?: "car" | "walk";
  /** Stops on the way, in order. */
  via?: LngLat[];
  /** Car only: stay off motorways/trunk roads, or off dirt roads. */
  avoid?: { highways?: boolean; unpaved?: boolean };
}

/** Request body for Valhalla's /route (used by the server and by the server-less web build). */
export function valhallaRouteBody(r: ValhallaRouteInput): Record<string, unknown> {
  const walk = r.travel === "walk";
  // Walking may start on a footpath, so the road-class filters only apply to cars.
  const snap = walk && (r.snap === "main" || r.snap === "major") ? "connected" : r.snap ?? "default";
  const extra: Record<string, unknown> =
    snap === "default" ? {} :
    snap === "connected" ? { minimum_reachability: 100, radius: 0 } :
    { minimum_reachability: 100, search_filter: { min_road_class: "residential" } };
  const originExtra = snap === "major" ? { minimum_reachability: 100, search_filter: { min_road_class: "tertiary" } } : extra;
  const heading = !walk && snap === "default" && r.originHeading !== undefined ? { heading: Math.round(r.originHeading), heading_tolerance: 45 } : {};
  const body: Record<string, unknown> = {
    locations: [
      { lon: r.origin[0], lat: r.origin[1], ...heading, ...originExtra },
      ...(r.via ?? []).map((v) => ({ lon: v[0], lat: v[1], type: "break", ...extra })),
      { lon: r.destination[0], lat: r.destination[1], ...extra },
    ],
    costing: walk ? "pedestrian" : "auto",
    units: "kilometers",
    directions_type: "maneuvers",
    alternates: r.alternatives ? 2 : 0,
  };
  if (!walk && (r.avoid?.highways || r.avoid?.unpaved)) {
    body.costing_options = { auto: { ...(r.avoid.highways ? { use_highways: 0 } : {}), ...(r.avoid.unpaved ? { exclude_unpaved: true } : {}) } };
  }
  // More than one stop: alternatives aren't offered by Valhalla.
  if (r.via?.length) body.alternates = 0;
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
