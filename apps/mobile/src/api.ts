import type { LngLat, ReportCategory } from "@darbna/core";
import { getInstallId } from "./storage";
import type { Place, PublicReport, RouteResult, ServerConfig } from "./types";
import { ApiError } from "./apiError";
import { directApi } from "./apiDirect";

export { ApiError, type ApiErrorCode } from "./apiError";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080").replace(/\/$/, "");
/** "direct": no Darbna server — call public OSM services from the device (web preview). */
export const DIRECT_MODE = API_URL === "direct";

async function request<T>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number; install?: boolean } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.install) headers["x-darbna-install"] = await getInstallId();
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(ctrl.signal.aborted ? "timeout" : "offline");
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new ApiError(data.error ?? (res.status >= 500 ? "server" : "error"), res.status, data.retryAfterS);
  return data as T;
}

const serverApi = {
  config: () => request<ServerConfig>("/v1/config", { timeoutMs: 6000 }),

  search: (q: string, lang: string, near?: LngLat, _opts: { remote?: boolean } = {}) =>
    request<{ results: (Place & { score: number })[]; partial: boolean }>(
      `/v1/search?q=${encodeURIComponent(q)}&lang=${lang}${near ? `&near=${near[0].toFixed(3)},${near[1].toFixed(3)}` : ""}`,
      { timeoutMs: 8000 },
    ),

  reverse: (at: LngLat, lang: string) =>
    request<{ result: Place | null }>(`/v1/reverse?at=${at[0].toFixed(6)},${at[1].toFixed(6)}&lang=${lang}`, { timeoutMs: 6000 }),

  route: (origin: LngLat, destination: LngLat, opts: { heading?: number; alternatives?: boolean; avoidReportIds?: string[] } = {}) =>
    request<RouteResult>("/v1/route", {
      method: "POST",
      body: { origin, destination, heading: opts.heading, alternatives: opts.alternatives ?? true, avoidReportIds: opts.avoidReportIds ?? [] },
      timeoutMs: 15_000,
    }),

  reports: (bbox: [number, number, number, number]) =>
    request<{ reports: PublicReport[]; serverTime: string }>(`/v1/reports?bbox=${bbox.map((n) => n.toFixed(4)).join(",")}`, { timeoutMs: 8000 }),

  createReport: (category: ReportCategory, coord: LngLat, heading?: number) =>
    request<{ report: PublicReport; duplicate: boolean }>("/v1/reports", { method: "POST", body: { category, coord, heading }, install: true }),

  vote: (id: string, vote: "confirm" | "gone" | "flag") =>
    request<{ report: PublicReport }>(`/v1/reports/${id}/votes`, { method: "POST", body: { vote }, install: true }),

  deleteMe: () => request<{ deleted: unknown }>("/v1/me", { method: "DELETE", install: true }),
};

export const api: typeof serverApi = DIRECT_MODE ? (directApi as unknown as typeof serverApi) : serverApi;
