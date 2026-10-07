import {
  DUPLICATE_RADIUS_M, extendExpiry, REPORT_TTL_MIN, reportConfidence, routingTreatment, shouldAutoHide,
  type LngLat, type ReportCategory, type ReportSource, type RoutingTreatment,
} from "@darbna/core";
import type { Db } from "./db";
import { HttpError } from "./http";

export const LIMITS = {
  reportsPer10Min: 3,
  reportsPerHour: 10,
  votesPerHour: 60,
  flagsToHide: 3,
};

export interface ReportRow {
  id: string;
  category: ReportCategory;
  source: ReportSource;
  lat: number;
  lng: number;
  heading: number | null;
  created_at: Date;
  expires_at: Date;
  status: string;
  confirms: number;
  gone: number;
  flags: number;
  official_ref: string | null;
  is_sample: boolean;
  hidden_reason?: string | null;
}

export interface PublicReport {
  id: string;
  category: ReportCategory;
  source: ReportSource;
  verified: boolean;
  coord: LngLat;
  heading: number | null;
  createdAt: string;
  expiresAt: string;
  confirms: number;
  gone: number;
  confidence: number;
  treatment: RoutingTreatment;
  isSample: boolean;
  officialRef?: string;
}

export function toPublic(r: ReportRow, now = new Date()): PublicReport {
  const conf = reportConfidence(r.source, { confirms: r.confirms, gone: r.gone }, r.created_at, r.expires_at, now);
  return {
    id: r.id,
    category: r.category,
    source: r.source,
    verified: r.source === "official",
    coord: [r.lng, r.lat],
    heading: r.heading,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    confirms: r.confirms,
    gone: r.gone,
    confidence: conf,
    treatment: routingTreatment(r.category, r.source, conf),
    isSample: r.is_sample,
    ...(r.official_ref ? { officialRef: r.official_ref } : {}),
  };
}

const COLS = "id, category, source, lat, lng, heading, created_at, expires_at, status, confirms, gone, flags, official_ref, is_sample, hidden_reason";

export class ReportService {
  constructor(private db: Db, private sampleData: boolean) {}

  private async checkRate(hash: string): Promise<void> {
    const [r] = await this.db`
      SELECT count(*) FILTER (WHERE created_at > now() - interval '10 minutes')::int AS m10,
             count(*)::int AS h1
      FROM reports WHERE reporter_hash = ${hash} AND created_at > now() - interval '1 hour'`;
    if (r.m10 >= LIMITS.reportsPer10Min || r.h1 >= LIMITS.reportsPerHour)
      throw new HttpError(429, "rate_limited", "Too many reports", { retryAfterS: r.m10 >= LIMITS.reportsPer10Min ? 600 : 3600 });
  }

  async create(input: { category: ReportCategory; coord: LngLat; heading?: number; reporterHash: string }): Promise<{ report: PublicReport; duplicate: boolean }> {
    await this.checkRate(input.reporterHash);
    const [lng, lat] = input.coord;
    const radius = DUPLICATE_RADIUS_M[input.category];
    const existing = (await this.db.unsafe(
      `SELECT ${COLS} FROM reports
       WHERE status = 'active' AND category = $1 AND expires_at > now()
         AND earth_box(ll_to_earth($2, $3), $4) @> ll_to_earth(lat, lng)
         AND earth_distance(ll_to_earth($2, $3), ll_to_earth(lat, lng)) < $4
       ORDER BY earth_distance(ll_to_earth($2, $3), ll_to_earth(lat, lng)) LIMIT 1`,
      [input.category, lat, lng, radius],
    )) as ReportRow[];
    if (existing.length) {
      const ex = existing[0];
      // Treat a duplicate as a confirmation from this user (ignored if it's their own or already confirmed).
      const updated = await this.vote(ex.id, input.reporterHash, "confirm", { countAsReport: true }).catch((e) => {
        if (e instanceof HttpError && (e.code === "own_report" || e.code === "already_voted")) return toPublic(ex);
        throw e;
      });
      return { report: updated, duplicate: true };
    }
    const ttl = REPORT_TTL_MIN[input.category].initial;
    const [row] = (await this.db.unsafe(
      `INSERT INTO reports (category, source, lat, lng, heading, expires_at, reporter_hash)
       VALUES ($1, 'community', $2, $3, $4, now() + make_interval(mins => $5), $6)
       RETURNING ${COLS}`,
      [input.category, lat, lng, input.heading ?? null, ttl, input.reporterHash],
    )) as ReportRow[];
    return { report: toPublic(row), duplicate: false };
  }

  async vote(id: string, voterHash: string, vote: "confirm" | "gone" | "flag", opt: { countAsReport?: boolean } = {}): Promise<PublicReport> {
    const [rate] = await this.db`SELECT count(*)::int AS n FROM report_votes WHERE voter_hash = ${voterHash} AND created_at > now() - interval '1 hour'`;
    if (rate.n >= LIMITS.votesPerHour) throw new HttpError(429, "rate_limited", "Too many votes", { retryAfterS: 3600 });
    return await this.db.begin(async (tx) => {
      const rows = (await tx.unsafe(`SELECT ${COLS}, reporter_hash FROM reports WHERE id = $1 FOR UPDATE`, [id])) as (ReportRow & { reporter_hash: string | null })[];
      const r = rows[0];
      if (!r || r.status !== "active" || r.expires_at <= new Date()) throw new HttpError(404, "report_not_active");
      if (r.reporter_hash && r.reporter_hash === voterHash) throw new HttpError(409, "own_report");
      const ins = await tx`INSERT INTO report_votes (report_id, voter_hash, vote) VALUES (${id}, ${voterHash}, ${vote}) ON CONFLICT DO NOTHING RETURNING vote`;
      if (!ins.length) throw new HttpError(409, "already_voted");
      let confirms = r.confirms, gone = r.gone, flags = r.flags, expires = r.expires_at;
      if (vote === "confirm" || vote === "gone") {
        // Confirm and "gone" are mutually exclusive per voter: switching replaces the earlier vote.
        const other = vote === "confirm" ? "gone" : "confirm";
        const del = await tx`DELETE FROM report_votes WHERE report_id = ${id} AND voter_hash = ${voterHash} AND vote = ${other} RETURNING vote`;
        if (del.length) other === "confirm" ? confirms-- : gone--;
      }
      if (vote === "confirm") { confirms++; expires = extendExpiry(r.category, r.created_at, r.expires_at); }
      if (vote === "gone") gone++;
      if (vote === "flag") flags++;
      let status = "active", reason: string | null = null;
      if (r.source === "community" && shouldAutoHide({ confirms, gone })) { status = "hidden"; reason = "gone_votes"; }
      if (r.source === "community" && flags >= LIMITS.flagsToHide) { status = "hidden"; reason = "flags"; }
      const [u] = (await tx.unsafe(
        `UPDATE reports SET confirms = $2, gone = $3, flags = $4, expires_at = $5, status = $6, hidden_reason = $7
         WHERE id = $1 RETURNING ${COLS}`,
        [id, confirms, gone, flags, expires, status, reason],
      )) as ReportRow[];
      if (status === "hidden") await tx`INSERT INTO moderation_log (report_id, action, actor) VALUES (${id}, ${"auto_hide_" + reason}, 'system')`;
      void opt;
      return toPublic(u);
    });
  }

  async inBBox(b: { minLng: number; minLat: number; maxLng: number; maxLat: number }, limit = 400): Promise<PublicReport[]> {
    const rows = (await this.db.unsafe(
      `SELECT ${COLS} FROM reports
       WHERE status = 'active' AND expires_at > now()
         AND lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4
         AND ($5::boolean OR NOT is_sample)
       ORDER BY source = 'official' DESC, created_at DESC LIMIT $6`,
      [b.minLat, b.maxLat, b.minLng, b.maxLng, this.sampleData, limit],
    )) as ReportRow[];
    const now = new Date();
    return rows.map((r) => toPublic(r, now));
  }

  async byIds(ids: string[]): Promise<PublicReport[]> {
    if (!ids.length) return [];
    const rows = (await this.db.unsafe(
      `SELECT ${COLS} FROM reports WHERE id = ANY($1::uuid[]) AND status = 'active' AND expires_at > now() AND ($2::boolean OR NOT is_sample)`,
      [ids, this.sampleData],
    )) as ReportRow[];
    return rows.map((r) => toPublic(r));
  }

  /** Expire old reports, unlink reporter/voter hashes, purge history. Safe to run on many instances. */
  async sweep(): Promise<{ expired: number; purged: number }> {
    return await this.db.begin(async (tx) => {
      const [lock] = await tx`SELECT pg_try_advisory_xact_lock(424242) AS ok`;
      if (!lock.ok) return { expired: 0, purged: 0 };
      const ex = await tx`UPDATE reports SET status = 'expired', reporter_hash = NULL WHERE status = 'active' AND expires_at <= now() RETURNING id`;
      await tx`UPDATE reports SET reporter_hash = NULL WHERE status <> 'active' AND reporter_hash IS NOT NULL`;
      await tx`DELETE FROM report_votes v USING reports r WHERE v.report_id = r.id AND r.status IN ('expired','removed') AND r.expires_at < now() - interval '1 day'`;
      const pu = await tx`DELETE FROM reports WHERE status IN ('expired','removed') AND expires_at < now() - interval '30 days' RETURNING id`;
      return { expired: ex.length, purged: pu.length };
    });
  }

  async deleteInstallData(hash: string): Promise<{ reportsUnlinked: number; votesDeleted: number }> {
    return await this.db.begin(async (tx) => {
      const r = await tx`UPDATE reports SET reporter_hash = NULL WHERE reporter_hash = ${hash} RETURNING id`;
      const v = await tx`DELETE FROM report_votes WHERE voter_hash = ${hash} RETURNING report_id`;
      return { reportsUnlinked: r.length, votesDeleted: v.length };
    });
  }

  // ------------------------------------------------------------ moderation
  async moderationQueue(status: "hidden" | "active", limit = 100): Promise<(PublicReport & { status: string; flags: number; hiddenReason: string | null })[]> {
    const rows = (await this.db.unsafe(
      `SELECT ${COLS} FROM reports WHERE status = $1 ${status === "active" ? "AND flags > 0" : ""} ORDER BY created_at DESC LIMIT $2`,
      [status, limit],
    )) as ReportRow[];
    return rows.map((r) => ({ ...toPublic(r), status: r.status, flags: r.flags, hiddenReason: r.hidden_reason ?? null }));
  }

  async moderate(id: string, action: "restore" | "remove", actor: string, note?: string): Promise<void> {
    const res = action === "restore"
      ? await this.db`UPDATE reports SET status = 'active', hidden_reason = NULL, flags = 0 WHERE id = ${id} AND status <> 'expired' RETURNING id`
      : await this.db`UPDATE reports SET status = 'removed', hidden_reason = 'moderator', reporter_hash = NULL WHERE id = ${id} RETURNING id`;
    if (!res.length) throw new HttpError(404, "not_found");
    await this.db`INSERT INTO moderation_log (report_id, action, actor, note) VALUES (${id}, ${action}, ${actor}, ${note ?? null})`;
  }

  async createOfficial(input: { category: ReportCategory; coord: LngLat; expiresAt: Date; officialRef: string; actor: string }): Promise<PublicReport> {
    const [row] = (await this.db.unsafe(
      `INSERT INTO reports (category, source, lat, lng, expires_at, official_ref)
       VALUES ($1, 'official', $2, $3, $4, $5) RETURNING ${COLS}`,
      [input.category, input.coord[1], input.coord[0], input.expiresAt, input.officialRef],
    )) as ReportRow[];
    await this.db`INSERT INTO moderation_log (report_id, action, actor, note) VALUES (${row.id}, 'create_official', ${input.actor}, ${input.officialRef})`;
    return toPublic(row);
  }
}
