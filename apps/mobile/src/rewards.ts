import { getInstallId } from "./storage";
import { ApiError } from "./apiError";
import type { RewardContactMethod } from "@darbna/core";

export type RewardKind = "mobile_credit" | "voucher" | "physical_gift" | "oil_change" | "car" | "guaranteed_reward";
export interface RewardOffer { id: string; milestone: number; kind: RewardKind; weight: number; title: Record<string, string>; detail: Record<string, string>; revision: number; available: number }
export interface RewardDraw { id: string; milestone: number; title: Record<string,string>; detail: Record<string,string>; termsVersion: string; terms: Record<string,string>; createdAt: string }
export interface RewardClaim { id: string; milestone: number; title: Record<string,string>; status: "pending" | "approved" | "sent" | "rejected"; note: string | null; createdAt: string }
export interface RewardsView { enabled: boolean; termsVersion: string; poolRevision: number; terms: Record<string,string>; points: number; offers: RewardOffer[]; draws: RewardDraw[]; claims: RewardClaim[] }
const URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? "";
async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!URL || !KEY) throw new ApiError("unsupported");
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const headers: Record<string,string> = { apikey: KEY, "content-type": "application/json" };
    if (KEY.startsWith("eyJ")) headers.authorization = `Bearer ${KEY}`;
    const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args), signal: ctrl.signal });
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.code === "P0001" ? body.message : "unavailable");
    return body;
  } catch (e) { throw e instanceof ApiError ? e : new ApiError(ctrl.signal.aborted ? "timeout" : "offline"); }
  finally { clearTimeout(timer); }
}
export const getRewards = async () => call<RewardsView>("darbna_rewards", { install: await getInstallId() });
export async function drawReward(milestone: number, termsVersion: string, poolRevision: number) {
  return call<RewardDraw>("darbna_reward_draw", { install: await getInstallId(), milestone, terms_version: termsVersion, pool_revision: poolRevision });
}
export async function claimReward(draw: RewardDraw, method: RewardContactMethod, contact: string) {
  return call<{ id: string }>("darbna_reward_claim", { install: await getInstallId(), draw_id: draw.id, contact_method: method, contact_value: contact, terms_version: draw.termsVersion });
}
