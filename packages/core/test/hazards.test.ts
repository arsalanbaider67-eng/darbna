import { describe, expect, it } from "bun:test";
import doc from "../data/road-hazards.json";
import { hazardsOnRoute, parseHazards, type RoadHazardsDoc } from "../src/hazards";
import { reportsAhead } from "../src/extras";
import type { LngLat } from "../src/geo";

describe("road hazards (OpenStreetMap)", () => {
  const all = parseHazards(doc as unknown as RoadHazardsDoc);
  it("loads the Iraq data: many speed bumps and cameras, all inside Iraq's box", () => {
    expect(all.filter((h) => h.kind === "bump").length).toBeGreaterThan(500);
    expect(all.filter((h) => h.kind === "camera").length).toBeGreaterThan(100);
    for (const h of all) { expect(h.coord[1]).toBeGreaterThan(28.9); expect(h.coord[1]).toBeLessThan(37.5); }
    expect(new Set(all.map((h) => h.id)).size).toBe(all.length);
  });
  it("finds only hazards on the route, and warns about them ahead", () => {
    const h = all[0];
    const line: LngLat[] = [[h.coord[0] - 0.01, h.coord[1]], [h.coord[0] + 0.01, h.coord[1]]];
    const off = { ...h, id: "off", coord: [h.coord[0], h.coord[1] + 0.01] as LngLat };
    const on = hazardsOnRoute(line, [h, off]);
    expect(on.map((x) => x.id)).toEqual([h.id]);
    const items = on.map((x) => ({ id: x.id, coord: x.coord, category: x.kind === "camera" ? "camera" as const : "speed_bump" as const }));
    const ahead = reportsAhead(line, 700, items); // ~200 m before it
    expect(ahead.length).toBe(1);
    expect(ahead[0].distanceM).toBeGreaterThan(150);
  });
});
