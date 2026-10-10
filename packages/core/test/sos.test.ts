import { describe, expect, it } from "bun:test";
import shapesJson from "../data/sos-regions.json";
import configJson from "../data/emergency-numbers.json";
import { destinationPoint, haversine, type LngLat } from "../src/geo";
import {
  IRAQ, KURDISTAN, OTHER, RegionTracker, locateRegion, pickEmergencyConfig, resolveSos, untestedNumbers, validateEmergencyConfig,
  type EmergencyConfig, type RegionShapes, type RegionStatus,
} from "../src/sos";

const shapes = shapesJson as unknown as RegionShapes;
const config = configJson as unknown as EmergencyConfig;
const locate = (p: LngLat) => locateRegion(p, shapes);

const KIRKUK: LngLat = [44.3922, 35.4681];
const ERBIL: LngLat = [44.0092, 36.1911];
const BAGHDAD: LngLat = [44.3661, 33.3152];
const SULAYMANIYAH: LngLat = [45.4375, 35.565];
const ISTANBUL: LngLat = [28.9784, 41.0082];
const TEHRAN: LngLat = [51.389, 35.689];
const T0 = Date.parse("2026-10-11T08:00:00Z");

/** Points every `stepM` metres along the straight line a → b. */
function track(a: LngLat, b: LngLat, stepM: number): LngLat[] {
  const n = Math.ceil(haversine(a, b) / stepM);
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as LngLat);
}
/** Where the line a → b crosses into the Kurdistan Region (first point inside, to ~10 m). */
function crossing(a: LngLat, b: LngLat): LngLat {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    const p: LngLat = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m];
    if (locate(p).region === KURDISTAN) hi = m; else lo = m;
  }
  return [a[0] + (b[0] - a[0]) * hi, a[1] + (b[1] - a[1]) * hi];
}
/** Drive the points through a tracker, one fix every `everyMs`; returns the region after each fix. */
function drive(t: RegionTracker, pts: LngLat[], everyMs: number, accuracyM = 10): RegionStatus[] {
  return pts.map((coord, i) => t.update({ coord, accuracyM, at: T0 + i * everyMs }));
}
const switches = (s: RegionStatus[]) => s.filter((x, i) => i > 0 && x.region !== s[i - 1].region).length;

describe("boundaries", () => {
  it("knows the official Kurdistan Region from the rest of Iraq and from other countries", () => {
    for (const p of [ERBIL, SULAYMANIYAH, [42.9931, 36.8669], [45.9861, 35.1778], [42.6847, 37.144]] as LngLat[]) expect(locate(p).region).toBe(KURDISTAN);
    for (const p of [KIRKUK, BAGHDAD, [43.1189, 36.345], [47.7804, 30.5085], [43.58, 35.776]] as LngLat[]) expect(locate(p).region).toBe(IRAQ);
    expect(locate(ISTANBUL).region).toBe("TUR");
    expect(locate(TEHRAN).region).toBe(OTHER);
  });
});

describe("entering and leaving the Kurdistan Region", () => {
  it("switches to Kurdistan numbers once, after the boundary is clearly behind you", () => {
    const t = new RegionTracker(locate);
    const s = drive(t, track(KIRKUK, ERBIL, 200), 8_000); // ~90 km/h
    expect(s[0].region).toBe(IRAQ);
    expect(s[s.length - 1].region).toBe(KURDISTAN);
    expect(switches(s)).toBe(1);
    // The switch happens well inside the region: at least the margin past the boundary.
    const cross = crossing(KIRKUK, ERBIL);
    const at = s.findIndex((x) => x.region === KURDISTAN);
    expect(haversine(cross, track(KIRKUK, ERBIL, 200)[at])).toBeGreaterThanOrEqual(750);
  });

  it("switches back to 911 once when leaving", () => {
    const t = new RegionTracker(locate);
    const s = drive(t, track(ERBIL, KIRKUK, 200), 8_000);
    expect(s[0].region).toBe(KURDISTAN);
    expect(s[s.length - 1].region).toBe(IRAQ);
    expect(switches(s)).toBe(1);
  });

  it("doesn't flip back and forth while you drive along the boundary", () => {
    const cross = crossing(KIRKUK, ERBIL);
    const t = new RegionTracker(locate);
    drive(t, [KIRKUK], 0);
    // Zig-zag 400 m either side of the boundary (along the road's direction) for 10 minutes.
    const brg = Math.atan2(ERBIL[0] - KIRKUK[0], ERBIL[1] - KIRKUK[1]) * 180 / Math.PI;
    const zig = Array.from({ length: 60 }, (_, i) => destinationPoint(cross, i % 2 ? brg : brg + 180, 400));
    expect(new Set(zig.map((p) => locate(p).region)).size).toBe(2); // really on both sides
    const s = drive(t, zig, 10_000);
    expect(s.every((x) => x.region === IRAQ)).toBe(true);
    expect(s.some((x) => x.confidence === "near_boundary")).toBe(true);
  });

  it("needs two agreeing fixes over 15 s: one stray fix doesn't switch", () => {
    const t = new RegionTracker(locate);
    t.update({ coord: KIRKUK, accuracyM: 10, at: T0 });
    t.update({ coord: ERBIL, accuracyM: 10, at: T0 + 1000 }); // a single wild jump
    expect(t.update({ coord: KIRKUK, accuracyM: 10, at: T0 + 2000 }).region).toBe(IRAQ);
  });
});

describe("poor GPS", () => {
  it("never changes the region on inaccurate fixes", () => {
    const t = new RegionTracker(locate);
    t.update({ coord: BAGHDAD, accuracyM: 15, at: T0 });
    for (let i = 1; i <= 10; i++) {
      const s = t.update({ coord: ERBIL, accuracyM: 2500, at: T0 + i * 10_000 });
      expect(s.region).toBe(IRAQ);
      expect(s.confidence).toBe("poor_gps");
    }
    // Good fixes again: now it may switch.
    t.update({ coord: ERBIL, accuracyM: 12, at: T0 + 200_000 });
    expect(t.update({ coord: ERBIL, accuracyM: 12, at: T0 + 220_000 }).region).toBe(KURDISTAN);
  });

  it("shows both sets, clearly marked, when the very first fix is right at the boundary", () => {
    const t = new RegionTracker(locate);
    const s = t.update({ coord: crossing(KIRKUK, ERBIL), accuracyM: 20, at: T0 });
    expect(s.region).toBeNull();
    const v = resolveSos({ config, now: T0, permission: "granted", live: s, cached: null, manual: null });
    expect(v.needsChoice).toBe(true);
    expect(v.alternatives.map((a) => a.region).sort()).toEqual([IRAQ, KURDISTAN].sort());
  });
});

describe("what the SOS screen shows", () => {
  const live = (region: string, at: number): RegionStatus => ({ region, confirmedAt: at, confidence: "confirmed", candidate: region, edgeM: 5000 });

  it("Kurdistan Region: police 104, ambulance 122, civil defence 115", () => {
    const v = resolveSos({ config, now: T0, permission: "granted", live: live(KURDISTAN, T0), cached: null, manual: null });
    expect(v.basis).toBe("location");
    expect(v.contacts.map((c) => [c.service, c.number])).toEqual([["police", "104"], ["ambulance", "122"], ["civil_defense", "115"]]);
  });

  it("rest of Iraq: 911 first", () => {
    const v = resolveSos({ config, now: T0, permission: "granted", live: live(IRAQ, T0), cached: null, manual: null });
    expect(v.contacts[0].number).toBe("911");
    expect(v.contacts[0].primary).toBe(true);
  });

  it("outside Iraq: the country's verified number, or an honest 'not confirmed' — never 911", () => {
    const tur = resolveSos({ config, now: T0, permission: "granted", live: live("TUR", T0), cached: null, manual: null });
    expect(tur.contacts.map((c) => c.number)).toEqual(["112"]);
    const other = resolveSos({ config, now: T0, permission: "granted", live: live(OTHER, T0), cached: null, manual: null });
    expect(other.contacts).toEqual([]);
    expect(other.unconfirmed).toBe(true);
    expect(JSON.stringify(other)).not.toContain('"911"');
  });

  it("offline / after a restart: last confirmed region and its numbers, marked as possibly outdated", () => {
    const v = resolveSos({ config, now: T0 + 3 * 3600_000, permission: "granted", live: null, cached: { region: KURDISTAN, at: T0 }, manual: null });
    expect(v.basis).toBe("last_known");
    expect(v.contacts.map((c) => c.number)).toEqual(["104", "122", "115"]);
    expect(v.locationStale).toBe(true);
    expect(v.needsChoice).toBe(true); // offered, but the numbers stay on screen
  });

  it("location permission denied: asks the user to choose, then uses their choice", () => {
    const none = resolveSos({ config, now: T0, permission: "denied", live: null, cached: null, manual: null });
    expect(none.needsChoice).toBe(true);
    expect(none.contacts).toEqual([]);
    const chosen = resolveSos({ config, now: T0, permission: "denied", live: null, cached: null, manual: { region: IRAQ, at: T0 } });
    expect(chosen.basis).toBe("manual");
    expect(chosen.needsChoice).toBe(false);
    expect(chosen.contacts[0].number).toBe("911");
  });

  it("a manual choice holds until location confirms a region again after it", () => {
    const m = resolveSos({ config, now: T0 + 60_000, permission: "granted", live: live(IRAQ, T0), cached: null, manual: { region: KURDISTAN, at: T0 + 30_000 } });
    expect(m.region).toBe(KURDISTAN);
    const later = resolveSos({ config, now: T0 + 120_000, permission: "granted", live: live(IRAQ, T0 + 90_000), cached: null, manual: { region: KURDISTAN, at: T0 + 30_000 } });
    expect(later.region).toBe(IRAQ);
    expect(later.basis).toBe("location");
  });

  it("flags numbers that haven't been re-verified for longer than the config allows", () => {
    const old = resolveSos({ config, now: Date.parse("2027-06-01"), permission: "granted", live: live(IRAQ, Date.parse("2027-06-01")), cached: null, manual: null });
    expect(old.numbersStale).toBe(true);
    expect(resolveSos({ config, now: T0, permission: "granted", live: live(IRAQ, T0), cached: null, manual: null }).numbersStale).toBe(false);
  });
});

describe("numbers configuration", () => {
  it("the built-in config is valid and every number has a source", () => {
    expect(validateEmergencyConfig(config)).not.toBeNull();
    for (const r of Object.values(config.regions)) for (const c of r.contacts) expect(c.sources.length).toBeGreaterThan(0);
  });
  it("rejects broken or tampered downloads and only takes newer versions", () => {
    expect(validateEmergencyConfig({ ...config, regions: { IQ: { lastVerified: "2026-10-11", contacts: [{ service: "general", number: "9 1 1", sources: [] }] } } })).toBeNull();
    expect(validateEmergencyConfig({ ...config, schema: 2 })).toBeNull();
    expect(validateEmergencyConfig({ ...config, regions: { IQ: { ...config.regions.IQ, contacts: [{ ...config.regions.IQ.contacts[0], sources: [{ title: "x", url: "http://evil", official: true }] }] } } })).toBeNull();
    expect(pickEmergencyConfig(config, { ...config, version: config.version - 1 })).toBe(config);
    expect(pickEmergencyConfig(config, "garbage")).toBe(config);
    const newer = { ...config, version: config.version + 1 };
    expect(pickEmergencyConfig(config, newer).version).toBe(config.version + 1);
  });
  it("lists numbers still waiting for a call test (release gate)", () => {
    expect(untestedNumbers(config).length).toBe(5);
  });
});
