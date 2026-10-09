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

export interface Snap { point: LngLat; bearing: number; distance: number; /** segment index */ index: number }

/**
 * Closest point on `line` to `p`, if it is within `maxM` metres. With `near` (the segment you
 * were last on), segments just behind and ahead of it are tried first, so a route that loops
 * back past itself (a U-turn, a ramp beside the highway) doesn't make the arrow jump across.
 */
export function snapToLine(p: LngLat, line: LngLat[], maxM: number, near?: number): Snap | null {
  const search = (from: number, to: number): Snap | null => {
    let best: Snap | null = null;
    for (let i = Math.max(1, from); i <= Math.min(line.length - 1, to); i++) {
      const a = line[i - 1], b = line[i];
      const pr = projectOnSegment(p, a, b);
      if (!best || pr.distance < best.distance) best = { point: pr.point, bearing: bearing(a, b), distance: pr.distance, index: i - 1 };
    }
    return best && best.distance <= maxM ? best : null;
  };
  if (near !== undefined) {
    const local = search(near, near + 301); // segments near-1 … near+300
    if (local) return local;
  }
  return search(1, line.length - 1);
}

/** Map-projection (Web Mercator) position, the units MapLibre measures line progress in. */
function merc(c: LngLat): [number, number] {
  const y = Math.log(Math.tan(Math.PI / 4 + (c[1] * Math.PI) / 360));
  return [(c[0] * Math.PI) / 180, y];
}

/** Cumulative length of a line at each vertex, in map-projection units (for "line-progress"). */
export function lineProgressTable(line: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) {
    const a = merc(line[i - 1]), b = merc(line[i]);
    out.push(out[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return out;
}

/** 0..1: how far along the line a point on segment `index` is, as MapLibre's "line-progress" counts it. */
export function lineProgress(table: number[], line: LngLat[], index: number, point: LngLat): number {
  const total = table[table.length - 1];
  if (!total) return 0;
  const a = merc(line[index]), b = merc(point);
  return Math.min(1, Math.max(0, (table[index] + Math.hypot(b[0] - a[0], b[1] - a[1])) / total));
}
