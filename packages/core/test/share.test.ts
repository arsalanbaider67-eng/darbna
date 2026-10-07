import { describe, expect, it } from "bun:test";
import { parseSharedLocation } from "../src/share";

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
