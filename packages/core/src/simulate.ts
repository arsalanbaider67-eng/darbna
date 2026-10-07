import { bearing, cumulativeDistances, destinationPoint, type LngLat } from "./geo";
import { GuidanceEngine, type GuidanceOptions, type LocationFix } from "./guidance";
import type { Route } from "./route";

/** Deterministic PRNG so simulated GPS noise is reproducible in tests. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Point at `d` metres along a polyline, with the local bearing. */
export function pointAlong(line: LngLat[], cum: number[], d: number): { p: LngLat; brg: number } {
  const total = cum[cum.length - 1];
  const x = Math.max(0, Math.min(total, d));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < x) i++;
  const seg = cum[i] - cum[i - 1];
  const brg = bearing(line[i - 1], line[i]);
  return { p: seg > 0 ? destinationPoint(line[i - 1], brg, x - cum[i - 1]) : line[i - 1], brg };
}

export interface DriveResult {
  arrived: boolean;
  reroutes: number;
  announcements: number;
  maxOffRouteM: number;
  fixes: number;
  gpsWeakFixes: number;
}

/**
 * Drive a route at a constant speed with noisy GPS (Gaussian-ish noise of `noiseM`,
 * occasional multipath spikes) and report what the engine did. Used both by unit tests
 * and by the real-network journey checker in server/scripts.
 */
export function simulateDrive(route: Route, opts: { speedMps?: number; noiseM?: number; spikeEvery?: number; seed?: number; engine?: Partial<GuidanceOptions> } = {}): DriveResult {
  const speed = opts.speedMps ?? 12;
  const noise = opts.noiseM ?? 8;
  const rand = mulberry32(opts.seed ?? 42);
  const gauss = () => (rand() + rand() + rand() - 1.5) * 1.15; // ~N(0,1)
  const engine = new GuidanceEngine(route, opts.engine);
  const cum = cumulativeDistances(route.geometry);
  const total = cum[cum.length - 1];
  const res: DriveResult = { arrived: false, reroutes: 0, announcements: 0, maxOffRouteM: 0, fixes: 0, gpsWeakFixes: 0 };
  for (let t = 0, d = 0; d <= total + 40; t += 1000, d += speed) {
    const { p, brg } = pointAlong(route.geometry, cum, d);
    let err = Math.abs(gauss()) * noise;
    let acc = Math.max(5, noise * 1.3);
    if (opts.spikeEvery && res.fixes > 0 && res.fixes % opts.spikeEvery === 0) { err = 60 + rand() * 60; acc = 25; }
    const noisy = destinationPoint(p, rand() * 360, err);
    const fix: LocationFix = { coord: noisy, accuracyM: acc, speedMps: speed, headingDeg: (brg + gauss() * 5 + 360) % 360, timestamp: t };
    const s = engine.update(fix);
    res.fixes++;
    if (s.status === "gps_weak") res.gpsWeakFixes++;
    if (s.shouldReroute) res.reroutes++;
    if (s.announcement) res.announcements++;
    res.maxOffRouteM = Math.max(res.maxOffRouteM, s.offRouteDistanceM);
    if (s.status === "arrived") { res.arrived = true; break; }
  }
  return res;
}
