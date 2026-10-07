import { inIraqBBox, type LngLat } from "@darbna/core";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public extra?: Record<string, unknown>) {
    super(message ?? code);
  }
}

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  ip: string;
  json<T = unknown>(): Promise<T>;
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

const MAX_BODY = 16 * 1024;

export class Router {
  private routes: { method: string; parts: string[]; handler: Handler }[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    const segs = path.split("/").filter(Boolean);
    let methodMismatch = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        if (r.parts[i].startsWith(":")) params[r.parts[i].slice(1)] = decodeURIComponent(segs[i]);
        else if (r.parts[i] !== segs[i]) { ok = false; break; }
      }
      if (!ok) continue;
      if (r.method !== method) { methodMismatch = true; continue; }
      return { handler: r.handler, params };
    }
    return methodMismatch ? "method" : null;
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, "body_too_large");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "body_too_large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

// ---------------------------------------------------------------- validation
export function lngLat(v: unknown, field: string, requireIraq = true): LngLat {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n)))
    throw new HttpError(400, "invalid_coordinate", `${field} must be [lng, lat]`);
  const p: LngLat = [v[0], v[1]];
  if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw new HttpError(400, "invalid_coordinate", `${field} out of range`);
  if (requireIraq && !inIraqBBox(p)) throw new HttpError(422, "outside_service_area", `${field} is outside Iraq`);
  return p;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) throw new HttpError(400, "invalid_field", `${field} must be one of ${allowed.join(",")}`);
  return v as T;
}

export function optNumber(v: unknown, field: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, "invalid_field", `${field} out of range`);
  return v;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- per-IP limiter
/**
 * Fixed-window in-memory limiter, per instance. It protects upstream providers from
 * bursts; the per-install limits on writes are enforced in the database (see reports.ts).
 * IPs are only ever held in memory for the current minute.
 */
export class IpLimiter {
  private windowStart = Date.now();
  private counts = new Map<string, number>();
  constructor(private perMinute: number) {}
  hit(key: string, cost = 1): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now;
      this.counts.clear();
    }
    const n = (this.counts.get(key) ?? 0) + cost;
    this.counts.set(key, n);
    return n <= this.perMinute;
  }
}
