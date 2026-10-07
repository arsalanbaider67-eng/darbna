/**
 * Serves a lightened copy of the upstream MapLibre style. Navigation needs roads, names and
 * landmarks, not 3D buildings; dropping the expensive layers makes the map noticeably smoother
 * on older Android phones and emulators.
 */

export interface StyleLayer {
  id: string;
  type: string;
  minzoom?: number;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  [k: string]: unknown;
}
export interface MapStyle {
  layers: StyleLayer[];
  [k: string]: unknown;
}

/** Pure transform, unit-tested. */
export function lightenStyle(style: MapStyle): MapStyle {
  const layers: StyleLayer[] = [];
  for (const l of style.layers) {
    // 3D extrusions and hillshading are the most expensive layers to draw.
    if (l.type === "fill-extrusion" || l.type === "hillshade") continue;
    const next: StyleLayer = { ...l };
    // Flat building footprints only when zoomed in close.
    if (l.type === "fill" && /building/i.test(l.id)) next.minzoom = Math.max(l.minzoom ?? 0, 15);
    // POI icons/labels appear a little later so dense areas (central Baghdad) stay light.
    if (l.type === "symbol" && /poi/i.test(l.id)) next.minzoom = Math.max(l.minzoom ?? 0, 15);
    layers.push(next);
  }
  return { ...style, layers };
}

export class StyleCache {
  private cache = new Map<string, { body: string; at: number }>();
  constructor(private ttlMs = 60 * 60_000, private timeoutMs = 8000) {}

  async get(upstreamUrl: string): Promise<string> {
    const hit = this.cache.get(upstreamUrl);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.body;
    try {
      const res = await fetch(upstreamUrl, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new Error(`style upstream ${res.status}`);
      const body = JSON.stringify(lightenStyle((await res.json()) as MapStyle));
      this.cache.set(upstreamUrl, { body, at: Date.now() });
      return body;
    } catch (e) {
      if (hit) return hit.body; // stale is better than no map
      throw e;
    }
  }
}
