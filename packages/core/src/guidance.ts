import { angleDiff, bearing, cumulativeDistances, haversine, LngLat, projectOnSegment } from "./geo";
import type { Route, RouteStep } from "./route";

export interface LocationFix {
  coord: LngLat;
  /** Horizontal accuracy radius in metres (68% confidence, as reported by the OS). */
  accuracyM: number;
  speedMps?: number | null;
  headingDeg?: number | null;
  timestamp: number; // ms
}

export type GuidanceStatus = "on_route" | "off_route" | "gps_weak" | "gps_lost" | "arrived";
export type AnnouncementStage = "far" | "near" | "now";

export interface Announcement {
  step: RouteStep;
  stage: AnnouncementStage;
  distanceM: number;
  /** The maneuver after this one, when it comes quickly ("then turn left"). */
  then?: RouteStep;
}

export interface GuidanceState {
  status: GuidanceStatus;
  snapped: LngLat | null;
  distanceAlongM: number;
  remainingM: number;
  remainingS: number;
  nextStep: RouteStep | null;
  distanceToNextM: number;
  offRouteDistanceM: number;
  /** True exactly once per off-route episode (and again after the cooldown if still off). */
  shouldReroute: boolean;
  announcement: Announcement | null;
  lastFixAt: number | null;
}

export interface GuidanceOptions {
  /** Fixes worse than this are shown but never trigger off-route. */
  maxUsableAccuracyM: number;
  offRouteBaseM: number;
  offRouteMaxM: number;
  offRouteConsecutive: number;
  offRouteMinMs: number;
  wrongWayMs: number;
  rerouteCooldownMs: number;
  arrivalRadiusM: number;
  gpsLostMs: number;
  /** On foot: prompts much closer to the turn, tighter off-route, no wrong-way rule. */
  walking?: boolean;
}

/** Overrides for walking trips. */
export const WALKING_GUIDANCE_OPTIONS: Partial<GuidanceOptions> = {
  walking: true, offRouteBaseM: 25, offRouteMaxM: 60, offRouteConsecutive: 3, offRouteMinMs: 5000,
  wrongWayMs: Number.POSITIVE_INFINITY, arrivalRadiusM: 20,
};

export const DEFAULT_GUIDANCE_OPTIONS: GuidanceOptions = {
  maxUsableAccuracyM: 50,
  offRouteBaseM: 35,
  offRouteMaxM: 80,
  offRouteConsecutive: 3,
  offRouteMinMs: 4000,
  wrongWayMs: 10000,
  rerouteCooldownMs: 15000,
  arrivalRadiusM: 30,
  gpsLostMs: 10000,
};

/** Distances (m) at which the far / near / now prompts fire, by speed. */
export function announcementDistances(speedMps: number, walking = false): { far: number; near: number; now: number } {
  if (walking) return { far: 200, near: 50, now: 12 };
  if (speedMps > 22) return { far: 1500, near: 500, now: Math.max(60, speedMps * 4) }; // > ~80 km/h
  if (speedMps > 11) return { far: 800, near: 250, now: Math.max(40, speedMps * 3.5) }; // > ~40 km/h
  return { far: 400, near: 120, now: 35 };
}

/**
 * Pure, deterministic guidance state machine. Feed it location fixes; it tells you
 * where you are on the route, what to say, and when to request a new route.
 * It does no I/O, so it keeps working when the network does not.
 */
export class GuidanceEngine {
  readonly route: Route;
  private readonly opt: GuidanceOptions;
  private readonly cum: number[];
  private readonly stepStart: number[];
  private segIndex = 0;
  private offCount = 0;
  private offSince: number | null = null;
  /** Missed-turn fast path: good GPS, moving, and getting further from the route fix after fix. */
  private awayCount = 0;
  private prevOff = 0;
  private wrongWaySince: number | null = null;
  private lastRerouteAt = -Infinity;
  private rerouteFiredThisEpisode = false;
  private announced = new Map<number, Set<AnnouncementStage>>();
  private arrived = false;
  private last: GuidanceState;

  constructor(route: Route, options: Partial<GuidanceOptions> = {}) {
    if (route.geometry.length < 2) throw new Error("route geometry needs ≥ 2 points");
    this.route = route;
    this.opt = { ...DEFAULT_GUIDANCE_OPTIONS, ...options };
    this.cum = cumulativeDistances(route.geometry);
    this.stepStart = route.steps.map((s) => this.cum[Math.min(s.shapeIndex, this.cum.length - 1)]);
    // The depart prompt is spoken by the UI on start, so don't repeat it.
    if (route.steps[0]) this.announced.set(0, new Set(["far", "near", "now"]));
    this.last = this.blank();
  }

  get totalM(): number {
    return this.cum[this.cum.length - 1];
  }

  get state(): GuidanceState {
    return this.last;
  }

  private blank(): GuidanceState {
    return {
      status: "gps_weak", snapped: null, distanceAlongM: 0,
      remainingM: this.totalM, remainingS: this.route.durationS,
      nextStep: this.route.steps[1] ?? null, distanceToNextM: this.stepStart[1] ?? this.totalM,
      offRouteDistanceM: 0, shouldReroute: false, announcement: null, lastFixAt: null,
    };
  }

  /** Call periodically (e.g. every second) so a silent GPS becomes visible. */
  tick(now: number): GuidanceState {
    if (this.arrived) return this.last;
    if (this.last.lastFixAt !== null && now - this.last.lastFixAt > this.opt.gpsLostMs && this.last.status !== "gps_lost") {
      this.last = { ...this.last, status: "gps_lost", shouldReroute: false, announcement: null };
    }
    return this.last;
  }

  /** The caller tells the engine a reroute request failed (e.g. offline) so it can retry later. */
  rerouteFailed(now: number): void {
    this.lastRerouteAt = now;
    this.rerouteFiredThisEpisode = false;
  }

  private snap(p: LngLat, heading: number | null, speed: number) {
    const g = this.route.geometry;
    const useHeading = heading !== null && speed > 3;
    const score = (i: number) => {
      const pr = projectOnSegment(p, g[i], g[i + 1]);
      let s = pr.distance;
      if (useHeading && haversine(g[i], g[i + 1]) > 5) {
        const segB = bearing(g[i], g[i + 1]);
        if (angleDiff(segB, heading!) > 100) s += 40; // likely the opposite carriageway / later overlap
      }
      // Mild bias against jumping far ahead along the route.
      const ahead = this.cum[i] - this.cum[this.segIndex];
      if (ahead > 300) s += Math.min(30, ahead / 100);
      return { i, pr, s };
    };
    let best: ReturnType<typeof score> | null = null;
    const from = Math.max(0, this.segIndex - 2);
    const to = Math.min(g.length - 2, this.segIndex + 60);
    for (let i = from; i <= to; i++) {
      const c = score(i);
      if (!best || c.s < best.s) best = c;
    }
    if (!best || best.pr.distance > 60) {
      // Global fallback (e.g. after a long tunnel or GPS gap).
      for (let i = 0; i < g.length - 1; i++) {
        const c = score(i);
        if (!best || c.s < best.s) best = c;
      }
    }
    return best!;
  }

  private stepIndexAt(along: number): number {
    let idx = 0;
    for (let i = 0; i < this.stepStart.length; i++) if (this.stepStart[i] <= along + 1) idx = i;
    return idx;
  }

  private remainingTime(along: number): number {
    const steps = this.route.steps;
    if (!steps.length) return this.route.durationS * Math.max(0, 1 - along / this.totalM);
    const i = this.stepIndexAt(along);
    const stepLen = (this.stepStart[i + 1] ?? this.totalM) - this.stepStart[i];
    const frac = stepLen > 0 ? Math.min(1, (along - this.stepStart[i]) / stepLen) : 1;
    let t = steps[i].durationS * (1 - frac);
    for (let j = i + 1; j < steps.length; j++) t += steps[j].durationS;
    return Math.max(0, t);
  }

  update(fix: LocationFix): GuidanceState {
    if (this.arrived) return this.last;
    const now = fix.timestamp;
    const speed = fix.speedMps && fix.speedMps > 0 ? fix.speedMps : 0;
    const heading = fix.headingDeg !== undefined && fix.headingDeg !== null && fix.headingDeg >= 0 ? fix.headingDeg : null;
    const best = this.snap(fix.coord, heading, speed);
    const offDist = best.pr.distance;
    const along = this.cum[best.i] + haversine(this.route.geometry[best.i], best.pr.point);
    const usable = fix.accuracyM <= this.opt.maxUsableAccuracyM;

    // ---- arrival ----
    const dest = this.route.geometry[this.route.geometry.length - 1];
    const toDest = haversine(fix.coord, dest);
    const arrivalR = Math.min(50, Math.max(this.opt.arrivalRadiusM, fix.accuracyM * 0.8));
    if (usable && (toDest <= arrivalR || (this.totalM - along <= 20 && offDist < 40))) {
      this.arrived = true;
      const last = this.route.steps[this.route.steps.length - 1] ?? null;
      this.last = {
        status: "arrived", snapped: dest, distanceAlongM: this.totalM, remainingM: 0, remainingS: 0,
        nextStep: last, distanceToNextM: 0, offRouteDistanceM: 0, shouldReroute: false,
        announcement: last ? { step: last, stage: "now", distanceM: 0 } : null, lastFixAt: now,
      };
      return this.last;
    }

    // ---- off-route & wrong-way detection (only with usable accuracy) ----
    let status: GuidanceStatus = usable ? "on_route" : "gps_weak";
    if (usable) {
      const threshold = Math.min(this.opt.offRouteMaxM, Math.max(this.opt.offRouteBaseM, fix.accuracyM * 1.5));
      if (offDist > threshold) {
        this.offCount++;
        this.offSince ??= now;
      } else {
        this.offCount = 0;
        this.offSince = null;
      }
      // Missed a turn: with a precise fix you're clearly leaving the route, so don't wait for
      // the slower rule above (at 100 km/h that would be 150+ m down the wrong road).
      const awayM = this.opt.walking ? 18 : 25, awaySpeed = this.opt.walking ? 0.6 : 4;
      if (fix.accuracyM <= 15 && speed > awaySpeed && offDist > awayM && offDist > this.prevOff + 1) this.awayCount++;
      else if (offDist <= awayM) this.awayCount = 0;
      this.prevOff = offDist;
      const g = this.route.geometry;
      if (heading !== null && speed > 5 && offDist < 40 && haversine(g[best.i], g[best.i + 1]) > 5) {
        const wrong = angleDiff(bearing(g[best.i], g[best.i + 1]), heading) > 150;
        if (wrong) this.wrongWaySince ??= now; else this.wrongWaySince = null;
      } else if (speed > 5) {
        this.wrongWaySince = null;
      }
      const offRoute =
        this.awayCount >= (this.opt.walking ? 3 : 2) ||
        (this.offCount >= this.opt.offRouteConsecutive && this.offSince !== null && now - this.offSince >= this.opt.offRouteMinMs) ||
        (this.wrongWaySince !== null && now - this.wrongWaySince >= this.opt.wrongWayMs);
      if (offRoute) status = "off_route";
    }

    let shouldReroute = false;
    if (status === "off_route") {
      if (!this.rerouteFiredThisEpisode && now - this.lastRerouteAt >= this.opt.rerouteCooldownMs) {
        shouldReroute = true;
        this.rerouteFiredThisEpisode = true;
        this.lastRerouteAt = now;
      }
    } else if (status === "on_route") {
      this.rerouteFiredThisEpisode = false;
    }

    // Only advance progress while confidently on the route; avoids GPS-drift jumps.
    if (status === "on_route") this.segIndex = Math.max(this.segIndex, best.i);
    const progressAlong = status === "on_route" ? along : this.last.distanceAlongM;

    // ---- next maneuver & announcements ----
    const curStep = this.stepIndexAt(progressAlong);
    const nextIdx = Math.min(curStep + 1, this.route.steps.length - 1);
    const nextStep = this.route.steps[nextIdx] ?? null;
    const distToNext = nextStep ? Math.max(0, this.stepStart[nextIdx] - progressAlong) : this.totalM - progressAlong;

    let announcement: Announcement | null = null;
    if (status === "on_route" && nextStep) {
      const d = announcementDistances(speed, this.opt.walking);
      const done = this.announced.get(nextIdx) ?? new Set<AnnouncementStage>();
      let stage: AnnouncementStage | null = null;
      if (distToNext <= d.now && !done.has("now")) stage = "now";
      else if (distToNext <= d.near && distToNext > d.now && !done.has("near")) stage = "near";
      else if (distToNext <= d.far && distToNext > d.near && !done.has("far") && (this.stepStart[nextIdx] - this.stepStart[curStep]) > d.far * 0.6) stage = "far";
      if (stage) {
        // Mark this stage and all earlier ones as done so we never go backwards.
        const order: AnnouncementStage[] = ["far", "near", "now"];
        for (const s of order.slice(0, order.indexOf(stage) + 1)) done.add(s);
        this.announced.set(nextIdx, done);
        const after = this.route.steps[nextIdx + 1];
        const gap = after ? this.stepStart[nextIdx + 1] - this.stepStart[nextIdx] : Infinity;
        announcement = { step: nextStep, stage, distanceM: distToNext, then: stage !== "far" && gap < 150 ? after : undefined };
      }
    }

    this.last = {
      status,
      snapped: status === "on_route" ? best.pr.point : null,
      distanceAlongM: progressAlong,
      remainingM: Math.max(0, this.totalM - progressAlong),
      remainingS: this.remainingTime(progressAlong),
      nextStep,
      distanceToNextM: distToNext,
      offRouteDistanceM: offDist,
      shouldReroute,
      announcement,
      lastFixAt: now,
    };
    return this.last;
  }
}
