/**
 * The link between the phone screen (MainScreen) and the CarPlay screen. There is one Darbna:
 * the phone's guidance engine, voice, rerouting and reports keep running; CarPlay only shows them
 * and sends the driver's choices back through the same functions the phone buttons call.
 */
import type { AheadReport, GuidanceState, LocationFix } from "@darbna/core";
import type { Place, PublicReport } from "../types";

export interface CarActions {
  /** Pick a destination and calculate routes (the phone's "Directions"). */
  planTo(place: Place): void;
  /** Start the trip on the chosen route. */
  start(routeIdx: number): void;
  /** End the trip / leave the route preview. */
  end(): void;
}

export interface CarLive {
  fix: LocationFix | null;
  guidance: GuidanceState | null;
  /** First report ahead on the route that warns drivers (same as the phone banner). */
  ahead: AheadReport<PublicReport> | null;
  styleUrl: string;
  demo: boolean;
}

let actions: CarActions | null = null;
let live: CarLive = { fix: null, guidance: null, ahead: null, styleUrl: "", demo: false };
const subs = new Set<() => void>();

export const carBridge = {
  setActions(a: CarActions) { actions = a; },
  actions(): CarActions | null { return actions; },
  publish(patch: Partial<CarLive>) {
    live = { ...live, ...patch };
    subs.forEach((f) => f());
  },
  live(): CarLive { return live; },
  subscribe(f: () => void): () => void {
    subs.add(f);
    return () => { subs.delete(f); };
  },
};
