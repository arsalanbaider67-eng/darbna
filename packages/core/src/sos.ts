/**
 * SOS: which emergency numbers to show where you are.
 *
 *  - Kurdistan Region of Iraq (IQ-KR, the official region: Erbil, Duhok, Sulaymaniyah, Halabja)
 *    → its own police / ambulance / civil-defence numbers.
 *  - Elsewhere in Iraq → 911.
 *  - Outside Iraq → that country's number only if it's in the verified config; otherwise the app
 *    says it couldn't confirm the number. 911 is never assumed outside Iraq.
 *
 * The region comes from real boundaries (packages/core/data/sos-regions.json) and only changes
 * after confident fixes: good GPS accuracy, clearly away from the boundary, seen twice over a
 * short time. Everything here is pure (no I/O), so it's unit-tested.
 */
import { projectOnSegment, type LngLat } from "./geo";

// ---------------------------------------------------------------- configuration (numbers)
export type EmergencyService = "general" | "police" | "ambulance" | "civil_defense";
export interface EmergencySource { title: string; url: string; official: boolean }
export interface EmergencyContact {
  service: EmergencyService;
  number: string;
  primary?: boolean;
  sources: EmergencySource[];
  /** A real call test in the area before release: when, where and by whom. */
  callTested: { date: string; area: string; by: string } | null;
}
export interface EmergencyRegion { lastVerified: string; contacts: EmergencyContact[]; note?: string }
export interface EmergencyConfig {
  schema: 1;
  version: number;
  published: string;
  staleAfterDays: number;
  regions: Record<string, EmergencyRegion>;
}

const SERVICES: EmergencyService[] = ["general", "police", "ambulance", "civil_defense"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Checks a config (e.g. downloaded from the web) and returns it, or null if anything is off. */
export function validateEmergencyConfig(x: unknown): EmergencyConfig | null {
  const c = x as EmergencyConfig;
  if (!c || typeof c !== "object" || c.schema !== 1) return null;
  if (!Number.isInteger(c.version) || c.version < 1 || !DATE.test(c.published ?? "")) return null;
  if (!(c.staleAfterDays > 0) || !c.regions || typeof c.regions !== "object") return null;
  for (const r of Object.values(c.regions)) {
    if (!r || !DATE.test(r.lastVerified ?? "") || !Array.isArray(r.contacts) || r.contacts.length === 0) return null;
    for (const k of r.contacts) {
      if (!SERVICES.includes(k.service) || !/^[0-9]{2,6}$/.test(k.number ?? "")) return null;
      if (!Array.isArray(k.sources) || k.sources.length === 0) return null;
      if (k.sources.some((s) => typeof s.title !== "string" || !/^https:\/\//.test(s.url ?? ""))) return null;
      if (k.callTested !== null && (typeof k.callTested !== "object" || !DATE.test(k.callTested.date ?? ""))) return null;
    }
  }
  return c;
}

/** The config to use: a valid downloaded one only if it's newer than the one built into the app. */
export function pickEmergencyConfig(bundled: EmergencyConfig, downloaded: unknown): EmergencyConfig {
  const d = validateEmergencyConfig(downloaded);
  return d && d.version > bundled.version ? d : bundled;
}

/** Numbers not yet call-tested in their area: release builds are blocked until this is empty. */
export function untestedNumbers(c: EmergencyConfig): { region: string; number: string; service: EmergencyService }[] {
  const out: { region: string; number: string; service: EmergencyService }[] = [];
  for (const [region, r] of Object.entries(c.regions)) {
    for (const k of r.contacts) if (!k.callTested) out.push({ region, number: k.number, service: k.service });
  }
  return out;
}

// ---------------------------------------------------------------- boundaries
export interface RegionShape { outer: LngLat[][]; inner: LngLat[][] }
export interface RegionShapes { regions: Record<string, RegionShape> }
export const KURDISTAN = "IQ-KR";
export const IRAQ = "IQ";
/** Outside Iraq and outside every country we have a shape for. */
export const OTHER = "OTHER";

function inRing(p: LngLat, ring: LngLat[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function inShape(p: LngLat, s: RegionShape): boolean {
  return s.outer.some((r) => inRing(p, r)) && !s.inner.some((r) => inRing(p, r));
}

/** Distance (m) from p to the nearest boundary line of the shape. */
export function distanceToEdgeM(p: LngLat, s: RegionShape): number {
  let best = Infinity;
  const mPerDeg = 111_320;
  const cosLat = Math.cos((p[1] * Math.PI) / 180);
  for (const ring of [...s.outer, ...s.inner]) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      // Cheap reject: the segment's bounding box is farther away than the best so far.
      const dx = Math.max(Math.min(a[0], b[0]) - p[0], 0, p[0] - Math.max(a[0], b[0])) * mPerDeg * cosLat;
      const dy = Math.max(Math.min(a[1], b[1]) - p[1], 0, p[1] - Math.max(a[1], b[1])) * mPerDeg;
      if (dx > best || dy > best) continue;
      const d = projectOnSegment(p, a, b).distance;
      if (d < best) best = d;
    }
  }
  return best;
}

export interface Located { region: string; /** distance to the nearest boundary that matters here (m) */ edgeM: number }

/** Which SOS region a point is in, and how close it is to a boundary that would change it. */
export function locateRegion(p: LngLat, shapes: RegionShapes): Located {
  const kr = shapes.regions[KURDISTAN], iq = shapes.regions[IRAQ];
  if (inShape(p, kr)) return { region: KURDISTAN, edgeM: distanceToEdgeM(p, kr) };
  if (inShape(p, iq)) return { region: IRAQ, edgeM: Math.min(distanceToEdgeM(p, kr), distanceToEdgeM(p, iq)) };
  const toIraq = distanceToEdgeM(p, iq);
  for (const [id, s] of Object.entries(shapes.regions)) {
    if (id === KURDISTAN || id === IRAQ) continue;
    if (inShape(p, s)) return { region: id, edgeM: Math.min(toIraq, distanceToEdgeM(p, s)) };
  }
  return { region: OTHER, edgeM: toIraq };
}

// ---------------------------------------------------------------- tracking (no rapid switching)
export interface RegionFix { coord: LngLat; accuracyM: number; at: number }
export interface TrackerOptions {
  /** Fixes worse than this never change the region. */
  maxAccuracyM: number;
  /** A fix must be at least this far (plus its accuracy) from a boundary to count. */
  marginM: number;
  /** Confident fixes needed, over at least `confirmSpanMs`, before switching to a new region. */
  confirmFixes: number;
  confirmSpanMs: number;
  /** After this long without a confident fix, the region is shown as possibly outdated. */
  staleMs: number;
}
export const DEFAULT_TRACKER: TrackerOptions = { maxAccuracyM: 150, marginM: 750, confirmFixes: 2, confirmSpanMs: 15_000, staleMs: 15 * 60_000 };

export type RegionConfidence = "confirmed" | "near_boundary" | "poor_gps" | "no_fix";
export interface RegionStatus {
  /** The region in effect (last confirmed), or null if none was ever confirmed. */
  region: string | null;
  /** When a confident fix last agreed with `region`. */
  confirmedAt: number | null;
  /** What the latest fix said. */
  confidence: RegionConfidence;
  /** The region the latest usable fix fell in (may differ from `region` while confirming). */
  candidate: string | null;
  edgeM: number | null;
}

export class RegionTracker {
  private confirmed: { region: string; at: number } | null;
  private pending: { region: string; first: number; count: number } | null = null;
  private last: Omit<RegionStatus, "region" | "confirmedAt"> = { confidence: "no_fix", candidate: null, edgeM: null };
  private readonly opt: TrackerOptions;

  constructor(private readonly locate: (p: LngLat) => Located, opts: Partial<TrackerOptions> = {}, initial: { region: string; at: number } | null = null) {
    this.opt = { ...DEFAULT_TRACKER, ...opts };
    this.confirmed = initial;
  }

  get status(): RegionStatus {
    return { region: this.confirmed?.region ?? null, confirmedAt: this.confirmed?.at ?? null, ...this.last };
  }

  update(f: RegionFix): RegionStatus {
    if (!(f.accuracyM <= this.opt.maxAccuracyM)) {
      // Poor GPS: never switch on it, and it doesn't continue a switch in progress either.
      this.pending = null;
      this.last = { confidence: "poor_gps", candidate: null, edgeM: null };
      return this.status;
    }
    const loc = this.locate(f.coord);
    if (loc.edgeM < this.opt.marginM + f.accuracyM) {
      // Too close to a boundary to be sure which side you're on: keep what we had.
      this.pending = null;
      this.last = { confidence: "near_boundary", candidate: loc.region, edgeM: loc.edgeM };
      return this.status;
    }
    if (!this.confirmed || (this.confirmed.region === loc.region)) {
      // First confident fix (show numbers at once), or the same region again.
      this.confirmed = { region: loc.region, at: f.at };
      this.pending = null;
    } else if (this.pending?.region === loc.region) {
      this.pending.count++;
      if (this.pending.count >= this.opt.confirmFixes && f.at - this.pending.first >= this.opt.confirmSpanMs) {
        this.confirmed = { region: loc.region, at: f.at };
        this.pending = null;
      }
    } else {
      this.pending = { region: loc.region, first: f.at, count: 1 };
    }
    this.last = { confidence: "confirmed", candidate: loc.region, edgeM: loc.edgeM };
    return this.status;
  }
}

// ---------------------------------------------------------------- what the SOS screen shows
export type SosBasis = "location" | "last_known" | "manual" | "none";
export interface SosInput {
  config: EmergencyConfig;
  now: number;
  permission: "granted" | "denied" | "unknown";
  /** Live tracker status (null before the first fix). */
  live: RegionStatus | null;
  /** Last region confirmed by location, saved on the phone (works offline, after restarts). */
  cached: { region: string; at: number } | null;
  /** A region the user picked themselves. */
  manual: { region: string; at: number } | null;
  staleMs?: number;
}
export interface SosView {
  region: string | null;
  basis: SosBasis;
  contacts: EmergencyContact[];
  /** No verified number for where you are (outside Iraq and not in the config). */
  unconfirmed: boolean;
  /** When the region was last confirmed by location. */
  locationAt: number | null;
  locationStale: boolean;
  numbersVerified: string | null;
  numbersStale: boolean;
  nearBoundary: boolean;
  poorGps: boolean;
  /** Ask the user to pick their region (no trustworthy location, permission denied, or stale). */
  needsChoice: boolean;
  /** Near the Kurdistan boundary with nothing confirmed yet: both sets, clearly labelled. */
  alternatives: { region: string; contacts: EmergencyContact[] }[];
}

const DAY = 86_400_000;

function contactsFor(cfg: EmergencyConfig, region: string | null): EmergencyContact[] {
  if (!region || region === OTHER) return [];
  const r = cfg.regions[region];
  return r ? [...r.contacts].sort((a, b) => Number(!!b.primary) - Number(!!a.primary)) : [];
}

export function resolveSos(i: SosInput): SosView {
  const staleMs = i.staleMs ?? DEFAULT_TRACKER.staleMs;
  const liveAt = i.live?.region && i.live.confirmedAt != null ? i.live.confirmedAt : null;
  // The most recent location-confirmed region: from this session, or saved from before.
  const fromLocation = liveAt != null && (!i.cached || liveAt >= i.cached.at)
    ? { region: i.live!.region!, at: liveAt, live: true }
    : i.cached ? { region: i.cached.region, at: i.cached.at, live: false } : null;

  let region: string | null = null, basis: SosBasis = "none", locationAt: number | null = null;
  // A manual choice wins until location confirms a region again after it.
  if (i.manual && (!fromLocation || i.manual.at > fromLocation.at)) {
    region = i.manual.region; basis = "manual"; locationAt = fromLocation?.at ?? null;
  } else if (fromLocation) {
    region = fromLocation.region; locationAt = fromLocation.at;
    basis = fromLocation.live && i.now - fromLocation.at < staleMs ? "location" : "last_known";
  }

  const locationStale = basis !== "manual" && locationAt != null && i.now - locationAt >= staleMs;
  const contacts = contactsFor(i.config, region);
  const cfgRegion = region ? i.config.regions[region] : undefined;
  const numbersVerified = cfgRegion?.lastVerified ?? null;
  const numbersStale = numbersVerified != null && i.now - Date.parse(numbersVerified) > i.config.staleAfterDays * DAY;
  const nearBoundary = i.live?.confidence === "near_boundary";
  const poorGps = i.live?.confidence === "poor_gps";

  // Nothing confirmed yet but we can see we're near the Kurdistan Region boundary: offer both.
  const alternatives = region == null && nearBoundary && (i.live?.candidate === KURDISTAN || i.live?.candidate === IRAQ)
    ? [KURDISTAN, IRAQ].map((r) => ({ region: r, contacts: contactsFor(i.config, r) }))
    : [];

  return {
    region, basis, contacts,
    unconfirmed: region != null && contacts.length === 0,
    locationAt, locationStale, numbersVerified, numbersStale, nearBoundary, poorGps,
    needsChoice: basis === "none" || (i.permission === "denied" && basis !== "manual") || locationStale,
    alternatives,
  };
}

/** Human-friendly age in minutes, for "location confirmed 12 min ago". */
export const minutesAgo = (now: number, at: number) => Math.max(0, Math.round((now - at) / 60_000));
