import { describe, expect, it, test } from "bun:test";
import { buildShareLink, isShortMapLink, linksIn, parseSharedLocation, resolveShared } from "../src/share";

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

describe("sharing a place into Darbna", () => {
  it("Google Maps place link: coordinates and name", async () => {
    const r = await resolveShared("https://www.google.com/maps/place/Family+Mall/@36.2087,44.0446,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d36.2081!4d44.0451");
    expect(r && "coord" in r ? r.coord[1] : 0).toBeCloseTo(36.2081, 3);
    expect(r && "coord" in r ? r.label : "").toBe("Family Mall");
  });
  it("Apple Maps link with coordinate= and name", async () => {
    const r = await resolveShared("Erbil Citadel\nhttps://maps.apple.com/place?coordinate=36.1911,44.0092&name=Erbil%20Citadel");
    expect(r && "coord" in r ? r.coord : null).toEqual([44.0092, 36.1911]);
    expect(r && "coord" in r ? r.label : "").toBe("Erbil Citadel");
  });
  it("WhatsApp-style message with a link inside", async () => {
    const r = await resolveShared("📍 موقعي: https://maps.google.com/?q=33.3152,44.3661 تعال");
    expect(r && "coord" in r ? r.coord : null).toEqual([44.3661, 33.3152]);
  });
  it("short link: follows the redirect", async () => {
    expect(isShortMapLink("https://maps.app.goo.gl/AbC123")).toBe(true);
    const r = await resolveShared("Check this https://maps.app.goo.gl/AbC123", async () => ({ url: "https://www.google.com/maps/place/Majidi+Mall/@36.1802,44.0108,16z" }));
    expect(r && "coord" in r ? r.label : "").toBe("Majidi Mall");
    const r2 = await resolveShared("https://maps.app.goo.gl/xyz", async () => ({ url: "https://www.google.com/maps?cid=1", body: "...center=36.19%2C44.01&zoom..." }));
    expect(r2 && "coord" in r2 ? r2.coord : null).toEqual([44.01, 36.19]);
  });
  it("plain place name becomes a search", async () => {
    expect(await resolveShared("Family Mall Erbil")).toEqual({ name: "Family Mall Erbil" });
    expect(linksIn("a https://x.y/z) b")).toEqual(["https://x.y/z"]);
  });
});
