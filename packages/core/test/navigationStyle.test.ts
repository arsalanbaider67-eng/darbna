import { expect, test } from "bun:test";
import { navigationStyle } from "../src/navigationStyle";
import type { MapStyle } from "../src/style";

const source: MapStyle = { sources: { osm: { type: "vector" } }, layers: [
  { id: "road-name", type: "symbol", layout: { "text-field": "{name}", "text-size": 14 }, paint: { "text-color": "#333" } },
  { id: "highway-shield", type: "symbol", layout: { "text-field": "{ref}" } },
  { id: "water", type: "fill", paint: { "fill-color": "#abc" } },
] };

test("localizes names without changing shields, geometry, sources or the input style", () => {
  const before = JSON.stringify(source);
  const result = navigationStyle(source, "ar");
  expect(JSON.stringify(result.layers[0].layout?.["text-field"])).toContain("name:ar");
  expect(result.layers[0].layout?.["text-size"]).toBe(14);
  expect(result.layers[1]).toBe(source.layers[1]);
  expect(result.layers[2]).toBe(source.layers[2]);
  expect(result.sources).toBe(source.sources);
  expect(JSON.stringify(source)).toBe(before);
});

test("uses language-specific fallbacks and skips empty translated names", () => {
  const ar = navigationStyle(source, "ar").layers[0].layout?.["text-field"] as any[];
  expect(ar[1]).toEqual(["!=", ["coalesce", ["get", "name:ar"], ""], ""]);
  expect(ar[2]).toEqual(["to-string", ["get", "name:ar"]]);
  const ckb = JSON.stringify(navigationStyle(source, "ckb").layers[0].layout);
  expect(ckb.indexOf("name:ckb")).toBeLessThan(ckb.indexOf("name:ar"));
  const en = JSON.stringify(navigationStyle(source, "en").layers[0].layout);
  expect(en.indexOf("name:en")).toBeLessThan(en.indexOf("name:latin"));
});
