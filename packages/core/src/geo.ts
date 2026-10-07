/** [longitude, latitude] — GeoJSON order everywhere in Darbna. */
export type LngLat = [number, number];

const R = 6371008.8; // mean Earth radius, metres
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a→b in degrees [0,360). */
export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export interface SegmentProjection {
  point: LngLat;
  /** 0..1 along the segment */
  t: number;
  distance: number;
}

/**
 * Project p onto segment ab using a local equirectangular plane.
 * Accurate to well under a metre for segments of a few km at Iraqi latitudes (29–37°N).
 */
export function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): SegmentProjection {
  const k = Math.cos(toRad(p[1]));
  const ax = a[0] * k, ay = a[1];
  const bx = b[0] * k, by = b[1];
  const px = p[0] * k, py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { point, t, distance: haversine(p, point) };
}

/** Cumulative distance (m) at each vertex of a line. */
export function cumulativeDistances(line: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversine(line[i - 1], line[i]));
  return out;
}

/** Decode a Google-style encoded polyline (precision 6 for Valhalla, 5 for OSRM). */
export function decodePolyline(str: string, precision = 6): LngLat[] {
  const factor = 10 ** precision;
  const coords: LngLat[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, byte: number;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lng += delta;
    }
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

export function encodePolyline(coords: LngLat[], precision = 6): string {
  const factor = 10 ** precision;
  let out = "", pLat = 0, pLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    out += String.fromCharCode(n + 63);
  };
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * factor), ln = Math.round(lng * factor);
    enc(la - pLat); enc(ln - pLng);
    pLat = la; pLng = ln;
  }
  return out;
}

/** Point `meters` along a bearing — used for tests and for closure polygons. */
export function destinationPoint(p: LngLat, bearingDeg: number, meters: number): LngLat {
  const δ = meters / R, θ = toRad(bearingDeg);
  const φ1 = toRad(p[1]), λ1 = toRad(p[0]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [toDeg(λ2), toDeg(φ2)];
}

/** Square-ish polygon around a point, for Valhalla exclude_polygons. */
export function boxAround(p: LngLat, halfSizeM: number): LngLat[] {
  const n = destinationPoint(p, 0, halfSizeM)[1];
  const s = destinationPoint(p, 180, halfSizeM)[1];
  const e = destinationPoint(p, 90, halfSizeM)[0];
  const w = destinationPoint(p, 270, halfSizeM)[0];
  return [[w, s], [e, s], [e, n], [w, n], [w, s]];
}

/** Rough Iraq bounding box (incl. KRI) used to reject obviously wrong inputs. */
export const IRAQ_BBOX = { minLng: 38.7, minLat: 29.0, maxLng: 48.9, maxLat: 37.5 };
export function inIraqBBox(p: LngLat): boolean {
  return p[0] >= IRAQ_BBOX.minLng && p[0] <= IRAQ_BBOX.maxLng && p[1] >= IRAQ_BBOX.minLat && p[1] <= IRAQ_BBOX.maxLat;
}
