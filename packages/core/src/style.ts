/**
 * Lightened MapLibre style: navigation needs roads, names and landmarks, not 3D buildings.
 * Dropping the expensive layers keeps the map smooth on older phones and emulators.
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

