/**
 * Traffic lights learned from Darbna's own drivers.
 *
 * While navigating by car, StopDetector watches for the pattern a red light makes: driving, then
 * standing still at one spot for 10 s – 3 min, then driving on. Each such stop is sent anonymously
 * (a random per-trip id, no account, never the first/last 300 m of a trip). The database
 * (supabase/schema.sql, darbna_signals) only calls a spot a traffic light when many different
 * trips on at least two different days stopped at the same place in the same direction with a
 * typical red-light wait. A one-off jam, a passenger drop-off or a parking manoeuvre never repeats
 * like that, so it never shows up.
 */
import { haversine, type LngLat } from "./geo";

export interface StopEvent {
  lat: number;
  lng: number;
  /** Direction you were driving before stopping, 0–359. */
  heading: number;
  /** How long you stood still, seconds. */
  waitS: number;
}
interface Fix { coord: LngLat; speedMps?: number | null; headingDeg?: number | null; t: number }

const STOP_MPS = 1.0;      // standing still (≈ 3.6 km/h, GPS noise included)
const MOVE_MPS = 4.0;      // driving (≈ 14 km/h)
const MIN_WAIT_S = 10, MAX_WAIT_S = 180;
const MAX_DRIFT_M = 15;    // a stop is one spot, not creeping in a queue
const MIN_DRIVE_M = 150;   // you drove a bit before stopping (not a parking-lot shuffle)
const PRIVACY_M = 300;     // never near where a trip starts or ends

export class StopDetector {
  private last: Fix | null = null;
  private drivenM = 0;          // since the trip started
  private sinceLastStopM = 0;   // driven since the last stop ended
  private heading: number | null = null;
  private stop: { start: number; pts: LngLat[] } | null = null;
  private pending: StopEvent[] = [];

  /** Feed every position while navigating by car. Returns a stop when one has just ended. */
  feed(f: Fix): StopEvent | null {
    const prev = this.last;
    this.last = f;
    if (!prev) return null;
    const dt = (f.t - prev.t) / 1000;
    if (dt <= 0 || dt > 30) { this.stop = null; return null; } // GPS gap: start over
    const d = haversine(prev.coord, f.coord);
    const speed = f.speedMps != null && f.speedMps >= 0 ? f.speedMps : d / dt;
    if (speed >= MOVE_MPS) {
      this.drivenM += d;
      this.sinceLastStopM += d;
      if (f.headingDeg != null && f.headingDeg >= 0) this.heading = f.headingDeg;
      else if (d > 3) this.heading = bearingDeg(prev.coord, f.coord);
      if (this.stop) return this.endStop(f.t);
      return null;
    }
    if (speed <= STOP_MPS) {
      if (!this.stop) {
        if (this.sinceLastStopM < MIN_DRIVE_M || this.heading == null) return null;
        this.stop = { start: f.t, pts: [f.coord] };
      } else {
        this.stop.pts.push(f.coord);
        // Creeping: a queue, not a stop line. Don't count another stop until you have really driven again.
        if (haversine(this.stop.pts[0], f.coord) > MAX_DRIFT_M) { this.stop = null; this.sinceLastStopM = 0; }
      }
    }
    return null;
  }

  private endStop(t: number): StopEvent | null {
    const s = this.stop!;
    this.stop = null;
    const waitS = (t - s.start) / 1000;
    this.sinceLastStopM = 0;
    if (waitS < MIN_WAIT_S || waitS > MAX_WAIT_S || this.drivenM < PRIVACY_M || this.heading == null) return null;
    const lng = s.pts.reduce((a, p) => a + p[0], 0) / s.pts.length;
    const lat = s.pts.reduce((a, p) => a + p[1], 0) / s.pts.length;
    const ev = { lat, lng, heading: Math.round(this.heading) % 360, waitS: Math.round(waitS) };
    this.pending.push(ev);
    return ev;
  }

  /**
   * Stops ready to send. The most recent ones are held back until you have driven another 300 m,
   * and whatever is held when the trip ends is dropped, so the end of a trip is never sent.
   */
  take(): StopEvent[] {
    if (this.sinceLastStopM < PRIVACY_M) {
      const ready = this.pending.slice(0, -1);
      this.pending = this.pending.slice(-1);
      return ready;
    }
    const all = this.pending;
    this.pending = [];
    return all;
  }
}

function bearingDeg(a: LngLat, b: LngLat): number {
  const t = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * t) * Math.cos(b[1] * t);
  const x = Math.cos(a[1] * t) * Math.sin(b[1] * t) - Math.sin(a[1] * t) * Math.cos(b[1] * t) * Math.cos((b[0] - a[0]) * t);
  return ((Math.atan2(y, x) / t) + 360) % 360;
}

/** ~25 m cell of a stop. Must match darbna_private.signal_cell() in supabase/schema.sql. */
export function signalCell(lat: number, lng: number): number {
  return Math.floor(lat / 0.00025) * 1_000_000 + Math.floor(lng / 0.0003);
}

/** A traffic light learned from drivers (darbna_signals). */
export interface LearnedSignal {
  coord: LngLat;
  /** Direction of travel when stopping, 0–7 (× 45°). */
  dir: number;
  trips: number;
  waitS: number;
}

/**
 * Turns learned stop spots into traffic lights to draw:
 *  - A queue at a red light leaves stop spots behind the stop line too. Spots in the same direction
 *    up to 80 m behind another one are the same light: only the front one (the stop line) is kept.
 *  - Spots within 40 m of a traffic light already on the map (OpenStreetMap) are dropped.
 */
export function placeLearnedSignals(learned: LearnedSignal[], known: LngLat[]): LearnedSignal[] {
  const front = learned.filter((s) => !learned.some((o) => {
    if (o === s || o.dir !== s.dir) return false;
    const d = haversine(s.coord, o.coord);
    if (d > 80 || d < 1) return false;
    // Is o ahead of s in the direction of travel (within ±35° of it)?
    const diff = Math.abs(((bearingDeg(s.coord, o.coord) - s.dir * 45 + 540) % 360) - 180);
    return diff <= 35;
  }));
  // Several spots side by side at one line (different lanes): keep one per 25 m.
  const out: LearnedSignal[] = [];
  for (const s of [...front].sort((a, b) => b.trips - a.trips)) {
    if (known.some((k) => haversine(k, s.coord) < 40)) continue;
    if (out.some((o) => o.dir === s.dir && haversine(o.coord, s.coord) < 25)) continue;
    out.push(s);
  }
  return out;
}
