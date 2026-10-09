import { createHmac, timingSafeEqual } from "node:crypto";
import {
  boxAround, haversine, projectOnSegment, REPORT_CATEGORIES,
  type LngLat, type Route,
} from "@darbna/core";
import type { Config } from "./config";
import type { Db } from "./db";
import { HttpError, IpLimiter, json, lngLat, oneOf, optNumber, readJson, Router, UUID_RE, type Ctx, type Handler } from "./http";
import { GeocoderUnavailable, type GeocodingProvider } from "./providers/geocoding";
import { RoutingError, type RoutingProvider } from "./providers/routing";
import { ReportService, type PublicReport } from "./reports";
import { SearchService } from "./search";
import { StyleCache } from "./style";

export interface Deps {
  config: Config;
  db: Db;
  routing: RoutingProvider;
  geocoder: GeocodingProvider;
  log?: (line: Record<string, unknown>) => void;
}

const LANGS = ["ar", "ckb", "en"] as const;

function parsePair(v: string | null, field: string): LngLat | undefined {
  if (!v) return undefined;
  const parts = v.split(",").map(Number);
  return lngLat(parts, field);
}

export function installHasher(secret: string) {
  return (installId: string) => createHmac("sha256", secret).update(installId).digest("base64url");
}

function minDistanceToLine(p: LngLat, line: LngLat[], step = 1): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += step) {
    const d = projectOnSegment(p, line[i], line[Math.min(i + step, line.length - 1)]).distance;
    if (d < best) best = d;
  }
  return best;
}

function bboxOf(points: LngLat[], padDeg: number) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [x, y] of points) {
    minLng = Math.min(minLng, x); maxLng = Math.max(maxLng, x);
    minLat = Math.min(minLat, y); maxLat = Math.max(maxLat, y);
  }
  return { minLng: minLng - padDeg, minLat: minLat - padDeg, maxLng: maxLng + padDeg, maxLat: maxLat + padDeg };
}

export function buildApp(deps: Deps) {
  const { config, db, routing, geocoder } = deps;
  const log = deps.log ?? ((l) => console.log(JSON.stringify(l)));
  const hashInstall = installHasher(config.installHashSecret);
  const reports = new ReportService(db, config.sampleData);
  const search = new SearchService(db, geocoder);
  const ipLimiter = new IpLimiter(240);
  const styles = new StyleCache();
  const router = new Router();

  const requireInstall = (ctx: Ctx): string => {
    const id = ctx.req.headers.get("x-darbna-install") ?? "";
    if (!UUID_RE.test(id)) throw new HttpError(401, "install_id_required");
    return hashInstall(id.toLowerCase());
  };
  const requireAdmin = (ctx: Ctx): string => {
    const tok = (ctx.req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(tok), b = Buffer.from(config.adminToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "unauthorized");
    return ctx.req.headers.get("x-moderator") ?? "admin";
  };

  // ------------------------------------------------------------ meta
  router.add("GET", "/healthz", async () => {
    let dbOk = false;
    try { await db`SELECT 1`; dbOk = true; } catch {}
    return json({ ok: dbOk, db: dbOk }, dbOk ? 200 : 503);
  });

  // Lightened copies of the upstream styles (no 3D buildings etc.) — smoother on low-end devices.
  router.add("GET", "/v1/style/:variant", async (ctx) => {
    const variant = oneOf(ctx.params.variant, ["day", "night"] as const, "variant");
    try {
      // Same upstream for day and night (e.g. OpenFreeMap) → recolour it for night ourselves.
      const recolour = variant === "night" && config.map.styleNight === config.map.styleDay;
      const body = await styles.get(variant === "day" ? config.map.styleDay : config.map.styleNight, recolour);
      return new Response(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
    } catch (e) {
      log({ level: "warn", style: variant, url: variant === "day" ? config.map.styleDay : config.map.styleNight, err: (e as Error).message });
      throw new HttpError(503, "style_unavailable");
    }
  });

  router.add("GET", "/v1/config", (ctx) =>
    json({
      map: config.map.lighten
        ? { styleDay: `${ctx.url.origin}/v1/style/day`, styleNight: `${ctx.url.origin}/v1/style/night`, attribution: config.map.attribution }
        : { styleDay: config.map.styleDay, styleNight: config.map.styleNight, attribution: config.map.attribution },
      routing: { provider: routing.name, traffic: false, avoidsVerifiedClosures: routing.supportsExclusions },
      // Honest capability flags: the app only offers what is true here.
      features: { offlineMapDisplay: false, offlineRouting: false, liveTraffic: false },
      sampleData: config.sampleData,
      reportCategories: REPORT_CATEGORIES,
    }, 200, { "cache-control": "public, max-age=300" }),
  );

  // ------------------------------------------------------------ search
  router.add("GET", "/v1/search", async (ctx) => {
    const q = (ctx.url.searchParams.get("q") ?? "").trim();
    if (!q) return json({ results: [], partial: false });
    if (q.length > 120) throw new HttpError(400, "query_too_long");
    const lang = oneOf(ctx.url.searchParams.get("lang") ?? "ar", LANGS, "lang");
    const near = parsePair(ctx.url.searchParams.get("near"), "near");
    const limit = Math.min(15, Math.max(1, Number(ctx.url.searchParams.get("limit") ?? 10) || 10));
    return json(await search.search(q, lang, near, limit));
  });

  router.add("GET", "/v1/reverse", async (ctx) => {
    const at = parsePair(ctx.url.searchParams.get("at"), "at");
    if (!at) throw new HttpError(400, "at_required");
    const lang = oneOf(ctx.url.searchParams.get("lang") ?? "ar", LANGS, "lang");
    try {
      return json({ result: await geocoder.reverse(at, lang) });
    } catch (e) {
      if (e instanceof GeocoderUnavailable) return json({ result: null, partial: true });
      throw e;
    }
  });

  // ------------------------------------------------------------ routing
  router.add("POST", "/v1/route", async (ctx) => {
    const body = await ctx.json<{ origin: unknown; destination: unknown; heading?: unknown; alternatives?: unknown; avoidReportIds?: unknown; travel?: unknown; via?: unknown; avoid?: unknown }>();
    const travel = body.travel === "walk" ? "walk" : "car";
    const via = Array.isArray(body.via) ? body.via.slice(0, 3).map((v, i) => lngLat(v, `via[${i}]`)) : [];
    const av = (body.avoid && typeof body.avoid === "object" ? body.avoid : {}) as Record<string, unknown>;
    const avoid = { highways: av.highways === true, unpaved: av.unpaved === true };
    const origin = lngLat(body.origin, "origin");
    const destination = lngLat(body.destination, "destination");
    const heading = optNumber(body.heading, "heading", 0, 360);
    if (haversine(origin, destination) < 25) throw new HttpError(422, "too_close");
    const avoidIds = Array.isArray(body.avoidReportIds)
      ? body.avoidReportIds.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)).slice(0, 20)
      : [];

    const area = bboxOf([origin, destination], 0.15);
    const nearby = await reports.inBBox(area, 800);
    const chosen = new Set(avoidIds);
    const toAvoid = nearby.filter((r) => r.treatment === "avoid" || (chosen.has(r.id) && r.treatment !== "display"));
    // Road closures, potholes etc. are about driving: walkers aren't routed around them.
    const excludePolygons = routing.supportsExclusions && travel === "car"
      ? toAvoid.map((r) => boxAround(r.coord, r.category === "closure" || r.category === "flooding" ? 60 : 35))
      : [];

    let routes: Route[];
    try {
      routes = await routing.route({ origin, destination, originHeading: heading, alternatives: body.alternatives !== false, excludePolygons, travel, via, avoid });
    } catch (e) {
      if (!(e instanceof RoutingError)) throw e;
      // If exclusions made the trip impossible, fall back to an unrestricted route and say so.
      if (e.code === "no_route" && excludePolygons.length) {
        routes = await routing.route({ origin, destination, originHeading: heading, alternatives: false, excludePolygons: [], travel, via, avoid });
        return json(decorate(routes, nearby, [], true));
      }
      const map = { no_route: 422, off_network: 422, unavailable: 503, timeout: 504 } as const;
      throw new HttpError(map[e.code], e.code);
    }
    return json(decorate(routes, nearby, excludePolygons.length ? toAvoid.map((r) => r.id) : [], false));
  });

  function decorate(routes: Route[], nearby: PublicReport[], avoided: string[], avoidFailed: boolean) {
    const advisories = new Map<string, PublicReport>();
    const out = routes.map((r) => {
      const step = r.geometry.length > 4000 ? 3 : 1;
      const onRoute = nearby.filter((rep) => !avoided.includes(rep.id) && minDistanceToLine(rep.coord, r.geometry, step) < 60);
      onRoute.forEach((rep) => advisories.set(rep.id, rep));
      return { ...r, avoidedClosureIds: avoided, reportIdsOnRoute: onRoute.map((x) => x.id) };
    });
    return {
      routes: out,
      reports: [...advisories.values()],
      avoidance: { requested: avoided.length > 0 || avoidFailed, honoured: !avoidFailed, providerSupportsIt: routing.supportsExclusions },
      generatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------ reports
  router.add("GET", "/v1/reports", async (ctx) => {
    const raw = (ctx.url.searchParams.get("bbox") ?? "").split(",").map(Number);
    if (raw.length !== 4 || raw.some((n) => !Number.isFinite(n))) throw new HttpError(400, "bbox_required");
    const [minLng, minLat, maxLng, maxLat] = raw;
    if (maxLng - minLng > 2 || maxLat - minLat > 2 || maxLng <= minLng || maxLat <= minLat) throw new HttpError(400, "bbox_too_large");
    return json({ reports: await reports.inBBox({ minLng, minLat, maxLng, maxLat }), serverTime: new Date().toISOString() });
  });

  router.add("POST", "/v1/reports", async (ctx) => {
    const hash = requireInstall(ctx);
    const b = await ctx.json<{ category: unknown; coord: unknown; heading?: unknown }>();
    const category = oneOf(b.category, REPORT_CATEGORIES, "category");
    const coord = lngLat(b.coord, "coord");
    const heading = optNumber(b.heading, "heading", 0, 359.999);
    const res = await reports.create({ category, coord, heading: heading === undefined ? undefined : Math.floor(heading), reporterHash: hash });
    return json(res, res.duplicate ? 200 : 201);
  });

  router.add("POST", "/v1/reports/:id/votes", async (ctx) => {
    const hash = requireInstall(ctx);
    if (!UUID_RE.test(ctx.params.id)) throw new HttpError(404, "not_found");
    const b = await ctx.json<{ vote: unknown }>();
    const vote = oneOf(b.vote, ["confirm", "gone", "flag"] as const, "vote");
    return json({ report: await reports.vote(ctx.params.id, hash, vote) });
  });

  router.add("DELETE", "/v1/me", async (ctx) => {
    const hash = requireInstall(ctx);
    return json({ deleted: await reports.deleteInstallData(hash) });
  });

  // ------------------------------------------------------------ admin / moderation
  router.add("GET", "/v1/admin/reports", async (ctx) => {
    requireAdmin(ctx);
    const status = oneOf(ctx.url.searchParams.get("status") ?? "hidden", ["hidden", "active"] as const, "status");
    return json({ reports: await reports.moderationQueue(status) });
  });
  router.add("POST", "/v1/admin/reports/:id/moderate", async (ctx) => {
    const actor = requireAdmin(ctx);
    if (!UUID_RE.test(ctx.params.id)) throw new HttpError(404, "not_found");
    const b = await ctx.json<{ action: unknown; note?: unknown }>();
    await reports.moderate(ctx.params.id, oneOf(b.action, ["restore", "remove"] as const, "action"), actor, typeof b.note === "string" ? b.note.slice(0, 500) : undefined);
    return json({ ok: true });
  });
  router.add("POST", "/v1/admin/official-reports", async (ctx) => {
    const actor = requireAdmin(ctx);
    const b = await ctx.json<{ category: unknown; coord: unknown; expiresAt: unknown; officialRef: unknown }>();
    const category = oneOf(b.category, REPORT_CATEGORIES, "category");
    const coord = lngLat(b.coord, "coord");
    const exp = new Date(String(b.expiresAt));
    if (Number.isNaN(exp.getTime()) || exp <= new Date()) throw new HttpError(400, "invalid_field", "expiresAt must be a future ISO date");
    if (typeof b.officialRef !== "string" || b.officialRef.trim().length < 5) throw new HttpError(400, "invalid_field", "officialRef (source of the official notice) is required");
    return json({ report: await reports.createOfficial({ category, coord, expiresAt: exp, officialRef: b.officialRef.trim().slice(0, 300), actor }) }, 201);
  });

  // ------------------------------------------------------------ dispatch
  async function fetchHandler(req: Request, ip: string): Promise<Response> {
    const started = performance.now();
    const url = new URL(req.url);
    let res: Response;
    const cors: Record<string, string> = {};
    const origin = req.headers.get("origin");
    if (origin && config.corsOrigins.includes(origin)) {
      cors["access-control-allow-origin"] = origin;
      cors["vary"] = "origin";
    }
    try {
      if (req.method === "OPTIONS") {
        res = new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "GET,POST,DELETE", "access-control-allow-headers": "content-type,x-darbna-install,authorization" } });
      } else {
        const ipKey = createHmac("sha256", config.installHashSecret).update(ip).digest("base64url").slice(0, 16);
        const cost = url.pathname === "/v1/route" ? 4 : 1;
        if (!ipLimiter.hit(ipKey, cost)) throw new HttpError(429, "rate_limited", undefined, { retryAfterS: 60 });
        const m = router.match(req.method, url.pathname);
        if (m === null) throw new HttpError(404, "not_found");
        if (m === "method") throw new HttpError(405, "method_not_allowed");
        const ctx: Ctx = { req, url, params: m.handler ? m.params : {}, ip, json: () => readJson(req) };
        res = await (m.handler as Handler)(ctx);
      }
    } catch (e) {
      if (e instanceof HttpError) {
        res = json({ error: e.code, message: e.message, ...e.extra }, e.status, e.status === 429 && e.extra?.retryAfterS ? { "retry-after": String(e.extra.retryAfterS) } : {});
      } else {
        log({ level: "error", path: url.pathname, err: (e as Error).message });
        res = json({ error: "internal" }, 500);
      }
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    // Privacy: log path and status only — never query strings or bodies (they contain coordinates).
    log({ level: "info", m: req.method, path: url.pathname.replace(UUID_RE_G, ":id"), status: res.status, ms: Math.round(performance.now() - started) });
    return res;
  }

  return { fetch: fetchHandler, reports, search };
}

const UUID_RE_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
