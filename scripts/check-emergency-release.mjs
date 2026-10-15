#!/usr/bin/env node
// Release gate for SOS numbers: every number must have a recorded call test in its area
// ("callTested": { "date", "area", "by" }, or "confirmed": { "date", "by", "how" } by the owner with an official source, in packages/core/data/emergency-numbers.json).
// Store builds run this first and stop if anything is missing. See docs/EMERGENCY_NUMBERS.md.
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(new URL("../packages/core/data/emergency-numbers.json", import.meta.url), "utf8"));
const missing = [];
for (const [region, r] of Object.entries(cfg.regions)) {
  for (const c of r.contacts) {
    const t = c.callTested, k = c.confirmed;
    const tested = t && /^\d{4}-\d{2}-\d{2}$/.test(t.date ?? "") && t.area && t.by;
    // Or confirmed by the app owner (date, who, how), with at least one official source.
    const ownerOk = k && /^\d{4}-\d{2}-\d{2}$/.test(k.date ?? "") && k.by && k.how && c.sources.some((s) => s.official);
    if (!tested && !ownerOk) missing.push(`${region} ${c.service} ${c.number}`);
  }
}
if (missing.length) {
  for (const m of missing) console.log(`::error title=SOS number not call-tested::${m} — call it in its area and record "callTested" before releasing`);
  console.log(`${missing.length} emergency number(s) not yet call-tested. Release blocked.`);
  process.exit(1);
}
console.log("All emergency numbers are call-tested or confirmed by the owner.");
