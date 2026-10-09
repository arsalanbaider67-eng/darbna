/**
 * Keeps your position on the map steady and accurate:
 *  - FixFilter drops GPS fixes that are clearly worse than the ones just before (phones
 *    sometimes report a Wi-Fi/cell guess 10–50 m off between two good GPS fixes).
 *  - snapToLine puts your arrow on the road you're driving (the route line), like Waze does.
 */
import { bearing, haversine, projectOnSegment, type LngLat } from "./geo";

export interface RawFix { coord: LngLat; accuracyM: number; at: number }

export class FixFilter {
  private good: RawFix | null = null;
  private rejected = 0;

  /** True when this fix should be used. */
  accept(f: RawFix): boolean {
    const g = this.good;
    if (!g || f.at - g.at > 15_000 || this.rejected >= 4) return this.keep(f);
    const worse = f.accuracyM > Math.max(25, g.accuracyM * 2.5);
    // Faster than ~180 km/h plus both error circles: a jump, not a movement.
    const dt = Math.max(1, (f.at - g.at) / 1000);
    const jump = haversine(g.coord, f.coord) > dt * 50 + f.accuracyM + g.accuracyM;
    if (worse || jump) { this.rejected++; return false; }
    return this.keep(f);
  }

  private keep(f: RawFix): boolean {
    this.good = f;
    this.rejected = 0;
    return true;
  }
}

export interface Snap { point: LngLat; bearing: number; distance: number }

/** Closest point on `line` to `p`, if it is within `maxM` metres. */
export function snapToLine(p: LngLat, line: LngLat[], maxM: number): Snap | null {
  let best: Snap | null = null;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const pr = projectOnSegment(p, a, b);
    if (!best || pr.distance < best.distance) best = { point: pr.point, bearing: bearing(a, b), distance: pr.distance };
  }
  return best && best.distance <= maxM ? best : null;
}
