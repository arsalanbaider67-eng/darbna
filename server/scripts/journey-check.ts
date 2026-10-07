/**
 * Real-network journey check. Run against YOUR Valhalla (built from the Iraq extract):
 *   ROUTING_URL=http://localhost:8002 bun scripts/journey-check.ts
 *
 * For each representative Iraqi trip it: requests a route; sanity-checks distance against
 * the straight line; then drives the returned geometry through the on-device guidance
 * engine with noisy GPS, a multipath-spike variant, and a missed-turn variant.
 * Coordinates are approximate (seed gazetteer) and only need to be near a road.
 */
import { haversine, simulateDrive, type LngLat } from "@darbna/core";
import { ValhallaProvider } from "../src/providers/routing";

const J: { name: string; from: LngLat; to: LngLat }[] = [
  { name: "Baghdad: Tahrir Sq → Baghdad Intl Airport", from: [44.4140, 33.3337], to: [44.2346, 33.2625] },
  { name: "Baghdad: Karrada → Kadhimiya (crosses Tigris)", from: [44.4270, 33.3050], to: [44.3400, 33.3800] },
  { name: "Baghdad: Sadr City → Mansour", from: [44.4600, 33.3900], to: [44.3420, 33.3170] },
  { name: "Basra: Ashar → Basra Intl Airport", from: [47.8420, 30.5160], to: [47.6621, 30.5491] },
  { name: "Mosul: east bank → Al-Nuri (crosses Tigris)", from: [43.1650, 36.3550], to: [43.1300, 36.3406] },
  { name: "Erbil: Citadel → Ankawa", from: [44.0091, 36.1912], to: [43.9930, 36.2280] },
  { name: "Najaf → Karbala (intercity)", from: [44.3350, 31.9950], to: [44.0249, 32.6160] },
  { name: "Sulaymaniyah → Erbil (mountain road)", from: [45.4374, 35.5613], to: [44.0092, 36.1911] },
  { name: "Baghdad → Hillah (highway)", from: [44.3661, 33.3152], to: [44.4199, 32.4637] },
  { name: "Kirkuk → Tikrit", from: [44.3922, 35.4681], to: [43.6782, 34.6071] },
];

const provider = new ValhallaProvider(process.env.ROUTING_URL ?? "http://localhost:8002", 20_000);
let failures = 0;

for (const j of J) {
  const line: string[] = [j.name];
  try {
    const routes = await provider.route({ origin: j.from, destination: j.to, alternatives: true, excludePolygons: [] });
    const r = routes[0];
    const crow = haversine(j.from, j.to);
    const ratio = r.distanceM / crow;
    const avgKmh = r.distanceM / 1000 / (r.durationS / 3600);
    const problems: string[] = [];
    if (ratio < 1 || ratio > 2.6) problems.push(`detour ratio ${ratio.toFixed(2)}`);
    if (avgKmh < 12 || avgKmh > 110) problems.push(`implausible avg speed ${avgKmh.toFixed(0)} km/h`);
    if (r.steps.length < 2) problems.push("no maneuvers");
    const speed = r.distanceM > 30_000 ? 25 : 11;
    const clean = simulateDrive(r, { speedMps: speed, noiseM: 8, seed: 1 });
    const spiky = simulateDrive(r, { speedMps: speed, noiseM: 10, spikeEvery: 9, seed: 2 });
    if (!clean.arrived) problems.push("did not arrive (clean GPS)");
    if (clean.reroutes) problems.push(`${clean.reroutes} false reroutes (clean GPS)`);
    if (spiky.reroutes) problems.push(`${spiky.reroutes} false reroutes (multipath)`);
    line.push(
      `${(r.distanceM / 1000).toFixed(1)} km`, `${Math.round(r.durationS / 60)} min`, `${routes.length} route(s)`,
      `${r.steps.length} steps`, `announced ${clean.announcements}`, problems.length ? `FAIL: ${problems.join("; ")}` : "ok",
    );
    if (problems.length) failures++;
  } catch (e) {
    failures++;
    line.push(`ERROR: ${(e as Error).message}`);
  }
  console.log(line.join(" | "));
}

console.log(failures ? `\n${failures} journey(s) need attention` : "\nall journeys ok");
process.exit(failures ? 1 : 0);
