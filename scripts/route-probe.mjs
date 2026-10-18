// Probes the routing services the app uses with real requests and prints what happens.
//   node scripts/route-probe.mjs   (env VALHALLA_URL, NOMINATIM_URL, ESRI_KEY optional)
const V = (process.env.VALHALLA_URL || "").replace(/\/$/, "");
const PUB = "https://valhalla1.openstreetmap.de";
const UA = { "User-Agent": "Darbna route probe (+https://github.com/arsalanbaider67-eng/darbna)" };
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, " ").slice(0, 900)}`);
async function geocode(q) {
  const key = process.env.ESRI_KEY;
  if (key) {
    const u = `https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${new URLSearchParams({ SingleLine: q, countryCode: "IRQ", maxLocations: "3", f: "json", token: key, outFields: "PlaceName,Type" })}`;
    const j = await (await fetch(u)).json();
    return (j.candidates ?? []).map((c) => ({ src: "esri", name: c.attributes?.PlaceName || c.address, type: c.attributes?.Type, coord: [c.location.x, c.location.y] }));
  }
  return [];
}
async function route(base, from, to, extra = {}) {
  const body = { locations: [{ lon: from[0], lat: from[1] }, { lon: to[0], lat: to[1], ...extra }], costing: "auto", units: "kilometers", directions_type: "maneuvers" };
  const r = await fetch(`${base}/route`, { method: "POST", headers: { "Content-Type": "application/json", ...UA }, body: JSON.stringify(body) });
  const t = await r.text();
  try { const j = JSON.parse(t); return j.trip ? `OK ${j.trip.summary.length.toFixed(1)} km` : `ERR ${j.error_code} ${j.error}`; } catch { return `HTTP ${r.status} ${t.slice(0, 120)}`; }
}
const ERBIL = [44.0092, 36.1911], TBILISI = [44.7930, 41.7151], BAGHDAD = [44.4200, 33.3000];
const hits = await geocode("120 M Ring Road").catch((e) => (note("geocode", e.message), []));
for (const h of hits) note(`geocode ${h.src}`, `${h.name} (${h.type}) ${h.coord.join(",")}`);
const dests = [...hits.map((h) => ["esri " + h.name, h.coord]), ["Cihan City area", [43.9925, 36.1520]]];
for (const [label, base] of [["own VALHALLA_URL", V], ["public valhalla", PUB]]) {
  if (!base) { note(label, "not set"); continue; }
  for (const [dn, d] of dests) {
    for (const [on, o] of [["Erbil citadel (tour)", ERBIL], ["Tbilisi", TBILISI], ["Baghdad", BAGHDAD]]) {
      note(`${label}: ${on} → ${dn}`, await route(base, o, d).catch((e) => "FETCH " + e.message));
    }
  }
}
