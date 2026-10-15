import { describe, expect, it } from "bun:test";
import { StopDetector, placeLearnedSignals, signalCell, type LearnedSignal } from "../src/signals";
import type { LngLat } from "../src/geo";

// Drive east along a street in Baghdad: 1 fix per second.
const M = 1 / 92_000; // ≈ 1 m of longitude here
function drive(d: StopDetector, from: number, meters: number, speed: number, t0: number) {
  const out = [];
  let x = from, t = t0;
  for (let i = 0; i < meters / speed; i++) {
    x += speed * M; t += 1000;
    const e = d.feed({ coord: [44.40 + x, 33.30] as LngLat, speedMps: speed, headingDeg: 90, t });
    if (e) out.push(e);
  }
  return { x, t, out };
}
function wait(d: StopDetector, x: number, secs: number, t0: number, jitter = 1.5) {
  let t = t0;
  for (let i = 0; i < secs; i++) {
    t += 1000;
    d.feed({ coord: [44.40 + x + (i % 2 ? jitter : -jitter) * M, 33.30] as LngLat, speedMps: 0.2, headingDeg: null, t });
  }
  return t;
}

describe("StopDetector (traffic lights learned from drivers)", () => {
  it("records a red-light stop: drive, wait 45 s, drive on", () => {
    const d = new StopDetector();
    let r = drive(d, 0, 800, 12, 0);
    const t = wait(d, r.x, 45, r.t);
    r = drive(d, r.x, 500, 12, t);
    expect(r.out.length).toBe(1);
    expect(r.out[0].waitS).toBeGreaterThanOrEqual(44);
    expect(r.out[0].heading).toBe(90);
    expect(d.take().length).toBe(1); // drove 500 m after it: safe to send
  });
  it("ignores short pauses, very long stands and stops right after starting", () => {
    const d = new StopDetector();
    let r = drive(d, 0, 100, 10, 0);          // only 100 m into the trip
    let t = wait(d, r.x, 40, r.t);
    r = drive(d, r.x, 800, 12, t);
    t = wait(d, r.x, 5, r.t);                  // 5 s: rolling stop
    r = drive(d, r.x, 400, 12, t);
    t = wait(d, r.x, 600, r.t);                // 10 min: parked
    r = drive(d, r.x, 400, 12, t);
    expect(d.take()).toEqual([]);
  });
  it("creeping forward in a queue is not a stop at a line", () => {
    const d = new StopDetector();
    let r = drive(d, 0, 800, 12, 0);
    let x = r.x, t = r.t;
    for (let i = 0; i < 60; i++) { t += 1000; x += 0.5 * M; d.feed({ coord: [44.40 + x, 33.30], speedMps: 0.5, t }); }
    r = drive(d, x, 400, 12, t);
    expect(r.out).toEqual([]);
  });
  it("never sends the last stop of a trip (could be home)", () => {
    const d = new StopDetector();
    let r = drive(d, 0, 800, 12, 0);
    const t = wait(d, r.x, 40, r.t);
    r = drive(d, r.x, 100, 12, t);  // trip ends 100 m later
    expect(d.take()).toEqual([]);
  });
});

describe("placeLearnedSignals", () => {
  const at = (mEast: number, mNorth = 0): LngLat => [44.40 + mEast * M, 33.30 + mNorth / 111_000];
  const sig = (coord: LngLat, dir = 2, trips = 5): LearnedSignal => ({ coord, dir, trips, waitS: 45 });
  it("keeps only the stop line of a queue (driving east)", () => {
    const out = placeLearnedSignals([sig(at(0)), sig(at(-25)), sig(at(-50)), sig(at(-75))], []);
    expect(out.length).toBe(1);
    expect(out[0].coord).toEqual(at(0));
  });
  it("keeps both directions of a crossing and drops ones OpenStreetMap already has", () => {
    const out = placeLearnedSignals([sig(at(0), 2), sig(at(20, 20), 4), sig(at(500), 2)], [at(505)]);
    expect(out.map((s) => s.dir).sort()).toEqual([2, 4]);
  });
  it("cells match the database", () => {
    expect(signalCell(33.3, 44.4)).toBe(Math.floor(33.3 / 0.00025) * 1_000_000 + Math.floor(44.4 / 0.0003));
  });
});
