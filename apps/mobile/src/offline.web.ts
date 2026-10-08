/**
 * Web offline maps: downloads every map tile, font and icon for the area on screen. The
 * requests go through the service worker (public/sw.js), which stores them, so afterwards the
 * map of that area draws with no internet.
 */
import type { Map as MLMap } from "maplibre-gl";
import type { OfflineResult, OfflineSummary } from "./offline";

export type { OfflineResult, OfflineSummary } from "./offline";

const AREAS_KEY = "darbna:offlineAreas";
const MAX_TILES = 4000;
const MIN_ZOOM = 6;
// Font ranges a map of Iraq needs: Latin, Arabic, Arabic presentation forms.
const GLYPH_RANGES = ["0-255", "256-511", "1536-1791", "1792-2047", "2048-2303", "64256-64511", "64512-64767", "64768-65023", "65024-65279", "65280-65535"];

interface Area { bbox: [number, number, number, number]; tiles: number; bytes: number; at: number }

function readAreas(): Area[] {
  try { return JSON.parse(localStorage.getItem(AREAS_KEY) ?? "[]"); } catch { return []; }
}

const lon2x = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

export function tileList(bbox: [number, number, number, number], minZ: number, maxZ: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let z = minZ; z <= maxZ; z++) {
    const x0 = lon2x(bbox[0], z), x1 = lon2x(bbox[2], z), y0 = lat2y(bbox[3], z), y1 = lat2y(bbox[1], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
    if (out.length > MAX_TILES) break;
  }
  return out;
}

export function offlineSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller && typeof caches !== "undefined";
}

export async function downloadArea(m: MLMap, onProgress: (pct: number) => void): Promise<OfflineResult> {
  if (!offlineSupported()) return "unsupported";
  const b = m.getBounds();
  const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const style = m.getStyle() as any;
  const urls = new Set<string>();

  // Vector tiles: find the tile template behind each vector source's index (TileJSON).
  for (const src of Object.values<any>(style.sources ?? {})) {
    if (src.type !== "vector") continue;
    let templates: string[] = src.tiles ?? [];
    let maxZ = src.maxzoom ?? 14;
    if (!templates.length && src.url) {
      try {
        const tj = await (await fetch(src.url)).json();
        templates = tj.tiles ?? [];
        maxZ = tj.maxzoom ?? maxZ;
      } catch { return "failed"; }
    }
    if (!templates.length) continue;
    const tiles = tileList(bbox, MIN_ZOOM, Math.min(maxZ, 14));
    if (tiles.length > MAX_TILES) return "too_big";
    for (const [z, x, y] of tiles) urls.add(templates[0].replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)));
  }
  // Fonts used by the labels, and the icon sheet.
  if (style.glyphs) {
    const stacks = new Set<string>();
    for (const l of style.layers ?? []) {
      const f = l.layout?.["text-font"];
      if (Array.isArray(f) && f.every((x: unknown) => typeof x === "string")) stacks.add(f.join(","));
    }
    for (const st of stacks) for (const r of GLYPH_RANGES) urls.add(style.glyphs.replace("{fontstack}", encodeURIComponent(st)).replace("{range}", r));
  }
  if (typeof style.sprite === "string") for (const sfx of [".json", ".png", "@2x.json", "@2x.png"]) urls.add(style.sprite + sfx);

  const list = [...urls];
  let done = 0, failed = 0, bytes = 0;
  const worker = async () => {
    while (list.length) {
      const u = list.pop()!;
      try {
        const r = await fetch(u);
        if (r.ok) bytes += (await r.arrayBuffer()).byteLength;
        else if (r.status !== 404) failed++; // 404 = empty tile/range, fine
      } catch { failed++; }
      done++;
      if (done % 10 === 0) onProgress(Math.round((done / urls.size) * 100));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  onProgress(100);
  if (failed > urls.size * 0.05) return "failed";
  const areas = readAreas();
  areas.push({ bbox, tiles: urls.size, bytes, at: Date.now() });
  try { localStorage.setItem(AREAS_KEY, JSON.stringify(areas)); } catch {}
  // Ask the browser not to clear these files when space is low (best effort).
  try { await (navigator as any).storage?.persist?.(); } catch {}
  return "ok";
}

export async function offlineSummary(): Promise<OfflineSummary> {
  const areas = readAreas();
  return { areas: areas.length, bytes: areas.reduce((s, a) => s + a.bytes, 0) };
}

export async function clearOffline(): Promise<void> {
  try { localStorage.removeItem(AREAS_KEY); } catch {}
  try { await caches.delete("darbna-map-v1"); } catch {}
}
