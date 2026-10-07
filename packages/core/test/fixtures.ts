import { destinationPoint, LngLat } from "../src/geo";
import type { Route } from "../src/route";

/**
 * Synthetic L-shaped route (test fixture, not real road data): 1.2 km north,
 * then right, then 600 m east, starting near Tahrir Square, Baghdad.
 */
export function lRoute(): Route {
  const start: LngLat = [44.4134, 33.3346];
  const geom: LngLat[] = [start];
  for (let i = 1; i <= 12; i++) geom.push(destinationPoint(start, 0, i * 100));
  const corner = geom[geom.length - 1];
  for (let i = 1; i <= 6; i++) geom.push(destinationPoint(corner, 90, i * 100));
  return {
    id: "fixture-l",
    provider: "fixture",
    distanceM: 1800,
    durationS: 180,
    durationSource: "engine_no_traffic",
    geometry: geom,
    via: ["Test St"],
    steps: [
      { index: 0, kind: "depart", shapeIndex: 0, location: geom[0], distanceM: 1200, durationS: 120, streetName: "North St" },
      { index: 1, kind: "right", shapeIndex: 12, location: geom[12], distanceM: 600, durationS: 60, streetName: "East St" },
      { index: 2, kind: "arrive", shapeIndex: 18, location: geom[18], distanceM: 0, durationS: 0 },
    ],
  };
}

export const fix = (coord: LngLat, t: number, extra: Partial<{ acc: number; speed: number; heading: number }> = {}) => ({
  coord,
  accuracyM: extra.acc ?? 8,
  speedMps: extra.speed ?? 12,
  headingDeg: extra.heading ?? null,
  timestamp: t,
});
