/**
 * Serves a lightened copy of the upstream MapLibre style. Navigation needs roads, names and
 * landmarks, not 3D buildings; dropping the expensive layers makes the map noticeably smoother
 * on older Android phones and emulators.
 */

import { darkenStyle, lightenStyle, type MapStyle } from "@darbna/core";

export { lightenStyle } from "@darbna/core";

export class StyleCache {
  private cache = new Map<string, { body: string; at: number }>();
  constructor(private ttlMs = 60 * 60_000, private timeoutMs = 8000) {}

  /** `night`: recolour for night driving (used when no dedicated night style is configured). */
  async get(upstreamUrl: string, night = false): Promise<string> {
    const key = `${night ? "night:" : ""}${upstreamUrl}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.body;
    try {
      const res = await fetch(upstreamUrl, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new Error(`style upstream ${res.status}`);
      const light = lightenStyle((await res.json()) as MapStyle);
      const body = JSON.stringify(night ? darkenStyle(light) : light);
      this.cache.set(key, { body, at: Date.now() });
      return body;
    } catch (e) {
      if (hit) return hit.body; // stale is better than no map
      throw e;
    }
  }
}
