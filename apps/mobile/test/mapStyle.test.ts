import { expect, test } from "bun:test";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { darkenStyle, lightenStyle, navigationStyle, satelliteStyle } from "@darbna/core";

const style = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: { osm: { type: "vector", tiles: ["https://example.com/{z}/{x}/{y}.pbf"] } },
  layers: [{ id: "place-name", type: "symbol", source: "osm", "source-layer": "place",
    layout: { "text-field": "{name}", "text-font": ["Noto Sans Regular"] },
    paint: { "text-color": "#222222", "text-halo-color": "#ffffff" } }],
};

for (const lang of ["ar", "ckb", "en"] as const) {
  test(`MapLibre accepts ${lang} labels on day, night and satellite maps`, () => {
    const day = lightenStyle(style);
    for (const s of [day, darkenStyle(day), satelliteStyle(day)]) {
      const errors = validateStyleMin(navigationStyle(s, lang) as any);
      expect(errors.map(e => e.message)).toEqual([]);
    }
  });
}
