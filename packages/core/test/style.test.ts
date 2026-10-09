import { describe, expect, it } from "bun:test";
import { darkenStyle, lightenStyle, nightColor, parseColor, satelliteStyle } from "../src/style";

const lum = (c: string) => { const [r, g, b] = parseColor(c)!; return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

describe("map styles", () => {
  it("parses colour formats", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#0E5E6F")).toEqual([14, 94, 111, 1]);
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30, 0.5]);
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual([255, 0, 0, 1]);
    expect(parseColor("not a colour")).toBeNull();
  });
  it("night colours flip light land to dark and dark text to light", () => {
    expect(lum(nightColor("#F4EFE6"))).toBeLessThan(0.15); // land
    expect(lum(nightColor("#333333"))).toBeGreaterThan(0.55); // labels
    expect(nightColor("rgba(255,255,255,0.4)")).toMatch(/^rgba\(.*,0\.4\)$/); // alpha kept
    const [r, , b] = parseColor(nightColor("#9CC9D3"))!; // water stays blue-ish
    expect(b).toBeGreaterThan(r);
  });
  it("darkenStyle changes colour properties only, including inside expressions", () => {
    const s = darkenStyle({ layers: [
      { id: "bg", type: "background", paint: { "background-color": "#ffffff" } },
      { id: "road", type: "line", paint: { "line-color": ["interpolate", ["linear"], ["zoom"], 10, "#fff", 16, "#eee"], "line-width": 4 } },
      { id: "label", type: "symbol", layout: { "text-field": "{name}" }, paint: { "text-color": "#222", "text-halo-color": "#fff" } },
    ] });
    expect(lum(s.layers[0].paint!["background-color"] as string)).toBeLessThan(0.15);
    const expr = s.layers[1].paint!["line-color"] as any[];
    expect(expr[4]).not.toBe("#fff");
    expect(s.layers[1].paint!["line-width"]).toBe(4);
    expect(s.layers[2].layout).toEqual({ "text-field": "{name}" });
    expect(lum(s.layers[2].paint!["text-color"] as string)).toBeGreaterThan(0.55);
  });
  it("lightenStyle removes 3D buildings", () => {
    const s = lightenStyle({ layers: [{ id: "b3d", type: "fill-extrusion" }, { id: "water", type: "fill" }] });
    expect(s.layers.map((l) => l.id)).toEqual(["water"]);
  });
});

describe("satelliteStyle", () => {
  const base = {
    version: 8, sources: { openmaptiles: { type: "vector" } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#eee" } },
      { id: "landcover", type: "fill" },
      { id: "road_primary", type: "line", paint: { "line-color": "#fff" } },
      { id: "label_city", type: "symbol", paint: { "text-color": "#333" } },
    ],
  };
  it("photos under roads and names, no land colours", () => {
    const s = satelliteStyle(base as any);
    expect(s.layers.map((l) => l.id)).toEqual(["darbna-sat", "road_primary", "label_city"]);
    expect((s.sources as any)["darbna-sat"].type).toBe("raster");
    expect((s.sources as any).openmaptiles).toBeDefined();
    expect(s.layers[2].paint!["text-color"]).toBe("#FFFFFF");
  });
});
