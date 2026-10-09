import { describe, expect, it } from "bun:test";
import { decodePolyline, destinationPoint, encodePolyline } from "../src/geo";
import { GuidanceEngine } from "../src/guidance";
import { fix, lRoute } from "./fixtures";

describe("polyline", () => {
  it("round-trips precision 6", () => {
    const pts: [number, number][] = [[44.361111, 33.312806], [44.4134, 33.3346], [47.7804, 30.5085]];
    const back = decodePolyline(encodePolyline(pts, 6), 6);
    back.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(pts[i][0], 6);
      expect(p[1]).toBeCloseTo(pts[i][1], 6);
    });
  });
});

describe("GuidanceEngine", () => {
  it("tracks progress along the route", () => {
    const r = lRoute();
    const g = new GuidanceEngine(r);
    const s1 = g.update(fix(destinationPoint(r.geometry[0], 0, 200), 0, { heading: 0 }));
    expect(s1.status).toBe("on_route");
    expect(s1.distanceAlongM).toBeCloseTo(200, -1);
    expect(s1.nextStep?.kind).toBe("right");
    expect(s1.distanceToNextM).toBeCloseTo(1000, -1);
    const s2 = g.update(fix(destinationPoint(r.geometry[0], 0, 700), 40_000, { heading: 0 }));
    expect(s2.remainingM).toBeLessThan(s1.remainingM);
    expect(s2.remainingS).toBeLessThan(s1.remainingS);
  });

  it("ignores a single GPS drift spike (no false reroute)", () => {
    const r = lRoute();
    const g = new GuidanceEngine(r);
    g.update(fix(destinationPoint(r.geometry[0], 0, 300), 0));
    const drift = destinationPoint(destinationPoint(r.geometry[0], 0, 320), 90, 70);
    const s = g.update(fix(drift, 1000, { acc: 20 }));
    expect(s.status).toBe("on_route");
    expect(s.shouldReroute).toBe(false);
    const back = g.update(fix(destinationPoint(r.geometry[0], 0, 340), 2000));
    expect(back.status).toBe("on_route");
  });

  it("never reroutes on poor-accuracy fixes, reports gps_weak instead", () => {
    const r = lRoute();
    const g = new GuidanceEngine(r);
    for (let t = 0; t < 10; t++) {
      const s = g.update(fix(destinationPoint(r.geometry[0], 90, 300), t * 1000, { acc: 120 }));
      expect(s.status).toBe("gps_weak");
      expect(s.shouldReroute).toBe(false);
    }
  });

  it("detects a missed turn and requests exactly one reroute per episode", () => {
    const r = lRoute();
    const g = new GuidanceEngine(r);
    const corner = r.geometry[12];
    let t = 0;
    g.update(fix(destinationPoint(r.geometry[0], 0, 1100), t, { heading: 0 }));
    // Driver continues north past the right turn.
    const reroutes: number[] = [];
    for (let d = 20; d <= 200; d += 15) {
      t += 1500;
      const s = g.update(fix(destinationPoint(corner, 0, d), t, { heading: 0 }));
      if (s.shouldReroute) reroutes.push(d);
    }
    expect(reroutes.length).toBe(1);
    expect(reroutes[0]).toBeGreaterThan(35);
    expect(g.state.status).toBe("off_route");
  });

  it("retries the reroute after a failed request once the cooldown passes", () => {
    const r = lRoute();
    const g = new GuidanceEngine(r);
    const off = (d: number) => destinationPoint(destinationPoint(r.geometry[0], 0, 500), 270, d);
    let fired = 0;
    for (let i = 0; i < 40; i++) {
      const s = g.update(fix(off(100 + i * 5), i * 1000));
      if (s.shouldReroute) {
        fired++;
        g.rerouteFailed(i * 1000); // e.g. offline
      }
    }
    expect(fired).toBeGreaterThanOrEqual(2);
    expect(fired).toBeLessThanOrEqual(3);
  });

  it("detects driving the wrong way along the route", () => {
    const r = lRoute();
    const g = new GuidanceEngine(r);
    let rerouted = false;
    for (let i = 0; i < 15; i++) {
      const s = g.update(fix(destinationPoint(r.geometry[0], 0, 800 - i * 15), i * 1000, { heading: 180, speed: 10 }));
      rerouted ||= s.shouldReroute;
    }
    expect(rerouted).toBe(true);
  });

  it("announces far → near → now exactly once each", () => {
    const r = lRoute();
    const g = new GuidanceEngine(r);
    const stages: string[] = [];
    for (let d = 0; d <= 1200; d += 10) {
      const s = g.update(fix(destinationPoint(r.geometry[0], 0, d), d * 100, { speed: 8, heading: 0 }));
      if (s.announcement) stages.push(s.announcement.stage);
    }
    expect(stages).toEqual(["far", "near", "now"]);
  });

  it("arrives near the destination and stays arrived", () => {
    const r = lRoute();
    const g = new GuidanceEngine(r);
    g.update(fix(destinationPoint(r.geometry[12], 90, 300), 0, { heading: 90 }));
    const s = g.update(fix(destinationPoint(r.geometry[12], 90, 585), 30_000, { heading: 90 }));
    expect(s.status).toBe("arrived");
    expect(s.remainingM).toBe(0);
    expect(g.update(fix(r.geometry[0], 60_000)).status).toBe("arrived");
  });

  it("flags lost GPS when fixes stop", () => {
    const r = lRoute();
    const g = new GuidanceEngine(r);
    g.update(fix(r.geometry[1], 0));
    expect(g.tick(5_000).status).toBe("on_route");
    expect(g.tick(11_000).status).toBe("gps_lost");
  });
});

import { simulateDrive } from "../src/simulate";

describe("simulated drives with noisy GPS", () => {
  it("urban drive with 8 m noise: arrives, no false reroutes", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = simulateDrive(lRoute(), { speedMps: 10, noiseM: 8, seed });
      expect(r.arrived).toBe(true);
      expect(r.reroutes).toBe(0);
      expect(r.announcements).toBeGreaterThanOrEqual(2);
    }
  });
  it("multipath spikes every 7th fix (Baghdad high-rise / bridge) do not trigger reroutes", () => {
    const r = simulateDrive(lRoute(), { speedMps: 9, noiseM: 10, spikeEvery: 7, seed: 9 });
    expect(r.arrived).toBe(true);
    expect(r.reroutes).toBe(0);
  });
  it("highway speed: arrives and announces", () => {
    const r = simulateDrive(lRoute(), { speedMps: 25, noiseM: 6, seed: 3 });
    expect(r.arrived).toBe(true);
    expect(r.reroutes).toBe(0);
  });
  it("very poor GPS (30 m) still never reroutes falsely", () => {
    const r = simulateDrive(lRoute(), { speedMps: 10, noiseM: 30, seed: 11 });
    expect(r.reroutes).toBe(0);
  });
});

describe("missed turn at highway speed", () => {
  it("reroutes within ~2 fixes of leaving the route", () => {
    const r = lRoute();
    const g = new GuidanceEngine(r);
    const corner = r.geometry[12];
    g.update(fix(destinationPoint(r.geometry[0], 0, 1100), 0, { heading: 0, speed: 28 }));
    let firedAt: number | null = null;
    for (let i = 1; i <= 8 && firedAt === null; i++) {
      const s = g.update(fix(destinationPoint(corner, 0, i * 28), i * 1000, { heading: 0, speed: 28 }));
      if (s.shouldReroute) firedAt = i * 28;
    }
    expect(firedAt).not.toBeNull();
    expect(firedAt!).toBeLessThanOrEqual(90);
  });
});
