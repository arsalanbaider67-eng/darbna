#!/usr/bin/env node
// Release gate for SOS numbers: every number must have a recorded call test in its area
// ("callTested": { "date", "area", "by" } in packages/core/data/emergency-numbers.json).
// Store builds run this first and stop if anything is missing. See docs/EMERGENCY_NUMBERS.md.
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(new URL("../packages/core/data/emergency-numbers.json", import.meta.url), "utf8"));
const missing = [];
for (const [region, r] of Object.entries(cfg.regions)) {
  for (const c of r.contacts) {
    const t = c.callTested;
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t.date ?? "") || !t.area || !t.by) missing.push(`${region} ${c.service} ${c.number}`);
  }
}
if (missing.length) {
  for (const m of missing) console.log(`::error title=SOS number not call-tested::${m} — call it in its area and record "callTested" before releasing`);
  console.log(`${missing.length} emergency number(s) not yet call-tested. Release blocked.`);
  process.exit(1);
}
console.log("All emergency numbers have a recorded call test.");
