export const REPORT_CATEGORIES = [
  "congestion", "crash", "closure", "roadworks", "pothole", "flooding",
  // Iraq specifics: security checkpoints (moving / long wait), speed cameras, fuel stations.
  "checkpoint", "checkpoint_slow", "camera", "fuel_queue", "fuel_closed",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export type ReportSource = "community" | "official";

/** Default lifetime of a fresh report, and the cap a confirmation can extend it to. */
export const REPORT_TTL_MIN: Record<ReportCategory, { initial: number; max: number }> = {
  congestion: { initial: 30, max: 120 },
  crash: { initial: 60, max: 180 },
  closure: { initial: 360, max: 2880 },
  roadworks: { initial: 4320, max: 20160 },
  pothole: { initial: 20160, max: 86400 },
  flooding: { initial: 360, max: 1440 },
  checkpoint: { initial: 120, max: 480 },
  checkpoint_slow: { initial: 60, max: 240 },
  camera: { initial: 43200, max: 525600 },
  fuel_queue: { initial: 90, max: 360 },
  fuel_closed: { initial: 360, max: 1440 },
};

/** Two reports of the same category closer than this are treated as the same event. */
export const DUPLICATE_RADIUS_M: Record<ReportCategory, number> = {
  congestion: 250,
  crash: 150,
  closure: 120,
  roadworks: 150,
  pothole: 40,
  flooding: 150,
  checkpoint: 200,
  checkpoint_slow: 200,
  camera: 80,
  fuel_queue: 80,
  fuel_closed: 80,
};

/** Things a driver should be warned about ahead on the route (banner + chime). */
export const WARN_AHEAD: Partial<Record<ReportCategory, number>> = {
  checkpoint: 800, checkpoint_slow: 1500, camera: 600, crash: 800, closure: 1000, flooding: 800,
};
/** Fuel-station status reports: shown on the map and on the station, never on routes. */
export const FUEL_CATEGORIES: ReportCategory[] = ["fuel_queue", "fuel_closed"];

export interface ReportVoteCounts {
  confirms: number;
  gone: number;
}

/**
 * Confidence in [0,1]. A single community report starts at 0.4; confirmations push it
 * up with diminishing returns; "no longer there" votes pull it down harder (a cleared
 * road is the most common reason a report goes wrong). Age decays it toward expiry.
 */
export function reportConfidence(
  source: ReportSource,
  votes: ReportVoteCounts,
  createdAt: Date,
  expiresAt: Date,
  now: Date = new Date(),
): number {
  if (source === "official") return 1;
  const base = 0.4;
  const up = 1 - Math.exp(-votes.confirms / 2); // 0, .39, .63, .78 ...
  const down = 1 - Math.exp(-votes.gone / 1.2);
  let c = base + (1 - base) * up * 0.9 - down * 0.7;
  const life = expiresAt.getTime() - createdAt.getTime();
  const age = now.getTime() - createdAt.getTime();
  if (life > 0) c *= 1 - 0.4 * Math.min(1, Math.max(0, age / life)); // up to −40% near expiry
  return Math.max(0, Math.min(1, Math.round(c * 100) / 100));
}

/** New expiry after a confirmation: reset the clock from now, never beyond the category cap. */
export function extendExpiry(category: ReportCategory, createdAt: Date, currentExpiry: Date, now: Date = new Date()): Date {
  const ttl = REPORT_TTL_MIN[category];
  const proposed = now.getTime() + ttl.initial * 60_000;
  const cap = createdAt.getTime() + ttl.max * 60_000;
  return new Date(Math.max(currentExpiry.getTime(), Math.min(proposed, cap)));
}

/** A report is hidden from everyone once "gone" votes clearly outweigh confirmations. */
export function shouldAutoHide(votes: ReportVoteCounts): boolean {
  return votes.gone >= 2 && votes.gone >= votes.confirms + 2;
}

export type RoutingTreatment =
  /** Route around it automatically. */
  | "avoid"
  /** Show it on the route and offer the driver an "avoid" option; don't restrict routing. */
  | "advise"
  /** Only show on the map. */
  | "display";

/**
 * Policy: only verified official closures/flooding change routing automatically.
 * Unverified community reports never restrict routing on their own.
 */
export function routingTreatment(category: ReportCategory, source: ReportSource, confidence: number): RoutingTreatment {
  const blocking = category === "closure" || category === "flooding";
  if (blocking && source === "official") return "avoid";
  if (blocking && confidence >= 0.6) return "advise";
  if (category === "crash" || category === "congestion") return confidence >= 0.5 ? "advise" : "display";
  return "display";
}

export type Freshness = "just_now" | "minutes" | "hours" | "days";
export function freshness(createdAt: Date, now: Date = new Date()): { bucket: Freshness; minutes: number } {
  const m = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 60_000));
  const bucket: Freshness = m < 3 ? "just_now" : m < 60 ? "minutes" : m < 1440 ? "hours" : "days";
  return { bucket, minutes: m };
}
