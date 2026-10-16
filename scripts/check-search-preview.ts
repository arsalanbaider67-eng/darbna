// A small, explicitly run live check. Public landmark names only; no device location or user data.
// Cache responses and serialize request starts according to the public Nominatim policy.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { searchIraq, haversine } from "../packages/core/src";
import { createRequestGate } from "../apps/mobile/src/searchClient";

const cache = resolve(process.argv[2] || ".search-check-cache");
mkdirSync(cache, { recursive: true });
const gate = createRequestGate(1100);
const checks = [
  { query: "مطار أربيل الدولي", city: [44.009, 36.191] as [number, number] },
  { query: "Family Mall Erbil", city: [44.009, 36.191] as [number, number] },
  { query: "جامعة البصرة", city: [47.783, 30.508] as [number, number] },
];
const output = [];
for (const check of checks) {
  const result = await searchIraq(check.query, { lang: "ar", fetchJson: async url => {
    const file = resolve(cache, createHash("sha256").update(url).digest("hex") + ".json");
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    await gate();
    const r = await fetch(url, { headers: { "User-Agent": "Darbna/1.0 preview-check (+https://github.com/arsalanbaider67-eng/darbna)", accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Search provider HTTP ${r.status}`);
    const data = await r.json(); writeFileSync(file, JSON.stringify(data)); return data;
  } });
  const sameCity = result.some(hit => haversine(hit.coord, check.city) < 25_000);
  output.push({ query: check.query, results: result.length, hasResultInExpectedCity: sameCity, firstNames: result.slice(0, 3).map(hit => hit.name) });
}
writeFileSync(resolve(cache, "summary.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
if (output.some(check => !check.hasResultInExpectedCity)) process.exitCode = 1;
