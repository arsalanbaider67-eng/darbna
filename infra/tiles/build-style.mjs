// Generates Darbna day/night MapLibre styles from the Protomaps basemap layers,
// with Arabic labels first and Darbna's palette. Run on a machine with npm access:
//   npm i @protomaps/basemaps@5 && node build-style.mjs https://tiles.example.iq
import { writeFileSync } from "node:fs";
import { layers, namedFlavor } from "@protomaps/basemaps";

const base = process.argv[2] ?? "http://localhost:8090";

// Darbna palette: Tigris teal water, date-palm gold arterials, warm sand land.
const DAY = { ...namedFlavor("light"), background: "#F4EFE6", earth: "#F4EFE6", water: "#9CC9D3",
  highway: "#F2B544", highway_casing_late: "#B5832A", major: "#FFFFFF", minor_a: "#FFFFFF", minor_b: "#FBF8F2",
  buildings: "#E6DED0", park_a: "#D9E6C8", park_b: "#D9E6C8" };
const NIGHT = { ...namedFlavor("dark"), background: "#0F1A1F", earth: "#0F1A1F", water: "#123542",
  highway: "#B07F22", major: "#33434B", minor_a: "#273339", minor_b: "#222D32", buildings: "#1A262B" };

function style(name, flavor) {
  return {
    version: 8,
    name,
    // Self-host these assets in production (copy basemaps-assets into tiles/data).
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}/sprites/${flavor === NIGHT ? "dark" : "light"}`,
    sources: {
      protomaps: { type: "vector", url: `${base}/iraq.json`, attribution: "© OpenStreetMap contributors" },
    },
    // lang "ar" makes labels prefer name:ar, falling back to name.
    layers: layers("protomaps", flavor, { lang: "ar" }),
  };
}

writeFileSync("data/styles/darbna-day.json", JSON.stringify(style("Darbna Day", DAY)));
writeFileSync("data/styles/darbna-night.json", JSON.stringify(style("Darbna Night", NIGHT)));
console.log("wrote data/styles/darbna-{day,night}.json");
