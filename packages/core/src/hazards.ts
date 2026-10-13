/**
 * Fixed road hazards from OpenStreetMap (data/road-hazards.json, refreshed monthly by
 * .github/workflows/road-hazards.yml): speed bumps and speed cameras across Iraq.
 * They are shown on the map and warned about ahead on a route, like drivers' reports.
 */
import { projectOnSegment, type LngLat } from "./geo";

export type HazardKind = "bump" | "camera";
export interface RoadHazard {
  id: string;
  kind: HazardKind;
  coord: LngLat;
  /** Posted limit at a camera, when mapped. */
  maxspeedKmh?: number;
}
export interface RoadHazardsDoc {
  source: string;
  fetched: string;
  counts: Record<string, number>;
  items: [HazardKind, number, number, number?][];
}

export function parseHazards(doc: RoadHazardsDoc | null | undefined): RoadHazard[] {
  if (!doc?.items) return [];
  return doc.items
    .filter((r) => (r[0] === "bump" || r[0] === "camera") && Number.isFinite(r[1]) && Number.isFinite(r[2]))
    .map((r, i) => ({ id: `osm-${r[0]}-${i}-${r[1].toFixed(5)},${r[2].toFixed(5)}`, kind: r[0], coord: [r[1], r[2]] as LngLat, maxspeedKmh: r[3] }));
}

/** Hazards within `maxM` of a route line (cheap bounding-box test first, then distance to the line). */
export function hazardsOnRoute(line: LngLat[], hazards: RoadHazard[], maxM = 30): RoadHazard[] {
  if (line.length < 2 || hazards.length === 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of line) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const pad = 0.001; // ~100 m
  const near = hazards.filter(({ coord: [x, y] }) => x >= minX - pad && x <= maxX + pad && y >= minY - pad && y <= maxY + pad);
  return near.filter((h) => {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      // skip segments clearly far away (> ~300 m in lat/lng box)
      if (Math.min(a[0], b[0]) - 0.003 > h.coord[0] || Math.max(a[0], b[0]) + 0.003 < h.coord[0]) continue;
      if (Math.min(a[1], b[1]) - 0.003 > h.coord[1] || Math.max(a[1], b[1]) + 0.003 < h.coord[1]) continue;
      if (projectOnSegment(h.coord, a, b).distance <= maxM) return true;
    }
    return false;
  });
}
