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
    // Flat building footprints and place icons/labels from neighbourhood zoom, so dense areas
    // (central Baghdad) stay light when zoomed out.
    if (l.type === "fill" && /building/i.test(l.id)) next.minzoom = Math.max(l.minzoom ?? 0, 14);
    if (l.type === "symbol" && /poi/i.test(l.id)) next.minzoom = Math.max(l.minzoom ?? 0, 14);
    layers.push(next);
  }
  return { ...style, layers };
}


// ---------------------------------------------------------------- satellite map
/** Esri World Imagery: free satellite photos, used with credit shown on the map. */
export const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const SATELLITE_CREDIT = "Imagery © Esri, Maxar, Earthstar Geographics";

/**
 * Satellite photos with the map's roads and names drawn on top ("hybrid"), so roads that aren't
 * on the map yet can still be seen. Land, water and building colours are dropped (the photo
 * shows them), and labels turn white with a dark outline so they read on any photo.
 */
export function satelliteStyle(style: MapStyle): MapStyle {
  const sources = { ...((style.sources as Record<string, unknown>) ?? {}) };
  sources["darbna-sat"] = { type: "raster", tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: 19, attribution: SATELLITE_CREDIT };
  const layers: StyleLayer[] = [{ id: "darbna-sat", type: "raster", source: "darbna-sat" }];
  for (const l of style.layers) {
    if (l.type === "background" || l.type === "fill" || l.type === "fill-extrusion" || l.type === "hillshade") continue;
    const next: StyleLayer = { ...l };
    if (l.type === "symbol") {
      next.paint = { ...(l.paint ?? {}), "text-color": "#FFFFFF", "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 1.6 };
    }
    if (l.type === "line" && /road|highway|street|transportation|bridge|tunnel/i.test(l.id)) {
      next.paint = { ...(l.paint ?? {}), "line-opacity": 0.85 };
    }
    layers.push(next);
  }
  return { ...style, sources, layers };
}

// ---------------------------------------------------------------- night map
/** Parse #rgb/#rrggbb/rgb()/rgba()/hsl()/hsla() into RGBA (0–255, alpha 0–1). */
export function parseColor(c: string): [number, number, number, number] | null {
  const s = c.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = [...h].map((x) => parseInt(x + x, 16));
      return [r, g, b, h.length === 4 ? a / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    return null;
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  m = s.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].replace(/%/g, "").split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    const [r, g, b] = hslToRgb(p[0], p[1] / 100, p[2] / 100);
    return [r, g, b, p[3] ?? 1];
  }
  return null;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/**
 * Night version of a colour: lightness is flipped (light land → dark land, dark text → light
 * text) and saturation toned down so nothing glares while driving at night.
 * Hue is kept, so water stays blue and parks stay green.
 */
export function nightColor(c: string): string {
  const rgba = parseColor(c);
  if (!rgba) return c;
  const [h, s, l] = rgbToHsl(rgba[0], rgba[1], rgba[2]);
  const nl = 0.08 + (1 - l) * 0.78; // 1 → 0.08, 0 → 0.86
  const [r, g, b] = hslToRgb(h, s * 0.55, nl);
  return rgba[3] < 1 ? `rgba(${r},${g},${b},${rgba[3]})` : `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

const COLOR_PROPS = /(^|-)color$/;

function mapColors(v: unknown): unknown {
  if (typeof v === "string") return nightColor(v);
  if (Array.isArray(v)) return v.map(mapColors);
  if (v && typeof v === "object") {
    // Legacy {stops:[[z, color]]} functions
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.stops)) return { ...o, stops: (o.stops as unknown[][]).map(([z, c]) => [z, mapColors(c)]) };
  }
  return v;
}

/** Night map: every colour paint property passed through nightColor. */
export function darkenStyle(style: MapStyle): MapStyle {
  return {
    ...style,
    layers: style.layers.map((l) => {
      if (!l.paint) return l;
      const paint: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(l.paint)) paint[k] = COLOR_PROPS.test(k) ? mapColors(v) : v;
      return { ...l, paint };
    }),
  };
}


// ---------------------------------------------------------------- black & gold map
const GOLD_MAP = {
  background: "#050505",
  land: "#0A0A0A",
  water: "#0B1317",
  green: "#0C110C",
  building: "#141414",
  buildingLine: "#1E1E1E",
  minorRoad: "#262421",
  road: "#34312A",
  mainRoad: "#4A3F22",
  motorway: "#6B5622",
  casing: "#000000",
  waterway: "#12202A",
  boundary: "#4A3F22",
  label: "#D9D0B8",
  labelMuted: "#9C927B",
  poiLabel: "#C9A84A",
  halo: "#000000",
};

/**
 * Black & gold map: near-black land, dark water, quiet grey streets and gold-tinted main roads,
 * so the gold route stays the brightest thing on screen. Works from any OpenMapTiles style.
 */
export function goldStyle(style: MapStyle): MapStyle {
  const C = GOLD_MAP;
  return {
    ...style,
    layers: style.layers.map((l) => {
      const id = l.id.toLowerCase();
      const paint: Record<string, unknown> = { ...(l.paint ?? {}) };
      if (l.type === "background") paint["background-color"] = C.background;
      else if (l.type === "fill") {
        const color = /water|ocean|sea|lake|river/.test(id) ? C.water
          : /building/.test(id) ? C.building
          : /park|wood|forest|grass|green|garden|cemetery|scrub|farm|wetland/.test(id) ? C.green
          : C.land;
        paint["fill-color"] = color;
        if (/building/.test(id)) paint["fill-outline-color"] = C.buildingLine;
        delete paint["fill-pattern"];
      } else if (l.type === "line") {
        const casing = /casing|outline/.test(id);
        const color = /waterway|river|stream|canal/.test(id) ? C.waterway
          : /boundary|admin/.test(id) ? C.boundary
          : casing ? C.casing
          : /motorway|trunk/.test(id) ? C.motorway
          : /primary|secondary/.test(id) ? C.mainRoad
          : /tertiary|street|road|highway|transport|bridge|tunnel/.test(id) ? C.road
          : /path|track|service|minor|pedestrian|footway|cycle/.test(id) ? C.minorRoad
          : C.road;
        paint["line-color"] = color;
      } else if (l.type === "symbol") {
        const poi = /poi/.test(id);
        const muted = /road|street|transport|highway/.test(id);
        paint["text-color"] = poi ? C.poiLabel : muted ? C.labelMuted : C.label;
        paint["text-halo-color"] = C.halo;
        paint["text-halo-width"] = 1.3;
        if (poi) paint["icon-opacity"] = 0.75;
      } else if (l.type === "fill-extrusion") {
        paint["fill-extrusion-color"] = C.building;
      }
      return { ...l, paint };
    }),
  };
}
