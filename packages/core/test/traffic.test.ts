import { describe, expect, test } from "bun:test";
import { applyTraffic, cumulativeDistances, dirBucket, TrafficSampler, trafficCell, trafficLevel, bearing, type TrafficCell } from "../src";
import { lRoute } from "./fixtures";

describe("traffic cells", () => {
  test("cell id is stable and matches the SQL formula", () => {
    // floor(33.3128/0.001)=33312, floor(44.3615/0.0012)=36967
    expect(trafficCell([44.3615, 33.3128])).toBe(33312 * 100000 + 36967);
  });
  test("direction buckets", () => {
    expect(dirBucket(0)).toBe(0);
    expect(dirBucket(359)).toBe(0);
    expect(dirBucket(90)).toBe(2);
    expect(dirBucket(-90)).toBe(6);
    expect(dirBucket(200)).toBe(4);
  });
  test("levels", () => {
    expect(trafficLevel(0.2)).toBe("heavy");
    expect(trafficLevel(0.55)).toBe("slow");
    expect(trafficLevel(0.9)).toBe("free");
  });
});

describe("applyTraffic", () => {
  const r = lRoute();
  const cellsAlong = (ratio: number, from = 0, to = r.geometry.length - 1): TrafficCell[] => {
    const out: TrafficCell[] = [];
    for (let i = from; i < to; i++) {
      const a = r.geometry[i], b = r.geometry[i + 1];
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      out.push({ cell: trafficCell(mid), dir: dirBucket(bearing(a, b)), ratio, trips: 2, samples: 4, coord: mid });
    }
    return out;
  };

  test("no data → unchanged", () => {
    const res = applyTraffic(r, []);
    expect(res.route).toBe(r);
    expect(res.extraS).toBe(0);
  });

  test("heavy traffic everywhere roughly quadruples a ratio-0.25 route", () => {
    const res = applyTraffic(r, cellsAlong(0.25));
    expect(res.route.durationSource).toBe("darbna_live_traffic");
    expect(res.route.durationS).toBeGreaterThan(r.durationS * 3.5);
    expect(res.route.durationS).toBeLessThan(r.durationS * 4.5);
    // step durations follow so guidance ETAs include traffic
    expect(res.route.steps.reduce((s, x) => s + x.durationS, 0)).toBeCloseTo(res.route.durationS, 0);
    expect(res.spans.every((s) => s.level === "heavy")).toBe(true);
  });

  test("free-flow cells add nothing; opposite direction is ignored", () => {
    expect(applyTraffic(r, cellsAlong(0.95)).extraS).toBe(0);
    const opposite = cellsAlong(0.2).map((c) => ({ ...c, dir: (c.dir + 4) % 8 }));
    expect(applyTraffic(r, opposite).extraS).toBe(0);
  });

  test("spans merge consecutive segments", () => {
    const res = applyTraffic(r, cellsAlong(0.5, 0, 3));
    expect(res.spans.length).toBe(1);
    expect(res.spans[0]).toEqual({ from: 0, to: 3, level: "slow" });
  });
});

describe("TrafficSampler", () => {
  const r = lRoute();
  const total = cumulativeDistances(r.geometry).at(-1)!;

  test("samples every ~200 m, never near the start or end", () => {
    const s = new TrafficSampler(r);
    const out = [];
    for (let t = 0, along = 0; along <= total; t += 1000, along += 10) {
      const x = s.feed(along, t);
      if (x) out.push({ ...x, along });
    }
    expect(out.length).toBeGreaterThan(0);
    for (const x of out) {
      expect(x.along - 200).toBeGreaterThanOrEqual(300);
      expect(x.along).toBeLessThanOrEqual(total - 300);
      expect(x.speed).toBeCloseTo(10, 0);
      expect(x.expected).toBeGreaterThan(0);
    }
  });

  test("a long GPS gap restarts measuring instead of reporting a fake jam", () => {
    const s = new TrafficSampler(r);
    expect(s.feed(400, 0)).toBeNull();
    expect(s.feed(450, 200_000)).toBeNull();
  });
});
