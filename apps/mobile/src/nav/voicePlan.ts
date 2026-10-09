/**
 * Turns a guidance prompt into the list of recorded clips that say it (assets/voice/phrases.json),
 * e.g. "in 200 m, turn right, then turn left" → ["d_200m", "mv_right", "then", "mv_left"].
 * Street names are never spoken; they stay on screen. Pure, so it's unit-tested.
 */
import type { RouteStep } from "@darbna/core";
import phrases from "../../assets/voice/phrases.json";

const M: number[] = phrases.distancesM;
const KM: number[] = phrases.distancesKm;

/** Clip key for the spoken distance closest to `m` (compared on a log scale, so 12 km → 12 km, 13.7 km → 15 km). */
export function distanceKey(m: number): string {
  const opts: { key: string; v: number }[] = [
    ...M.map((v) => ({ key: `d_${v}m`, v })),
    ...KM.map((v) => ({ key: `d_${String(v).replace(".", "_")}km`, v: v * 1000 })),
  ];
  const x = Math.max(M[0], m);
  let best = opts[0];
  for (const o of opts) if (Math.abs(Math.log(o.v / x)) < Math.abs(Math.log(best.v / x))) best = o;
  return best.key;
}

export function actionKey(step: RouteStep): string {
  if (step.kind === "roundabout") {
    return step.roundaboutExit && step.roundaboutExit >= 1 && step.roundaboutExit <= 6 ? `mv_roundabout_${step.roundaboutExit}` : "mv_roundabout_plain";
  }
  return `mv_${step.kind}`;
}

/** A maneuver prompt: optional distance, the action, and an optional "then …". */
export function instructionClips(step: RouteStep, distanceM: number | null, then?: RouteStep | null): string[] {
  const out: string[] = [];
  // A stop on the way is said like an arrival ("you've arrived" / "… your destination").
  if (step.kind === "arrive" || step.kind === "waypoint") {
    if (distanceM !== null && distanceM >= 50) out.push(distanceKey(distanceM), "arrive_soon");
    else out.push("mv_arrive");
    return out;
  }
  if (distanceM !== null) out.push(distanceKey(distanceM));
  out.push(actionKey(step));
  if (then && then.kind !== "arrive") out.push("then", actionKey(then));
  return out;
}

export function hasClip(lang: "ar" | "en", key: string): boolean {
  return key in (phrases.phrases as Record<string, Record<string, string>>)[lang];
}
