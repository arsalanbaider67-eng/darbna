// Search coverage audit for Iraq: sends real queries to each search provider and checks whether a
// result lands in the right city. Run by .github/workflows/search-audit.yml (needs network).
//   node scripts/search-audit.mjs [--engine]   (--engine also tests Darbna's own merged search)
// Writes docs/search-audit.md and prints a summary.
import fs from "node:fs";

const CITY = {
  baghdad: [44.366, 33.315], erbil: [44.009, 36.191], basra: [47.783, 30.508], mosul: [43.130, 36.340],
  najaf: [44.330, 31.996], karbala: [44.024, 32.616], sulaymaniyah: [45.437, 35.561], kirkuk: [44.392, 35.468],
  duhok: [42.988, 36.867],
};
// [query, city, kind, language] — real places; "variant" = alternative spelling, "typo" = misspelt.
export const QUERIES = [
  ["الكرادة", "baghdad", "neighbourhood", "ar"], ["الكراده", "baghdad", "variant", "ar"], ["المنصور", "baghdad", "neighbourhood", "ar"],
  ["المنصوور", "baghdad", "typo", "ar"], ["الكاظمية", "baghdad", "neighbourhood", "ar"], ["زيونة", "baghdad", "neighbourhood", "ar"],
  ["شارع المتنبي", "baghdad", "street", "ar"], ["شارع فلسطين", "baghdad", "street", "ar"], ["ساحة التحرير", "baghdad", "landmark", "ar"],
  ["مطار بغداد الدولي", "baghdad", "landmark", "ar"], ["Baghdad International Airport", "baghdad", "landmark", "en"],
  ["جامعة بغداد", "baghdad", "school", "ar"], ["مدينة الطب", "baghdad", "hospital", "ar"], ["Al-Mansour", "baghdad", "neighbourhood", "en"],
  ["قلعة أربيل", "erbil", "landmark", "ar"], ["قلعة اربيل", "erbil", "variant", "ar"], ["Erbil Citadel", "erbil", "landmark", "en"],
  ["قەڵای هەولێر", "erbil", "landmark", "ckb"], ["عنكاوا", "erbil", "neighbourhood", "ar"], ["Ankawa", "erbil", "neighbourhood", "en"],
  ["Family Mall", "erbil", "business", "en"], ["فاميلي مول", "erbil", "business", "ar"], ["Majidi Mall", "erbil", "business", "en"],
  ["منتزه سامي عبد الرحمن", "erbil", "landmark", "ar"], ["Sami Abdulrahman Park", "erbil", "landmark", "en"], ["جامعة صلاح الدين", "erbil", "school", "ar"],
  ["العشار", "basra", "neighbourhood", "ar"], ["جامعة البصرة", "basra", "school", "ar"], ["كورنيش البصرة", "basra", "landmark", "ar"],
  ["Basra International Airport", "basra", "landmark", "en"], ["البصره", "basra", "variant", "ar"],
  ["جامعة الموصل", "mosul", "school", "ar"], ["University of Mosul", "mosul", "school", "en"], ["الجامع النوري", "mosul", "landmark", "ar"],
  ["الدواسة", "mosul", "neighbourhood", "ar"],
  ["مرقد الإمام علي", "najaf", "landmark", "ar"], ["Imam Ali Shrine", "najaf", "landmark", "en"], ["جامعة الكوفة", "najaf", "school", "ar"],
  ["مرقد الإمام الحسين", "karbala", "landmark", "ar"], ["Imam Husayn Shrine", "karbala", "landmark", "en"], ["جامعة كربلاء", "karbala", "school", "ar"],
  ["پارکی ئازادی", "sulaymaniyah", "landmark", "ckb"], ["Azadi Park Sulaymaniyah", "sulaymaniyah", "landmark", "en"], ["شارع سالم", "sulaymaniyah", "street", "ar"],
  ["زانکۆی سلێمانی", "sulaymaniyah", "school", "ckb"], ["جامعة السليمانية", "sulaymaniyah", "school", "ar"],
  ["قلعة كركوك", "kirkuk", "landmark", "ar"], ["Kirkuk Citadel", "kirkuk", "landmark", "en"], ["جامعة كركوك", "kirkuk", "school", "ar"],
  ["سد دهوك", "duhok", "landmark", "ar"], ["Duhok Dam", "duhok", "landmark", "en"], ["زانکۆی دهۆک", "duhok", "school", "ckb"], ["جامعة دهوك", "duhok", "school", "ar"],
];

const UA = "Darbna/1.0 search audit (+https://github.com/arsalanbaider67-eng/darbna)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const km = (a, b) => {
  const R = 6371, t = Math.PI / 180, dLat = (b[1] - a[1]) * t, dLon = (b[0] - a[0]) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
async function getJson(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

export const PROVIDERS = {
  nominatim: async (q) => {
    const qs = new URLSearchParams({ q, format: "jsonv2", countrycodes: "iq", limit: "5", namedetails: "1", "accept-language": "ar,en" });
    const j = await getJson(`https://nominatim.openstreetmap.org/search?${qs}`);
    await sleep(1100);
    return j.map((r) => ({ name: r.name || r.display_name, coord: [+r.lon, +r.lat] }));
  },
  photon: async (q) => {
    const qs = new URLSearchParams({ q, limit: "5", bbox: "38.7,29.0,48.9,37.5" });
    const j = await getJson(`https://photon.komoot.io/api/?${qs}`);
    await sleep(300);
    return (j.features ?? []).map((f) => ({ name: f.properties?.name, coord: f.geometry.coordinates }));
  },
  esri: async (q) => {
    const key = process.env.ESRI_KEY;
    if (!key) throw new Error("no ESRI_KEY");
    const qs = new URLSearchParams({ SingleLine: q, countryCode: "IRQ", maxLocations: "5", outFields: "PlaceName,Type", f: "json", token: key });
    const j = await getJson(`https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${qs}`);
    if (j.error) throw new Error(`Esri ${j.error.code}: ${j.error.message}`);
    return (j.candidates ?? []).map((c) => ({ name: c.attributes?.PlaceName || c.address, coord: [c.location.x, c.location.y] }));
  },
};

export async function audit(providers, label = "") {
  const rows = [];
  for (const [q, city, kind, lang] of QUERIES) {
    const row = { q, city, kind, lang, res: {} };
    for (const [name, fn] of Object.entries(providers)) {
      try {
        const list = await fn(q);
        const i = list.findIndex((r) => km(r.coord, CITY[city]) <= 25);
        row.res[name] = { hit: i >= 0, rank: i + 1, top: list[0]?.name ?? "", n: list.length };
      } catch (e) {
        row.res[name] = { hit: false, error: String(e.message ?? e).slice(0, 90) };
      }
    }
    rows.push(row);
  }
  return rows;
}

function report(rows, names, title) {
  const total = rows.length;
  const lines = [`## ${title}`, "", `Hit = one of the top 5 results is in the right city (within 25 km). ${total} queries.`, ""];
  lines.push("| Provider | Hits | Errors |", "|---|---|---|");
  for (const n of names) {
    const hits = rows.filter((r) => r.res[n]?.hit).length, errs = rows.filter((r) => r.res[n]?.error).length;
    lines.push(`| ${n} | ${hits}/${total} (${Math.round((100 * hits) / total)}%) | ${errs}${errs ? ` (${rows.find((r) => r.res[n]?.error)?.res[n].error})` : ""} |`);
  }
  lines.push("", "By kind:", "", `| Kind | ${names.join(" | ")} |`, `|---|${names.map(() => "---").join("|")}|`);
  for (const kind of [...new Set(rows.map((r) => r.kind))]) {
    const rs = rows.filter((r) => r.kind === kind);
    lines.push(`| ${kind} (${rs.length}) | ${names.map((n) => rs.filter((r) => r.res[n]?.hit).length).join(" | ")} |`);
  }
  lines.push("", "By language:", "", `| Language | ${names.join(" | ")} |`, `|---|${names.map(() => "---").join("|")}|`);
  for (const lang of ["ar", "ckb", "en"]) {
    const rs = rows.filter((r) => r.lang === lang);
    lines.push(`| ${lang} (${rs.length}) | ${names.map((n) => rs.filter((r) => r.res[n]?.hit).length).join(" | ")} |`);
  }
  lines.push("", "Every query:", "", `| Query | City | ${names.join(" | ")} |`, `|---|---|${names.map(() => "---").join("|")}|`);
  for (const r of rows) {
    lines.push(`| ${r.q} | ${r.city} | ${names.map((n) => { const x = r.res[n]; return x.error ? "error" : x.hit ? `✓ #${x.rank}` : `✗${x.n ? ` (${String(x.top).slice(0, 25)})` : " (none)"}`; }).join(" | ")} |`);
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sections = [`# Darbna search audit (${new Date().toISOString().slice(0, 10)})`, ""];
  const rows = process.argv.includes("--engine-only") ? [] : await audit(PROVIDERS);
  if (rows.length) sections.push(report(rows, Object.keys(PROVIDERS), "Providers on their own"));
  else { try { sections.push(fs.readFileSync("docs/search-audit.md", "utf8").split("\n").slice(2).join("\n").split("## Darbna's own search")[0]); } catch {} }
  if (process.argv.includes("--engine") || process.argv.includes("--engine-only")) {
    const { searchIraq } = await import("../packages/core/dist-search/search.mjs");
    // Exactly what the app runs: Nominatim + Esri, merged and re-ranked (no photonUrl, like the app).
    const eng = await audit({ darbna: async (q) => { const r = await searchIraq(q, { lang: "ar", esriKey: process.env.ESRI_KEY, fetchJson: getJson }); await sleep(1100); return r.map((p) => ({ name: p.name, coord: p.coord })); } });
    sections.push("", report(eng, ["darbna"], "Darbna's own search (what the app runs)"));
  }
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/search-audit.md", sections.join("\n") + "\n");
  if (process.argv.includes("--engine-only")) {
    const m = sections.join("\n").match(/\| darbna \| (\d+\/\d+)/); console.log(`::notice title=darbna::${m?.[1]}`);
  }
  for (const n of rows.length ? Object.keys(PROVIDERS) : []) console.log(`::notice title=${n}::${rows.filter((r) => r.res[n]?.hit).length}/${rows.length}`);
}
