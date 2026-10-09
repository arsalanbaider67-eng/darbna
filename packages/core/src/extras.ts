/**
 * Driving extras: lane hints, warnings ahead on the route, speed limits, and helper levels.
 * Pure functions (unit-tested); the app decides how to show them.
 */
import { cumulativeDistances, haversine, projectOnSegment, type LngLat } from "./geo";
import type { RouteStep } from "./route";
import { WARN_AHEAD, type ReportCategory } from "./reports";

// ---------------------------------------------------------------- lane hints
export interface LaneHint {
  /** Lanes drawn, left to right. */
  lanes: number;
  /** Which lanes to use (true = use). */
  use: boolean[];
}

/**
 * Which side of the road to be on for an exit, ramp or fork. The map data rarely says how many
 * lanes a road in Iraq has, so this is a hint ("keep right"), drawn as three lanes.
 */
export function laneHint(step: RouteStep): LaneHint | null {
  switch (step.kind) {
    case "exit_right": case "ramp_right": case "keep_right": return { lanes: 3, use: [false, false, true] };
    case "exit_left": case "ramp_left": case "keep_left": return { lanes: 3, use: [true, false, false] };
    case "keep_straight": case "ramp_straight": return { lanes: 3, use: [false, true, false] };
    default: return null;
  }
}

// ---------------------------------------------------------------- reports ahead
export interface AheadReport<T> { item: T; distanceM: number }

/**
 * Reports lying on the route ahead of you (within 40 m of the line), nearest first, each only
 * within its category's warning distance (WARN_AHEAD).
 */
export function reportsAhead<T extends { coord: LngLat; category: ReportCategory }>(
  line: LngLat[], alongM: number, items: T[], cum: number[] = cumulativeDistances(line),
): AheadReport<T>[] {
  const out: AheadReport<T>[] = [];
  for (const it of items) {
    const warn = WARN_AHEAD[it.category];
    if (!warn) continue;
    let best = Infinity, at = 0;
    for (let i = 0; i < line.length - 1; i++) {
      // Only look at the stretch from here to the warning distance ahead.
      if (cum[i + 1] < alongM - 20) continue;
      if (cum[i] > alongM + warn) break;
      const pr = projectOnSegment(it.coord, line[i], line[i + 1]);
      if (pr.distance < best) { best = pr.distance; at = cum[i] + haversine(line[i], pr.point); }
    }
    const d = at - alongM;
    if (best <= 40 && d >= 0 && d <= warn) out.push({ item: it, distanceM: d });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

// ---------------------------------------------------------------- speed limits
export interface SpeedLimitSpan { from: number; to: number; kmh: number }

/**
 * Speed limits along a route from Valhalla's /trace_attributes answer (edge.speed_limit per
 * edge, by shape index). Unknown limits are left out, so nothing is shown there.
 */
export function speedLimitSpans(res: { edges?: { speed_limit?: number | string; begin_shape_index?: number; end_shape_index?: number }[] }): SpeedLimitSpan[] {
  const out: SpeedLimitSpan[] = [];
  for (const e of res.edges ?? []) {
    const kmh = typeof e.speed_limit === "number" ? e.speed_limit : NaN;
    if (!(kmh >= 5 && kmh <= 140) || e.begin_shape_index == null || e.end_shape_index == null) continue;
    const last = out[out.length - 1];
    if (last && last.kmh === kmh && last.to >= e.begin_shape_index - 1) last.to = e.end_shape_index;
    else out.push({ from: e.begin_shape_index, to: e.end_shape_index, kmh });
  }
  return out;
}

export function speedLimitAt(spans: SpeedLimitSpan[], shapeIndex: number): number | null {
  for (const s of spans) if (shapeIndex >= s.from && shapeIndex < s.to) return s.kmh;
  return null;
}

// ---------------------------------------------------------------- helper levels
/** Points needed for each level (index = level − 1). */
export const LEVEL_POINTS = [0, 50, 150, 400, 1000, 2500];

export function levelFor(points: number): { level: number; next: number | null; progress: number } {
  let level = 1;
  for (let i = 0; i < LEVEL_POINTS.length; i++) if (points >= LEVEL_POINTS[i]) level = i + 1;
  const next = LEVEL_POINTS[level] ?? null;
  const base = LEVEL_POINTS[level - 1];
  return { level, next, progress: next == null ? 1 : (points - base) / (next - base) };
}
