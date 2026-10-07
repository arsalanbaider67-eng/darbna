import type { LngLat } from "./geo";

export type ManeuverKind =
  | "depart" | "arrive"
  | "straight" | "slight_right" | "right" | "sharp_right" | "uturn"
  | "sharp_left" | "left" | "slight_left"
  | "ramp_right" | "ramp_left" | "ramp_straight"
  | "exit_right" | "exit_left"
  | "keep_right" | "keep_left" | "keep_straight"
  | "merge" | "roundabout" | "roundabout_exit" | "ferry";

export interface RouteStep {
  index: number;
  kind: ManeuverKind;
  /** Index into Route.geometry where this maneuver happens. */
  shapeIndex: number;
  location: LngLat;
  /** Length of road covered *after* this maneuver until the next one. */
  distanceM: number;
  durationS: number;
  streetName?: string;
  /** Exit number for roundabouts. */
  roundaboutExit?: number;
}

export type DurationSource =
  /** Free-flow road-graph estimate. No live or historic traffic was used. */
  | "engine_no_traffic";

export interface Route {
  id: string;
  provider: string;
  distanceM: number;
  durationS: number;
  durationSource: DurationSource;
  geometry: LngLat[];
  steps: RouteStep[];
  /** Main road names, for distinguishing alternatives. */
  via: string[];
  /** Verified official closures avoided by this route. */
  avoidedClosureIds?: string[];
}

export interface RouteResponse {
  routes: Route[];
  /** Community reports near the route that the user may want to know about (not avoided). */
  advisoryReportIds: string[];
  generatedAt: string;
}
