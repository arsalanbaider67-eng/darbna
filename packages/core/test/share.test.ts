import { describe, expect, it, test } from "bun:test";
import { buildShareLink, parseSharedLocation } from "../src/share";

describe("parseSharedLocation", () => {
  const cases: [string, [number, number] | null][] = [
    ["geo:33.3152,44.3661", [44.3661, 33.3152]],
    ["geo:0,0?q=33.3152,44.3661(بيت أبو علي)", [44.3661, 33.3152]],
    ["https://maps.google.com/?q=33.3152,44.3661", [44.3661, 33.3152]],
    ["https://www.google.com/maps/place/X/@36.1911,44.0092,15z/data=!3m1!4b1!4m6!3m5!3d36.19!4d44.01", [44.01, 36.19]],
    ["https://www.google.com/maps/@30.5085,47.7804,14z", [47.7804, 30.5085]],
    ["https://www.openstreetmap.org/?mlat=32.616&mlon=44.0249#map=15/32.616/44.0249", [44.0249, 32.616]],
    ["darbna://place?lat=31.995&lng=44.335&name=النجف", [44.335, 31.995]],
    ["33.3152, 44.3661", [44.3661, 33.3152]],
    ["٣٣٫٣١٥٢، ٤٤٫٣٦٦١", [44.3661, 33.3152]],
    ["https://maps.app.goo.gl/AbCdEf", null],
    ["hello", null],
  ];
  for (const [input, want] of cases) {
    it(input, () => {
      const r = parseSharedLocation(input);
      if (want === null) expect(r).toBeNull();
      else {
        expect(r?.coord[0]).toBeCloseTo(want[0], 4);
        expect(r?.coord[1]).toBeCloseTo(want[1], 4);
      }
    });
  }
  it("keeps the label", () => {
    expect(parseSharedLocation("geo:0,0?q=33.3,44.3(بيت أبو علي)")?.label).toBe("بيت أبو علي");
  });
});

describe("buildShareLink", () => {
  it("web links round-trip, including an Arabic name", () => {
    const url = buildShareLink([44.3661, 33.3152], "مطعم الساعة", "https://arsalanbaider67-eng.github.io/darbna/");
    expect(url.startsWith("https://arsalanbaider67-eng.github.io/darbna/?to=33.315200,44.366100")).toBe(true);
    const back = parseSharedLocation(url)!;
    expect(back.coord[0]).toBeCloseTo(44.3661, 5);
    expect(back.coord[1]).toBeCloseTo(33.3152, 5);
    expect(back.label).toBe("مطعم الساعة");
  });
  it("app links round-trip", () => {
    const back = parseSharedLocation(buildShareLink([43.1300, 36.3406], "الموصل"))!;
    expect(back.coord[1]).toBeCloseTo(36.3406, 5);
    expect(back.label).toBe("الموصل");
  });
  it("drops an existing query from the base", () => {
    expect(buildShareLink([44, 33], undefined, "https://x.io/darbna/?to=1,2")).toBe("https://x.io/darbna/?to=33.000000,44.000000");
  });
});

import { valhallaRouteBody } from "../src";
describe("valhallaRouteBody snapping fallbacks", () => {
  const base = { origin: [44.0, 36.1] as [number, number], destination: [44.01, 36.19] as [number, number], originHeading: 90, alternatives: true };
  test("default keeps heading, no reachability", () => {
    const b: any = valhallaRouteBody(base);
    expect(b.locations[0].heading).toBe(90);
    expect(b.locations[1].minimum_reachability).toBeUndefined();
  });
  test("connected / main snap to the connected network and drop the heading", () => {
    const c: any = valhallaRouteBody({ ...base, snap: "connected" });
    expect(c.locations[0].heading).toBeUndefined();
    expect(c.locations[0].minimum_reachability).toBe(100);
    expect(c.locations[1].minimum_reachability).toBe(100);
    const m: any = valhallaRouteBody({ ...base, snap: "main" });
    expect(m.locations[1].search_filter).toEqual({ min_road_class: "residential" });
    const j: any = valhallaRouteBody({ ...base, snap: "major" });
    expect(j.locations[0].search_filter).toEqual({ min_road_class: "tertiary" });
    expect(j.locations[1].search_filter).toEqual({ min_road_class: "residential" });
  });
});
