import { describe, expect, test } from "bun:test";
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
  test("gives in after several rejections so it never gets stuck", () => {
    const f = new FixFilter();
    f.accept({ coord: [44.0, 36.3], accuracyM: 5, at: 0 });
    for (let i = 1; i <= 4; i++) expect(f.accept({ coord: [44.0, 36.3], accuracyM: 80, at: i * 1000 })).toBe(false);
    expect(f.accept({ coord: [44.0, 36.3], accuracyM: 80, at: 5000 })).toBe(true);
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
