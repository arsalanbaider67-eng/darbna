import type { LngLat } from "@darbna/core";

export interface GeoResult {
  id: string;
  name: string;
  /** District / city line shown under the name. */
  secondary: string;
  kind: string;
  coord: LngLat;
  source: "gazetteer" | "nominatim";
  quality: "verified" | "seed_unverified" | "osm_import" | "osm";
  score: number;
}

export interface GeocodingProvider {
  readonly name: string;
  search(q: string, opts: { lang: string; near?: LngLat; limit: number }): Promise<GeoResult[]>;
  reverse(p: LngLat, lang: string): Promise<GeoResult | null>;
}

export class GeocoderUnavailable extends Error {}

interface NominatimItem {
  place_id: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  type?: string;
  importance?: number;
  namedetails?: Record<string, string>;
  address?: Record<string, string>;
}

const LANG_TAG: Record<string, string> = { ar: "name:ar", ckb: "name:ckb", en: "name:en" };

function pickName(it: NominatimItem, lang: string): string {
  const nd = it.namedetails ?? {};
  return nd[LANG_TAG[lang]] || nd["name:ar"] || it.name || nd.name || it.display_name.split(",")[0];
}

function secondaryLine(it: NominatimItem): string {
  const a = it.address ?? {};
  return [a.road && a.road !== it.name ? a.road : undefined, a.suburb ?? a.neighbourhood ?? a.city_district, a.city ?? a.town ?? a.village ?? a.county, a.state]
    .filter(Boolean)
    .slice(0, 3)
    .join("، ");
}

/**
 * Nominatim adapter. Point it at a self-hosted instance built from the Iraq OSM extract.
 * The public nominatim.openstreetmap.org instance is NOT for production apps
 * (usage policy: max 1 req/s, no autocomplete, attribution + user agent required).
 */
export class NominatimProvider implements GeocodingProvider {
  readonly name = "nominatim";
  private nextSlot = 0;
  /**
   * @param minIntervalMs spacing between upstream requests. Set ≥1000 when pointing at the public
   * nominatim.openstreetmap.org (development only); requests that would wait more than 1.5 s are
   * dropped and the search returns gazetteer-only results marked `partial`.
   */
  constructor(private baseUrl: string, private timeoutMs: number, private userAgent: string, private minIntervalMs = 0) {}

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    if (this.minIntervalMs > 0) {
      const now = Date.now();
      const slot = Math.max(now, this.nextSlot);
      if (slot - now > 1500) throw new GeocoderUnavailable("throttled");
      this.nextSlot = slot + this.minIntervalMs;
      if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
    }
    const u = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    try {
      const res = await fetch(u, { headers: { "user-agent": this.userAgent }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new GeocoderUnavailable(`nominatim ${res.status}`);
      return await res.json();
    } catch (e) {
      if (e instanceof GeocoderUnavailable) throw e;
      throw new GeocoderUnavailable((e as Error).message);
    }
  }

  private map(it: NominatimItem, lang: string, rankBase: number): GeoResult {
    return {
      id: `osm:${it.osm_type?.[0] ?? "x"}${it.osm_id ?? it.place_id}`,
      name: pickName(it, lang),
      secondary: secondaryLine(it),
      kind: it.type ?? it.category ?? "place",
      coord: [Number(it.lon), Number(it.lat)],
      source: "nominatim",
      quality: "osm",
      score: rankBase + (it.importance ?? 0) * 0.2,
    };
  }

  async search(q: string, opts: { lang: string; near?: LngLat; limit: number }): Promise<GeoResult[]> {
    const params: Record<string, string> = {
      q, format: "jsonv2", countrycodes: "iq", limit: String(opts.limit),
      addressdetails: "1", namedetails: "1", "accept-language": `${opts.lang},ar,en`,
    };
    if (opts.near) {
      const [x, y] = opts.near, d = 0.35; // ~35 km box: prefer, don't restrict
      params.viewbox = `${x - d},${y + d},${x + d},${y - d}`;
    }
    const items = (await this.get("/search", params)) as NominatimItem[];
    return items.map((it, i) => this.map(it, opts.lang, 0.6 - i * 0.03));
  }

  async reverse(p: LngLat, lang: string): Promise<GeoResult | null> {
    const it = (await this.get("/reverse", {
      lat: String(p[1]), lon: String(p[0]), format: "jsonv2", zoom: "18",
      addressdetails: "1", namedetails: "1", "accept-language": `${lang},ar,en`,
    })) as NominatimItem & { error?: string };
    if (!it || it.error) return null;
    return this.map(it, lang, 1);
  }
}
