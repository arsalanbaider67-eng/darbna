/**
 * Live traffic from Darbna drivers (crowdsourced, like Waze).
 *
 * While navigating, the app measures how fast the car actually covers each ~200 m of its route
 * and compares that with what the routing engine expected for that road. Samples are keyed by a
 * ~110 m grid cell plus one of 8 travel directions, so opposite carriageways stay separate.
 * The database (supabase/schema.sql) keeps the median of per-trip ratios over the last 15 minutes.
 *
 * Privacy: samples carry no account or device id (only a random per-trip id, so one car can't
 * outvote others), the first and last 300 m of every trip are never sent, and samples are deleted
 * after two hours.
 */
import { bearing, cumulativeDistances, haversine, type LngLat } from "./geo";
import type { Route } from "./route";

export const TRAFFIC_CELL_DEG = { lat: 0.001, lng: 0.0012 } as const;

/** Grid cell id; must match darbna_private.traffic_cell() in supabase/schema.sql. */
export function trafficCell([lng, lat]: LngLat): number {
  return Math.floor(lat / TRAFFIC_CELL_DEG.lat) * 100_000 + Math.floor(lng / TRAFFIC_CELL_DEG.lng);
}

/** Travel direction in 8 buckets of 45° (0 = north). */
export function dirBucket(headingDeg: number): number {
  return ((Math.round((((headingDeg % 360) + 360) % 360) / 45) % 8) + 8) % 8;
}

export interface TrafficCell {
  cell: number;
  dir: number;
  /** Observed speed ÷ expected speed (median across trips). 1 = free flow. */
  ratio: number;
  trips: number;
  samples: number;
  /** Cell centre, for drawing jams on the map. */
  coord: LngLat;
}

export type TrafficLevel = "free" | "slow" | "heavy";
export function trafficLevel(ratio: number): TrafficLevel {
  return ratio < 0.4 ? "heavy" : ratio < 0.7 ? "slow" : "free";
}

export interface TrafficSpan {
  /** Route.geometry indices: the span covers geometry[from]..geometry[to]. */
  from: number;
  to: number;
  level: Exclude<TrafficLevel, "free">;
}

export interface TrafficResult {
  route: Route;
  /** Extra seconds over the free-flow estimate. */
  extraS: number;
  spans: TrafficSpan[];
}

/** Index of the step covering geometry point i (steps are ordered by shapeIndex). */
function stepAt(route: Route, i: number): number {
  let k = 0;
  while (k + 1 < route.steps.length && route.steps[k + 1].shapeIndex <= i) k++;
  return k;
}

/**
 * Slow the route down where Darbna drivers are going slower than expected, and return the slow
 * spans so the map can colour them. Step durations are adjusted too, so guidance ETAs follow.
 */
export function applyTraffic(route: Route, cells: TrafficCell[]): TrafficResult {
  if (!cells.length || route.geometry.length < 2) return { route, extraS: 0, spans: [] };
  const byKey = new Map<string, TrafficCell>();
  for (const c of cells) byKey.set(`${c.cell}:${c.dir}`, c);
  const steps = route.steps.map((s) => ({ ...s }));
  const spans: TrafficSpan[] = [];
  let extraS = 0;
  const g = route.geometry;
  for (let i = 0; i < g.length - 1; i++) {
    const len = haversine(g[i], g[i + 1]);
    if (len < 0.5) continue;
    const mid: LngLat = [(g[i][0] + g[i + 1][0]) / 2, (g[i][1] + g[i + 1][1]) / 2];
    const d = dirBucket(bearing(g[i], g[i + 1]));
    const cell = trafficCell(mid);
    const hit = byKey.get(`${cell}:${d}`) ?? byKey.get(`${cell}:${(d + 1) % 8}`) ?? byKey.get(`${cell}:${(d + 7) % 8}`);
    if (!hit) continue;
    const level = trafficLevel(hit.ratio);
    if (level === "free") continue;
    const k = stepAt(route, i);
    const st = steps[k];
    const orig = route.steps[k]; // free-flow speed from the untouched step
    const expected = orig && orig.durationS > 0 && orig.distanceM > 0 ? orig.distanceM / orig.durationS : 11;
    const delay = (len / expected) * (1 / Math.max(hit.ratio, 0.15) - 1);
    extraS += delay;
    if (st) st.durationS += delay;
    const last = spans[spans.length - 1];
    if (last && last.level === level && last.to === i) last.to = i + 1;
    else spans.push({ from: i, to: i + 1, level });
  }
  if (extraS < 1) return { route, extraS: 0, spans };
  return {
    route: { ...route, steps, durationS: route.durationS + extraS, durationSource: "darbna_live_traffic" },
    extraS,
    spans,
  };
}

export interface SpeedSample {
  lat: number;
  lng: number;
  heading: number;
  /** m/s actually achieved over the last stretch. */
  speed: number;
  /** m/s the routing engine expected on that road. */
  expected: number;
}

/**
 * Turns navigation progress into speed samples: one per ~200 m driven (or 45 s, whichever first),
 * using distance along the route over elapsed time, which smooths out GPS noise.
 */
export class TrafficSampler {
  private cum: number[];
  private stepStart: number[];
  private total: number;
  private last: { along: number; t: number } | null = null;

  constructor(private route: Route, private opts = { everyM: 200, everyMs: 45_000, privacyM: 300, maxGapMs: 120_000 }) {
    this.cum = cumulativeDistances(route.geometry);
    this.total = this.cum[this.cum.length - 1] ?? 0;
    this.stepStart = route.steps.map((s) => this.cum[Math.min(s.shapeIndex, this.cum.length - 1)] ?? 0);
  }

  private expectedAt(along: number): number {
    let k = 0;
    while (k + 1 < this.stepStart.length && this.stepStart[k + 1] <= along) k++;
    const s = this.route.steps[k];
    return s && s.durationS > 0 && s.distanceM > 0 ? s.distanceM / s.durationS : 11;
  }

  private pointAt(along: number): { p: LngLat; brg: number } {
    const g = this.route.geometry;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < along) i++;
    const a = g[i - 1], b = g[i] ?? a;
    const seg = this.cum[i] - this.cum[i - 1];
    const f = seg > 0 ? Math.min(1, Math.max(0, (along - this.cum[i - 1]) / seg)) : 0;
    return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], brg: bearing(a, b) };
  }

  /** Feed on-route progress; returns a sample when one is due. Off-route fixes: call reset(). */
  feed(alongM: number, now: number): SpeedSample | null {
    if (!this.last || now - this.last.t > this.opts.maxGapMs || alongM < this.last.along - 50) {
      this.last = { along: alongM, t: now };
      return null;
    }
    const moved = alongM - this.last.along;
    const dt = now - this.last.t;
    if (moved < this.opts.everyM && dt < this.opts.everyMs) return null;
    const startAlong = this.last.along;
    this.last = { along: alongM, t: now };
    const midAlong = (startAlong + alongM) / 2;
    // Never send anything near where the trip started or ends (home, work…).
    if (startAlong < this.opts.privacyM || alongM > this.total - this.opts.privacyM) return null;
    if (dt < 5_000 || moved < 0) return null;
    const { p, brg } = this.pointAt(midAlong);
    return {
      lat: Math.round(p[1] * 1e5) / 1e5,
      lng: Math.round(p[0] * 1e5) / 1e5,
      heading: Math.round(brg),
      speed: Math.round((moved / (dt / 1000)) * 10) / 10,
      expected: Math.round(this.expectedAt(midAlong) * 10) / 10,
    };
  }

  reset(): void {
    this.last = null;
  }
}
