import { describe, expect, test } from "bun:test";
import { distanceKey, hasClip, instructionClips } from "../src/nav/voicePlan";

const step = (kind: any, extra: any = {}) => ({ index: 1, kind, shapeIndex: 0, location: [0, 0] as [number, number], distanceM: 0, durationS: 0, ...extra });

describe("voice plan", () => {
  test("distances snap to recorded values", () => {
    expect(distanceKey(198)).toBe("d_200m");
    expect(distanceKey(20)).toBe("d_50m");
    expect(distanceKey(1480)).toBe("d_1_5km");
    expect(distanceKey(13700)).toBe("d_15km");
    expect(distanceKey(950_000)).toBe("d_500km");
  });
  test("instruction with distance and then", () => {
    expect(instructionClips(step("right"), 250, step("left"))).toEqual(["d_250m", "mv_right", "then", "mv_left"]);
    expect(instructionClips(step("roundabout", { roundaboutExit: 2 }), null)).toEqual(["mv_roundabout_2"]);
    expect(instructionClips(step("roundabout", { roundaboutExit: 9 }), null)).toEqual(["mv_roundabout_plain"]);
    expect(instructionClips(step("arrive"), null)).toEqual(["mv_arrive"]);
    expect(instructionClips(step("arrive"), 400)).toEqual(["d_400m", "arrive_soon"]);
  });
  test("every clip key a prompt can produce exists in both languages", () => {
    const kinds = ["depart","arrive","straight","slight_right","right","sharp_right","uturn","sharp_left","left","slight_left","ramp_right","ramp_left","ramp_straight","exit_right","exit_left","keep_right","keep_left","keep_straight","merge","roundabout","roundabout_exit","ferry"];
    const keys = new Set<string>(["then", "rerouting", "arrive_soon"]);
    for (const k of kinds) for (const ex of [undefined, 1, 6, 7]) for (const d of [null, 30, 120, 999, 5000, 70000, 1e6]) instructionClips(step(k, { roundaboutExit: ex }), d).forEach((x) => keys.add(x));
    for (const k of keys) { expect(hasClip("ar", k)).toBe(true); expect(hasClip("en", k)).toBe(true); }
  });
});
