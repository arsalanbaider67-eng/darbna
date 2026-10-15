import { describe, expect, it, test } from "bun:test";
import { FixFilter, lineProgress, lineProgressTable, snapToLine } from "../src/precise";

describe("FixFilter", () => {
  test("drops a rough fix between good ones", () => {
    const f = new FixFilter();
    expect(f.accept({ coord: [44.0, 36.3], accuracyM: 5, at: 0 })).toBe(true);
    expect(f.accept({ coord: [44.0003, 36.3], accuracyM: 65, at: 1000 })).toBe(false);
    expect(f.accept({ coord: [44.00001, 36.3], accuracyM: 6, at: 2000 })).toBe(true);
  });
  test("drops an impossible jump", () => {
    const f = new FixFilter();
    f.accept({ coord: [44.0, 36.3], accuracyM: 5, at: 0 });
    expect(f.accept({ coord: [44.01, 36.3], accuracyM: 8, at: 1000 })).toBe(false); // ~900 m in 1 s
  });
  test("a rough reading repeated in the same place is accepted (confirmed)", () => {
    const f = new FixFilter();
    f.accept({ coord: [44.0, 36.3], accuracyM: 5, at: 0 });
    expect(f.accept({ coord: [44.0, 36.3], accuracyM: 80, at: 1000 })).toBe(false);
    expect(f.accept({ coord: [44.0, 36.3], accuracyM: 80, at: 2000 })).toBe(true);
  });
});

describe("snapToLine", () => {
  const line: [number, number][] = [[44.0, 36.3], [44.01, 36.3]];
  test("snaps a nearby point onto the line", () => {
    const s = snapToLine([44.005, 36.30005], line, 20)!;
    expect(s.point[1]).toBeCloseTo(36.3, 6);
    expect(s.distance).toBeLessThan(7);
    expect(Math.round(s.bearing)).toBe(90);
  });
  test("leaves a far point alone", () => {
    expect(snapToLine([44.005, 36.301], line, 20)).toBeNull();
  });
});


describe("line progress", () => {
  test("half way along a straight line is 0.5", () => {
    const line: [number, number][] = [[44.0, 36.3], [44.01, 36.3], [44.02, 36.3]];
    const t = lineProgressTable(line);
    expect(lineProgress(t, line, 1, [44.01, 36.3])).toBeCloseTo(0.5, 5);
    expect(lineProgress(t, line, 1, [44.015, 36.3])).toBeCloseTo(0.75, 5);
  });
  test("prefers the part of a looping route you're on", () => {
    // Out along y=36.3 and back 30 m north of it.
    const line: [number, number][] = [[44.0, 36.3], [44.01, 36.3], [44.01, 36.3003], [44.0, 36.3003]];
    const s = snapToLine([44.005, 36.30014], line, 30, 2)!;
    expect(s.index).toBe(2);
  });
});

describe("FixFilter never freezes the position", () => {
  const T = 1_000_000;
  it("accepts a real new place once two readings agree (stale cached first fix)", () => {
    const f = new FixFilter();
    expect(f.accept({ coord: [44.0, 36.0], accuracyM: 5, at: T })).toBe(true); // stale cache, 2 km away
    expect(f.accept({ coord: [44.02, 36.0], accuracyM: 6, at: T + 1000 })).toBe(false); // looks like a jump
    expect(f.accept({ coord: [44.02001, 36.0], accuracyM: 6, at: T + 2000 })).toBe(true); // confirmed
  });
  it("never holds a position back for more than ~3 s", () => {
    const f = new FixFilter();
    f.accept({ coord: [44.0, 36.0], accuracyM: 5, at: T });
    expect(f.accept({ coord: [44.03, 36.0], accuracyM: 8, at: T + 1000 })).toBe(false);
    expect(f.accept({ coord: [44.06, 36.0], accuracyM: 8, at: T + 2000 })).toBe(false); // disagrees, still dropped
    expect(f.accept({ coord: [44.09, 36.0], accuracyM: 8, at: T + 4100 })).toBe(true); // 3 s passed
  });
  it("still drops a single wild reading between good ones", () => {
    const f = new FixFilter();
    f.accept({ coord: [44.0, 36.0], accuracyM: 5, at: T });
    expect(f.accept({ coord: [44.05, 36.0], accuracyM: 40, at: T + 1000 })).toBe(false);
    expect(f.accept({ coord: [44.00001, 36.0], accuracyM: 5, at: T + 2000 })).toBe(true);
  });
  it("lets rougher readings through after a few seconds (driving between buildings)", () => {
    const f = new FixFilter();
    f.accept({ coord: [44.0, 36.0], accuracyM: 5, at: T });
    expect(f.accept({ coord: [44.0006, 36.0], accuracyM: 45, at: T + 6000 })).toBe(true);
  });
});
