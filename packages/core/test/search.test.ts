import { expect, test } from "bun:test";
import { mergePlaceResults, searchIraq } from "../src/search";
import type { LngLat } from "../src/geo";

// Provider fixtures only; these are not added to the app's map data.
const osm = (id: number, name: string, lng = 44.4, lat = 33.3) => ({ osm_id: id, osm_type: "node", name, lon: String(lng), lat: String(lat), type: "shop" });
test("keeps different businesses within the same building", async () => {
  const r = await searchIraq("shop", { lang: "en", fetchJson: async () => [osm(1, "Shop A"), osm(2, "Shop B", 44.4001)] });
  expect(r.map(h => h.id)).toEqual(["osm:n1", "osm:n2"]);
});
test("merges the same OSM feature returned by two providers", async () => {
  const r = await searchIraq("Shop", { lang: "en", photonUrl: "https://photon.example", fetchJson: async url => url.includes("/api/")
    ? { features: [{ geometry: { coordinates: [44.4, 33.3] }, properties: { osm_id: 1, osm_type: "N", name: "Shop A" } }] }
    : [osm(1, "Shop A")] });
  expect(r).toHaveLength(1);
});
test("does not discard other-city results or separate branches", async () => {
  const r = await searchIraq("Shop", { lang: "en", near: [44.4, 33.3], fetchJson: async () => [osm(1, "Shop", 44.4), osm(2, "Shop", 44.403), osm(3, "Shop", 47.8, 30.5)] });
  expect(r).toHaveLength(3);
});
test("Esri businesses sharing coordinates keep different IDs", async () => {
  const r = await searchIraq("Shop", { lang: "en", esriKey: "test-key", skipNominatim: true, fetchJson: async () => ({ candidates:
    ["Shop A", "Shop B"].map(name => ({ location: { x: 44.4, y: 33.3 }, attributes: { PlaceName: name }, score: 100 })) }) });
  expect(new Set(r.map(h => h.id)).size).toBe(2);
});
test("autocomplete without a configured provider does not pretend the device is offline", async () => {
  let calls = 0;
  const r = await searchIraq("Shop", { lang: "en", skipNominatim: true, fetchJson: async () => { calls++; return []; } });
  expect(r).toHaveLength(0); expect(calls).toBe(0); expect(r.failed).toEqual([]);
});
test("Arabic spelling fallback follows an empty exact query", async () => {
  const queries: string[] = [];
  const r = await searchIraq("البصره", { lang: "ar", fetchJson: async url => {
    const q = new URL(url).searchParams.get("q")!; queries.push(q);
    return q === "البصرة" ? [osm(1, "البصرة", 47.8, 30.5)] : [];
  } });
  expect(queries).toEqual(["البصره", "البصرة"]); expect(r).toHaveLength(1);
});
test("a failing secondary provider does not remove successful results", async () => {
  const r = await searchIraq("Shop", { lang: "en", photonUrl: "https://photon.example", fetchJson: async url => {
    if (url.includes("photon.example")) throw new Error("timeout"); return [osm(1, "Shop")];
  } });
  expect(r).toHaveLength(1); expect(r.failed).toEqual(["photon"]);
});
test("nearby seed does not suppress a different business; exact-name provider result replaces approximate seed", () => {
  const seed = { id: "seed", name: "Mall", coord: [44.4, 33.3] as LngLat, score: 1, quality: "seed_unverified" };
  const shop = { id: "shop", name: "Pharmacy", coord: [44.4001, 33.3] as LngLat, score: 0.8 };
  const mall = { id: "mall", name: "Mall", coord: [44.4002, 33.3] as LngLat, score: 0.7 };
  const r = mergePlaceResults([seed], [shop, mall]);
  expect(r.map(x => x.id)).toEqual(["shop", "mall"]);
  expect(r.find(x => x.id === "mall")?.coord).toEqual(mall.coord);
});
