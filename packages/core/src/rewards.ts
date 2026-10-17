import { levelFor } from "./extras";

export type RewardContactMethod = "email" | "phone" | "whatsapp" | "telegram";
export const REWARD_DRAW_UNITS = 20000;
export const PLANNED_REWARD_ODDS = [
  { kind: "voucher", units: 8000 },
  { kind: "oil_change", units: 100 },
  { kind: "car", units: 1 },
  { kind: "mobile_credit", units: 11899 },
] as const;
/** Boundary helper for tests/display only. Production draws are server-generated. */
export function rewardAtBucket(bucket: number): typeof PLANNED_REWARD_ODDS[number]["kind"] {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= REWARD_DRAW_UNITS) throw new Error("bad_bucket");
  let end = 0;
  for (const prize of PLANNED_REWARD_ODDS) { end += prize.units; if (bucket < end) return prize.kind; }
  throw new Error("bad_odds");
}
export function normalizeRewardContact(method: RewardContactMethod, input: string): string | null {
  const value = input.trim();
  if (method === "email") return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null;
  if (method === "phone" || method === "whatsapp") {
    const phone = value.replace(/[\s().-]/g, "");
    return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
  }
  if (method === "telegram") return /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value) ? "@" + value.replace(/^@/, "").toLowerCase() : null;
  return null;
}
export function rewardMilestones(points: number) {
  const { level } = levelFor(points);
  const reached = Math.floor(level / 10) * 10;
  return { level, reached, next: reached + 10 };
}
