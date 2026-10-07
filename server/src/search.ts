import { haversine, searchKeys, type LngLat } from "@darbna/core";
import type { Db } from "./db";
import { GeocoderUnavailable, type GeocodingProvider, type GeoResult } from "./providers/geocoding";

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

export async function searchGazetteer(db: Db, q: string, lang: string, near: LngLat | undefined, limit: number): Promise<GeoResult[]> {
  const k = searchKeys(q);
  if (!k.arabic && !k.latin) return [];
  const ar = k.arabic, la = k.latin;
  const arLike = ar ? likeEscape(ar) + "%" : null;
  const laLike = la ? likeEscape(la) + "%" : null;
  const arWord = ar ? "% " + likeEscape(ar) + "%" : null;
  const rows = await db`
    WITH m AS (
      SELECT pn.place_id,
        max(GREATEST(
          CASE WHEN ${ar}::text IS NULL THEN 0
               WHEN pn.ar_key = ${ar}::text THEN 1
               WHEN pn.ar_key LIKE ${arLike}::text OR pn.ar_key LIKE ${arWord}::text THEN 0.85
               ELSE word_similarity(${ar}::text, pn.ar_key) END,
          CASE WHEN ${la}::text IS NULL THEN 0
               WHEN pn.lat_key = ${la}::text THEN 0.95
               WHEN pn.lat_key LIKE ${laLike}::text THEN 0.8
               ELSE word_similarity(${la}::text, pn.lat_key) * 0.9 END
        )) AS sim
      FROM place_names pn
      WHERE (${ar}::text IS NOT NULL AND (pn.ar_key LIKE ${arLike}::text OR pn.ar_key LIKE ${arWord}::text OR ${ar}::text <% pn.ar_key))
         OR (${la}::text IS NOT NULL AND (pn.lat_key LIKE ${laLike}::text OR ${la}::text <% pn.lat_key))
      GROUP BY pn.place_id
    )
    SELECT p.id, p.kind, p.lat, p.lng, p.importance, p.quality, m.sim,
      COALESCE(
        (SELECT name FROM place_names WHERE place_id = p.id AND lang = ${lang} ORDER BY is_primary DESC LIMIT 1),
        (SELECT name FROM place_names WHERE place_id = p.id AND lang = 'ar' ORDER BY is_primary DESC LIMIT 1),
        (SELECT name FROM place_names WHERE place_id = p.id ORDER BY is_primary DESC LIMIT 1)
      ) AS name,
      COALESCE(
        (SELECT name FROM place_names WHERE place_id = p.parent_id AND lang = ${lang} ORDER BY is_primary DESC LIMIT 1),
        (SELECT name FROM place_names WHERE place_id = p.parent_id AND lang = 'ar' ORDER BY is_primary DESC LIMIT 1)
      ) AS parent_name
    FROM m JOIN places p ON p.id = m.place_id
    WHERE m.sim >= 0.35
    ORDER BY m.sim DESC, p.importance DESC
    LIMIT 40`;
  const out: GeoResult[] = rows.map((r: any) => {
    const coord: LngLat = [r.lng, r.lat];
    let score = Number(r.sim) * 0.8 + Number(r.importance) * 0.2;
    if (near) score += 0.15 * Math.exp(-haversine(near, coord) / 50_000);
    return {
      id: `gz:${r.id}`,
      name: r.name,
      secondary: r.parent_name ?? "",
      kind: r.kind,
      coord,
      source: "gazetteer",
      quality: r.quality,
      score,
    } satisfies GeoResult;
  });
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Merge, preferring gazetteer entries and dropping provider hits within 300 m of one with a similar name. */
export function mergeResults(primary: GeoResult[], secondary: GeoResult[], limit: number): GeoResult[] {
  const out = [...primary];
  for (const s of secondary) {
    const dup = out.some((p) => haversine(p.coord, s.coord) < 300 && (p.name === s.name || p.kind === s.kind || p.kind === "city"));
    if (!dup) out.push(s);
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

class TtlCache<V> {
  private m = new Map<string, { v: V; at: number }>();
  constructor(private ttlMs: number, private max: number) {}
  get(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttlMs) { this.m.delete(k); return undefined; }
    this.m.delete(k); this.m.set(k, e); // LRU touch
    return e.v;
  }
  set(k: string, v: V) {
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value!);
    this.m.set(k, { v, at: Date.now() });
  }
}

export class SearchService {
  private cache = new TtlCache<{ results: GeoResult[]; partial: boolean }>(10 * 60_000, 2000);
  constructor(private db: Db, private geocoder: GeocodingProvider) {}

  async search(q: string, lang: string, near: LngLat | undefined, limit = 10): Promise<{ results: GeoResult[]; partial: boolean }> {
    const key = `${lang}|${q.trim().toLowerCase()}|${near ? near.map((n) => n.toFixed(1)).join(",") : "-"}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const [gz, prov] = await Promise.allSettled([
      searchGazetteer(this.db, q, lang, near, limit),
      q.trim().length >= 3 ? this.geocoder.search(q, { lang, near, limit }) : Promise.resolve([]),
    ]);
    if (gz.status === "rejected") throw gz.reason;
    const partial = prov.status === "rejected";
    if (partial && !(prov.reason instanceof GeocoderUnavailable)) throw prov.reason;
    const value = { results: mergeResults(gz.value, prov.status === "fulfilled" ? prov.value : [], limit), partial };
    if (!partial) this.cache.set(key, value);
    return value;
  }
}
