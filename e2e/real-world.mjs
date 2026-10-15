// End-to-end test of the real web build with real map tiles, search and routing (run on GitHub,
// which can reach them). Phone-sized Chromium, location in Baghdad. Prints PASS/FAIL per check
// and saves screenshots to e2e-out/.   node e2e/real-world.mjs http://localhost:8765/darbna/
import fs from "node:fs";
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://localhost:8765/darbna/";
const OUT = "e2e-out"; fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const km = (a, b) => { const R = 6371, t = Math.PI / 180, x = Math.sin((b[1] - a[1]) * t / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin((b[0] - a[0]) * t / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HOME = { latitude: 33.3000, longitude: 44.4200 }; // Karrada, Baghdad
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false, locale: "ar", geolocation: { ...HOME, accuracy: 8 }, permissions: ["geolocation"] });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
const cam = () => page.evaluate(() => { const m = window.__darbnaMap; const c = m.getCenter(); return { c: [c.lng, c.lat], z: m.getZoom(), b: m.getBearing(), p: m.getPitch() }; });
const puck = () => page.evaluate(() => { const d = window.__darbnaMap.getSource("me")?.serialize?.().data; const f = d?.features?.[0]; return f ? f.geometry.coordinates : null; });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

await page.goto(URL);
await page.waitForFunction(() => window.__darbnaMap && window.__darbnaMap.isStyleLoaded(), null, { timeout: 45000 });
await page.waitForFunction(() => window.__darbnaMap.areTilesLoaded(), null, { timeout: 30000 }).catch(() => {});
await sleep(2500);
await shot("01-start");

// ---------------------------------------------------------------- GPS
let p = null; for (let i = 0; i < 20 && !p; i++) { p = await puck(); if (!p) await sleep(500); }
check("GPS: your position is shown", !!p && km(p, [HOME.longitude, HOME.latitude]) < 0.05, p ? `${Math.round(km(p, [HOME.longitude, HOME.latitude]) * 1000)} m from the real position` : "no position");
// walk ~150 m east in steps
for (let i = 1; i <= 6; i++) { await ctx.setGeolocation({ latitude: HOME.latitude, longitude: HOME.longitude + i * 0.00027, accuracy: 8 }); await sleep(700); }
await sleep(1500);
p = await puck();
check("GPS: position follows you smoothly", !!p && km(p, [HOME.longitude + 6 * 0.00027, HOME.latitude]) < 0.03, p ? `${Math.round(km(p, [HOME.longitude + 6 * 0.00027, HOME.latitude]) * 1000)} m behind` : "");
// a real 2 km move (e.g. the first position was an old cached one): must be accepted, not frozen
const FAR = [HOME.longitude + 0.022, HOME.latitude];
for (let i = 0; i < 4; i++) { await ctx.setGeolocation({ latitude: FAR[1], longitude: FAR[0] + i * 0.00001, accuracy: 8 }); await sleep(900); }
await sleep(1500);
p = await puck();
check("GPS: a real big move is accepted within a few seconds (no frozen dot)", !!p && km(p, FAR) < 0.05, p ? `${Math.round(km(p, FAR) * 1000)} m from the new place` : "");
await ctx.setGeolocation({ ...HOME, accuracy: 8 }); await sleep(2500);

// ---------------------------------------------------------------- free map (browsing)
const box = await page.locator("canvas.maplibregl-canvas").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
let before = await cam();
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 160, cy + 120, { steps: 12 }); await page.mouse.up();
await sleep(500); const afterDrag = await cam(); await sleep(4000); const later = await cam();
check("Map: drag moves the map", km(before.c, afterDrag.c) > 0.1, `${Math.round(km(before.c, afterDrag.c) * 1000)} m`);
check("Map: stays where you dragged it (no snapping back to GPS)", km(afterDrag.c, later.c) < 0.01);
await page.evaluate(() => { const m = window.__darbnaMap; window.__calls = []; for (const fn of ["jumpTo", "easeTo", "flyTo", "stop"]) { const o = m[fn].bind(m); m[fn] = (...a) => { window.__calls.push(fn); return o(...a); }; } window.__ev = []; for (const e of ["rotatestart", "rotate", "pitchstart", "contextmenu"]) m.on(e, () => window.__ev.push(e)); });
// Rotation turns around the map's centre, so start off-centre like a real hand does.
await page.mouse.move(cx - 140, cy - 160); await page.mouse.down({ button: "right" }); await page.mouse.move(cx + 140, cy - 160, { steps: 14 });
const during = await cam();
await page.mouse.up({ button: "right" });
await sleep(600); const rot = await cam();
console.log(`  (bearing while rotating ${during.b.toFixed(1)}°, after release ${rot.b.toFixed(1)}°)`);
const diag = await page.evaluate(() => ({ calls: [...new Set(window.__calls)].join(","), ev: [...new Set(window.__ev)].join(",") }));
check("Map: rotate", Math.abs(rot.b) > 5, `bearing ${rot.b.toFixed(1)}° (events: ${diag.ev || "none"}; camera calls: ${diag.calls || "none"})`);
await page.keyboard.down("Control"); await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy - 120, { steps: 12 }); await page.mouse.up(); await page.keyboard.up("Control");
await sleep(600); const tilt = await cam();
check("Map: tilt", tilt.p > 5, `pitch ${tilt.p.toFixed(1)}°`);
await page.mouse.move(cx, cy); await page.mouse.wheel(0, -600); await sleep(800); const zin = await cam();
check("Map: zoom", zin.z > tilt.z + 0.3, `${tilt.z.toFixed(1)} → ${zin.z.toFixed(1)}`);
await sleep(3000); const still = await cam();
check("Map: rotation/tilt kept (nothing resets it)", Math.abs(still.b - zin.b) < 1 && Math.abs(still.p - zin.p) < 1);
await shot("02-free-map");
await page.getByRole("button", { name: "توسيط" }).first().click().catch(() => {});
await sleep(1500);

// ---------------------------------------------------------------- search (no search key pressed)
const SEARCHES = [
  ["الكرادة", [44.42, 33.30]], ["قلعة أربيل", [44.009, 36.191]], ["Erbil Citadel", [44.009, 36.191]], ["البصره", [47.78, 30.51]],
  ["فاميلي مول", [44.0, 36.2]], ["المنصوور", [44.35, 33.31]], ["پارکی ئازادی", [45.43, 35.56]], ["جامعة الموصل", [43.13, 36.36]],
  ["مرقد الإمام علي", [44.31, 31.99]], ["شارع المتنبي", [44.39, 33.34]],
];
const dest = () => page.evaluate(() => { const d = window.__darbnaMap.getSource("dest")?.serialize?.().data; const f = d?.features?.[0]; return f ? f.geometry.coordinates : null; });
for (const [i, [q, where]] of SEARCHES.entries()) {
  await page.getByLabel("وين رايح؟").first().click();
  const input = page.locator("input").first();
  await input.fill(""); await input.type(q, { delay: 60 });
  const t0 = Date.now();
  const ok = await page.getByTestId("search-result").first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await sleep(300);
  const names = ok ? await page.getByTestId("search-result").allInnerTexts() : [];
  await shot(`03-search-${i}`);
  check(`Search "${q}": results appear by themselves (no search key)`, ok, ok ? `${secs}s after typing, ${names.length} results, first «${names[0]?.split("\n")[0]}»` : `nothing after ${secs}s`);
  if (!ok) { await page.keyboard.press("Escape").catch(() => {}); await page.goto(URL); await page.waitForFunction(() => window.__darbnaMap?.isStyleLoaded(), null, { timeout: 30000 }); continue; }
  await page.getByTestId("search-result").first().click();
  await sleep(1800);
  const at = await cam(), pin = await dest();
  check(`Search "${q}": picking a result moves the map to it`, !!pin && km(at.c, pin) < 0.5, pin ? `map ${Math.round(km(at.c, pin) * 1000)} m from the picked place` : "no place marker");
  const right = !!pin && km(pin, where) < 25;
  results.push({ name: `Search "${q}": first result is the expected city`, ok: right, info: true, detail: pin ? `${km(pin, where).toFixed(1)} km away` : "" });
  console.log(`${right ? "INFO-OK " : "INFO-NO "}Search "${q}": first result in the expected city — ${pin ? km(pin, where).toFixed(1) + " km" : "?"}`);
  await page.getByRole("button", { name: "إغلاق" }).first().click().catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(600);
}

// ---------------------------------------------------------------- navigation: free map while driving
await page.getByLabel("وين رايح؟").first().click();
await page.locator("input").first().type("ساحة التحرير", { delay: 50 });
await page.getByTestId("search-result").first().waitFor({ timeout: 9000 }).catch(() => {});
await page.getByTestId("search-result").first().click().catch(() => {});
await sleep(1500);
await page.getByRole("button", { name: "المسار" }).first().click().catch(() => {});
const demo = page.getByRole("button", { name: "تجربة" }).first();
const routed = await demo.waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
check("Navigation: a route is found", routed);
if (routed) {
  await demo.click(); await sleep(6000);
  await shot("04-driving");
  const d0 = await cam();
  check("Navigation: camera follows and turns with you", d0.p > 20, `pitch ${d0.p.toFixed(0)}°`);
  const b2 = await page.locator("canvas.maplibregl-canvas").boundingBox();
  const x = b2.x + b2.width / 2, y = b2.y + b2.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 150, y - 100, { steps: 10 }); await page.mouse.up();
  await sleep(500); const moved = await cam(); await sleep(4000); const after = await cam();
  check("Navigation: you can drag the map while driving", km(d0.c, moved.c) > 0.05);
  check("Navigation: the camera stays where you put it", km(moved.c, after.c) < 0.01 && Math.abs(moved.p - after.p) < 1, `moved ${Math.round(km(moved.c, after.c) * 1000)} m`);
  const rc = page.getByRole("button", { name: "توسيط" }).first();
  const hasRc = await rc.isVisible().catch(() => false);
  check("Navigation: recenter button appears", hasRc);
  await page.mouse.move(x, y); await page.mouse.down({ button: "right" }); await page.mouse.move(x + 120, y, { steps: 10 }); await page.mouse.up({ button: "right" });
  await sleep(500); const r2 = await cam();
  check("Navigation: you can rotate while driving", Math.abs(r2.b - after.b) > 5);
  await shot("05-driving-free");
  if (hasRc) { await rc.click(); await sleep(3000); const back = await cam(); const pk = await puck(); check("Navigation: recenter follows you again", pk && km(back.c, pk) < 0.3, pk ? `${Math.round(km(back.c, pk) * 1000)} m from you` : ""); }
}

const failed = results.filter((r) => !r.ok && !r.info);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
const real = results.filter((r) => !r.info);
console.log(`\n${real.length - failed.length}/${real.length} checks passed; first result in expected city for ${results.filter((r) => r.info && r.ok).length}/${results.filter((r) => r.info).length} searches`);
await browser.close();
process.exit(0);
