/**
 * End-to-end API tests against a real PostgreSQL database and fake routing/geocoding
 * upstreams. Requires TEST_DATABASE_URL (the database is wiped).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { destinationPoint, encodePolyline, type LngLat } from "@darbna/core";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { connect, type Db } from "../src/db";
import { migrate } from "../src/migrate";
import { NominatimProvider } from "../src/providers/geocoding";
import { ValhallaProvider } from "../src/providers/routing";
import { seedDemoReports, seedGazetteer } from "../src/seed";

const DB_URL = process.env.TEST_DATABASE_URL;
const d = DB_URL ? describe : describe.skip;

let db: Db;
let app: ReturnType<typeof buildApp>;
let appNoSample: ReturnType<typeof buildApp>;
let valhalla: ReturnType<typeof Bun.serve>;
let nominatim: ReturnType<typeof Bun.serve>;
let lastValhallaBody: any = null;
let nominatimDown = false;

const TAHRIR: LngLat = [44.4140, 33.3337];
const corner = destinationPoint(TAHRIR, 0, 1200);
const GEOM: LngLat[] = [TAHRIR, destinationPoint(TAHRIR, 0, 600), corner, destinationPoint(corner, 90, 300), destinationPoint(corner, 90, 600)];
const DEST = GEOM[GEOM.length - 1];

/** Shape of a real Valhalla /route response (fixture values, not real roads). */
function valhallaFixture() {
  const trip = (len: number, time: number) => ({
    summary: { length: len, time },
    legs: [{
      shape: encodePolyline(GEOM, 6),
      maneuvers: [
        { type: 1, street_names: ["شارع السعدون"], length: 1.2, time: 120, begin_shape_index: 0 },
        { type: 10, street_names: ["شارع أبو نؤاس"], length: 0.6, time: 60, begin_shape_index: 2 },
        { type: 4, length: 0, time: 0, begin_shape_index: 4 },
      ],
    }],
  });
  return { trip: trip(1.8, 180), alternates: [{ trip: trip(2.1, 210) }] };
}

const INSTALL_A = "11111111-1111-4111-8111-111111111111";
const INSTALL_B = "22222222-2222-4222-8222-222222222222";
const INSTALL_C = "33333333-3333-4333-8333-333333333333";

async function call(a: typeof app, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await a.fetch(new Request(`http://test${path}`, {
    method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  }), "127.0.0.1");
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const as = (id: string) => ({ "x-darbna-install": id });

d("Darbna API", () => {
  beforeAll(async () => {
    db = connect(DB_URL!);
    await db.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(db, () => {});
    await seedGazetteer(db);
    valhalla = Bun.serve({
      port: 0,
      async fetch(req) {
        lastValhallaBody = await req.json();
        const [o] = lastValhallaBody.locations;
        if (o.lat > 37) return Response.json({ error_code: 171, error: "No suitable edges near location" }, { status: 400 });
        return Response.json(valhallaFixture());
      },
    });
    nominatim = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/style") return Response.json({ version: 8, sources: {}, layers: [
          { id: "water", type: "fill" }, { id: "building", type: "fill", minzoom: 13 }, { id: "building-3d", type: "fill-extrusion" },
          { id: "poi_r1", type: "symbol", minzoom: 14 }, { id: "road_major", type: "line" },
        ] });
        if (nominatimDown) return new Response("down", { status: 503 });
        if (u.pathname === "/reverse") return Response.json({ place_id: 9, osm_type: "way", osm_id: 77, lat: "33.3337", lon: "44.4140", name: "ساحة التحرير", display_name: "ساحة التحرير, بغداد", address: { city: "بغداد" } });
        return Response.json([{ place_id: 1, osm_type: "node", osm_id: 5, lat: "33.31", lon: "44.42", name: "مستشفى ابن النفيس", display_name: "مستشفى ابن النفيس, بغداد", type: "hospital", importance: 0.3, address: { city: "بغداد" } }]);
      },
    });
    const base = loadConfig({ ...process.env, NODE_ENV: "test", DATABASE_URL: DB_URL, SAMPLE_DATA: "on",
      MAP_STYLE_DAY_URL: `http://localhost:${nominatim.port}/style`, MAP_STYLE_NIGHT_URL: `http://localhost:${nominatim.port}/style` } as any);
    const deps = {
      db,
      routing: new ValhallaProvider(`http://localhost:${valhalla.port}`, 2000),
      geocoder: new NominatimProvider(`http://localhost:${nominatim.port}`, 2000, "test"),
      log: (l: any) => { if (l.level !== "info") console.log(JSON.stringify(l)); },
    };
    app = buildApp({ ...deps, config: base });
    appNoSample = buildApp({ ...deps, config: { ...base, sampleData: false } });
  });

  afterAll(async () => {
    valhalla?.stop(true);
    nominatim?.stop(true);
    await db?.close();
  });

  it("serves a lightened map style (no 3D buildings, later POIs/footprints)", async () => {
    const c = await call(app, "GET", "/v1/config");
    expect(c.body.map.styleDay).toBe("http://test/v1/style/day");
    const r = await call(app, "GET", "/v1/style/day");
    if (!r.body.layers) throw new Error(JSON.stringify(r));
    const ids = r.body.layers.map((l: any) => l.id);
    expect(ids).toEqual(["water", "building", "poi_r1", "road_major"]);
    expect(r.body.layers.find((l: any) => l.id === "building").minzoom).toBe(15);
    expect(r.body.layers.find((l: any) => l.id === "poi_r1").minzoom).toBe(15);
  });

  it("advertises only real capabilities", async () => {
    const r = await call(app, "GET", "/v1/config");
    expect(r.body.features).toEqual({ offlineMapDisplay: false, offlineRouting: false, liveTraffic: false });
    expect(r.body.routing.traffic).toBe(false);
  });

  describe("search", () => {
    const top = async (q: string, lang = "ar") => (await call(app, "GET", `/v1/search?q=${encodeURIComponent(q)}&lang=${lang}`)).body.results[0];
    it.each([
      ["الكاظمية", "الكاظمية"], ["كاظميه", "الكاظمية"], ["Kazimiyah", "الكاظمية"], ["al kadhimiya", "الكاظمية"],
      ["Arbil", "أربيل"], ["Hawler", "أربيل"], ["هەولێر", "أربيل"],
      ["الكراده", "الكرادة"], ["Karada", "الكرادة"],
      ["بغداد الجديده", "بغداد الجديدة"], ["Basrah", "البصرة"], ["slemani", "السليمانية"],
      ["ساحه التحرير", "ساحة التحرير"], ["مطار بغداد", "مطار بغداد الدولي"],
    ])("%s → %s", async (q, expected) => {
      const r = await top(q);
      expect(r?.name).toBe(expected);
      expect(r.quality).toBe("seed_unverified");
    });
    it("localizes names (Kurdish, English)", async () => {
      expect((await top("Erbil", "ckb")).name).toBe("هەولێر");
      expect((await top("الكرادة", "en")).name).toBe("Karrada");
      expect((await top("Karrada", "en")).secondary).toBe("Baghdad");
    });
    it("merges provider results and survives the provider being down", async () => {
      let r = await call(app, "GET", `/v1/search?q=${encodeURIComponent("ابن النفيس")}`);
      expect(r.body.results.some((x: any) => x.source === "nominatim")).toBe(true);
      nominatimDown = true;
      r = await call(app, "GET", `/v1/search?q=${encodeURIComponent("الموصل")}`);
      nominatimDown = false;
      expect(r.body.partial).toBe(true);
      expect(r.body.results[0].name).toBe("الموصل");
    });
    it("reverse-geocodes a dropped pin", async () => {
      const r = await call(app, "GET", `/v1/reverse?at=44.414,33.3337`);
      expect(r.body.result.name).toBe("ساحة التحرير");
    });
  });

  describe("routing", () => {
    it("returns road-network routes with alternatives and honest ETA labeling", async () => {
      const r = await call(app, "POST", "/v1/route", { origin: TAHRIR, destination: DEST, heading: 10 });
      expect(r.status).toBe(200);
      expect(r.body.routes.length).toBe(2);
      const rt = r.body.routes[0];
      expect(rt.durationSource).toBe("engine_no_traffic");
      expect(rt.steps.map((s: any) => s.kind)).toEqual(["depart", "right", "arrive"]);
      expect(rt.steps[1].streetName).toBe("شارع أبو نؤاس");
      expect(rt.geometry.length).toBe(GEOM.length);
      expect(lastValhallaBody.locations[0].heading).toBe(10);
      expect(lastValhallaBody.alternates).toBe(2);
    });
    it("rejects destinations outside Iraq and too-close trips", async () => {
      expect((await call(app, "POST", "/v1/route", { origin: TAHRIR, destination: [2.35, 48.85] })).body.error).toBe("outside_service_area");
      expect((await call(app, "POST", "/v1/route", { origin: TAHRIR, destination: TAHRIR })).body.error).toBe("too_close");
      expect((await call(app, "POST", "/v1/route", { origin: "x", destination: DEST })).status).toBe(400);
    });
    it("maps provider errors", async () => {
      const r = await call(app, "POST", "/v1/route", { origin: [43, 37.2], destination: DEST });
      expect(r.status).toBe(422);
      expect(r.body.error).toBe("off_network");
    });
  });

  describe("reports", () => {
    let reportId = "";
    const spot = destinationPoint(TAHRIR, 0, 300);

    it("requires an anonymous install id", async () => {
      expect((await call(app, "POST", "/v1/reports", { category: "crash", coord: spot })).status).toBe(401);
    });
    it("creates a report with expiry and baseline confidence", async () => {
      const r = await call(app, "POST", "/v1/reports", { category: "crash", coord: spot, heading: 5 }, as(INSTALL_A));
      expect(r.status).toBe(201);
      reportId = r.body.report.id;
      expect(r.body.report.confidence).toBe(0.4);
      expect(r.body.report.verified).toBe(false);
      const life = Date.parse(r.body.report.expiresAt) - Date.parse(r.body.report.createdAt);
      expect(Math.round(life / 60000)).toBe(60);
      expect(JSON.stringify(r.body)).not.toContain("reporter");
    });
    it("treats a nearby same-category report as a confirmation (duplicate detection)", async () => {
      const r = await call(app, "POST", "/v1/reports", { category: "crash", coord: destinationPoint(spot, 90, 50) }, as(INSTALL_B));
      expect(r.status).toBe(200);
      expect(r.body.duplicate).toBe(true);
      expect(r.body.report.id).toBe(reportId);
      expect(r.body.report.confirms).toBe(1);
      expect(r.body.report.confidence).toBeGreaterThan(0.4);
    });
    it("a different category at the same spot is a new report", async () => {
      const r = await call(app, "POST", "/v1/reports", { category: "pothole", coord: spot }, as(INSTALL_B));
      expect(r.status).toBe(201);
    });
    it("blocks self-votes and double votes", async () => {
      expect((await call(app, "POST", `/v1/reports/${reportId}/votes`, { vote: "confirm" }, as(INSTALL_A))).body.error).toBe("own_report");
      expect((await call(app, "POST", `/v1/reports/${reportId}/votes`, { vote: "confirm" }, as(INSTALL_B))).body.error).toBe("already_voted");
    });
    it("community 'no longer there' votes hide the report", async () => {
      await call(app, "POST", `/v1/reports/${reportId}/votes`, { vote: "gone" }, as(INSTALL_B)); // switches B's vote
      const r = await call(app, "POST", `/v1/reports/${reportId}/votes`, { vote: "gone" }, as(INSTALL_C));
      expect(r.body.report.gone).toBe(2);
      expect(r.body.report.confirms).toBe(0);
      const list = await call(app, "GET", `/v1/reports?bbox=44.40,33.32,44.43,33.35`);
      expect(list.body.reports.find((x: any) => x.id === reportId)).toBeUndefined();
      const q = await call(app, "GET", `/v1/admin/reports?status=hidden`, undefined, { authorization: "Bearer dev-admin-token" });
      expect(q.body.reports.find((x: any) => x.id === reportId).hiddenReason).toBe("gone_votes");
    });
    it("moderators can restore or remove; admin requires a token", async () => {
      expect((await call(app, "GET", `/v1/admin/reports`)).status).toBe(401);
      const r = await call(app, "POST", `/v1/admin/reports/${reportId}/moderate`, { action: "remove", note: "test" }, { authorization: "Bearer dev-admin-token" });
      expect(r.body.ok).toBe(true);
    });
    it("rate-limits report creation per install", async () => {
      const id = "44444444-4444-4444-8444-444444444444";
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        const p = destinationPoint(TAHRIR, 180, 2000 + i * 1000);
        codes.push((await call(app, "POST", "/v1/reports", { category: "roadworks", coord: p }, as(id))).status);
      }
      expect(codes).toEqual([201, 201, 201, 429]);
    });
    it("stale reports expire and disappear", async () => {
      const p = destinationPoint(TAHRIR, 270, 500);
      const r = await call(app, "POST", "/v1/reports", { category: "congestion", coord: p }, as(INSTALL_C));
      await db`UPDATE reports SET expires_at = now() - interval '1 minute' WHERE id = ${r.body.report.id}`;
      const list = await call(app, "GET", `/v1/reports?bbox=44.39,33.32,44.42,33.35`);
      expect(list.body.reports.find((x: any) => x.id === r.body.report.id)).toBeUndefined();
      const s = await app.reports.sweep();
      expect(s.expired).toBeGreaterThanOrEqual(1);
      const [row] = await db`SELECT status, reporter_hash FROM reports WHERE id = ${r.body.report.id}`;
      expect(row.status).toBe("expired");
      expect(row.reporter_hash).toBeNull();
    });
  });

  describe("reports and routing", () => {
    it("unverified closures are advisory only; verified official closures are avoided", async () => {
      const onRoute = destinationPoint(TAHRIR, 0, 900);
      const c = await call(app, "POST", "/v1/reports", { category: "closure", coord: onRoute }, as("55555555-5555-4555-8555-555555555555"));
      let r = await call(app, "POST", "/v1/route", { origin: TAHRIR, destination: DEST });
      expect(lastValhallaBody.exclude_polygons).toBeUndefined();
      expect(r.body.routes[0].reportIdsOnRoute).toContain(c.body.report.id);

      // Driver explicitly chooses to avoid an "advise" report → excluded on their request only.
      await call(app, "POST", `/v1/reports/${c.body.report.id}/votes`, { vote: "confirm" }, as(INSTALL_A));
      await call(app, "POST", `/v1/reports/${c.body.report.id}/votes`, { vote: "confirm" }, as(INSTALL_C));
      r = await call(app, "POST", "/v1/route", { origin: TAHRIR, destination: DEST, avoidReportIds: [c.body.report.id] });
      expect(lastValhallaBody.exclude_polygons.length).toBe(1);

      const off = await call(app, "POST", "/v1/admin/official-reports", {
        category: "closure", coord: destinationPoint(corner, 90, 200),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(), officialRef: "Baghdad Traffic Directorate notice (test)",
      }, { authorization: "Bearer dev-admin-token" });
      expect(off.status).toBe(201);
      expect(off.body.report.verified).toBe(true);
      r = await call(app, "POST", "/v1/route", { origin: TAHRIR, destination: DEST });
      expect(lastValhallaBody.exclude_polygons.length).toBe(1);
      expect(r.body.routes[0].avoidedClosureIds).toEqual([off.body.report.id]);
    });
  });

  describe("sample data and privacy", () => {
    it("sample reports are flagged and hidden when SAMPLE_DATA is off", async () => {
      await seedDemoReports(db);
      const bbox = "44.39,33.31,44.44,33.36";
      const on = await call(app, "GET", `/v1/reports?bbox=${bbox}`);
      expect(on.body.reports.some((r: any) => r.isSample)).toBe(true);
      const off = await call(appNoSample, "GET", `/v1/reports?bbox=${bbox}`);
      expect(off.body.reports.some((r: any) => r.isSample)).toBe(false);
    });
    it("DELETE /v1/me unlinks reports and removes votes", async () => {
      const r = await call(app, "DELETE", "/v1/me", undefined, as(INSTALL_C));
      expect(r.body.deleted.votesDeleted).toBeGreaterThan(0);
      const [n] = await db`SELECT count(*)::int AS n FROM report_votes`;
      expect(n.n).toBeGreaterThan(0); // other users' votes untouched
    });
    it("stores no raw install ids", async () => {
      const rows = await db`SELECT reporter_hash FROM reports WHERE reporter_hash IS NOT NULL UNION ALL SELECT voter_hash FROM report_votes`;
      for (const r of rows) expect(r.reporter_hash).not.toMatch(/-4\d{3}-/);
    });
  });
});
