import { describe, expect, it } from "bun:test";
import { destinationPoint } from "../src/geo";
import { laneHint, levelFor, reportsAhead, speedLimitAt, speedLimitSpans } from "../src/extras";
import { mapValhallaTrip, valhallaRouteBody } from "../src/valhalla";
import { encodePolyline } from "../src/geo";

describe("lane hints", () => {
  it("keep right for a right exit, nothing for a plain turn", () => {
    expect(laneHint({ index: 1, kind: "exit_right", shapeIndex: 0, location: [44, 33], distanceM: 0, durationS: 0 })!.use).toEqual([false, false, true]);
    expect(laneHint({ index: 1, kind: "right", shapeIndex: 0, location: [44, 33], distanceM: 0, durationS: 0 })).toBeNull();
  });
});

describe("reports ahead", () => {
  const start: [number, number] = [44.4, 33.3];
  const line = Array.from({ length: 21 }, (_, i) => destinationPoint(start, 0, i * 100)); // 2 km north
  const cp = { coord: destinationPoint(destinationPoint(start, 0, 900), 90, 10), category: "checkpoint" as const };
  const pothole = { coord: destinationPoint(start, 0, 500), category: "pothole" as const };
  const behind = { coord: destinationPoint(start, 0, 100), category: "camera" as const };
  it("warns for a checkpoint 600 m ahead, not for potholes or things behind", () => {
    const r = reportsAhead(line, 300, [cp, pothole, behind]);
    expect(r.length).toBe(1);
    expect(r[0].item).toBe(cp);
    expect(r[0].distanceM).toBeGreaterThan(590);
    expect(r[0].distanceM).toBeLessThan(610);
  });
  it("stays quiet when it's beyond the warning distance", () => {
    expect(reportsAhead(line, 0, [cp]).length).toBe(0); // 900 m > 800 m
  });
});

describe("speed limits", () => {
  it("merges edges and looks up by shape index, skipping unknown limits", () => {
    const spans = speedLimitSpans({ edges: [
      { speed_limit: 60, begin_shape_index: 0, end_shape_index: 3 },
      { speed_limit: 60, begin_shape_index: 3, end_shape_index: 5 },
      { speed_limit: 0, begin_shape_index: 5, end_shape_index: 8 },
      { speed_limit: 100, begin_shape_index: 8, end_shape_index: 12 },
    ] });
    expect(spans).toEqual([{ from: 0, to: 5, kmh: 60 }, { from: 8, to: 12, kmh: 100 }]);
    expect(speedLimitAt(spans, 4)).toBe(60);
    expect(speedLimitAt(spans, 6)).toBeNull();
    expect(speedLimitAt(spans, 9)).toBe(100);
  });
});

describe("levels", () => {
  it("counts up through the levels", () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(60).level).toBe(2);
    expect(levelFor(3000)).toEqual({ level: 6, next: null, progress: 1 });
  });
});

describe("stops and avoid options", () => {
  it("puts stops between start and destination as breaks, and avoids highways/dirt roads", () => {
    const b = valhallaRouteBody({ origin: [44, 33], destination: [44.1, 33], alternatives: true, via: [[44.05, 33]], avoid: { highways: true, unpaved: true } }) as any;
    expect(b.locations.length).toBe(3);
    expect(b.locations[1].type).toBe("break");
    expect(b.alternates).toBe(0);
    expect(b.costing_options.auto).toEqual({ use_highways: 0, exclude_unpaved: true });
  });
  it("marks the arrival at a stop as a waypoint, the last one as arrive", () => {
    const leg = (a: [number, number], b: [number, number]) => ({ shape: encodePolyline([a, b], 6), maneuvers: [
      { type: 1, length: 1, time: 60, begin_shape_index: 0 }, { type: 4, length: 0, time: 0, begin_shape_index: 1 }] });
    const r = mapValhallaTrip({ summary: { length: 2, time: 120 }, legs: [leg([44, 33], [44.01, 33]), leg([44.01, 33], [44.02, 33])] }, "x");
    expect(r.steps.map((s) => s.kind)).toEqual(["depart", "waypoint", "arrive"]);
  });
});
