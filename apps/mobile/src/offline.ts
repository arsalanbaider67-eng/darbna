/**
 * Phone app offline maps: MapLibre offline packs. A pack stores every tile, font and icon the
 * map needs for an area, so it draws with no internet. (MapLibre also keeps a cache of recently
 * viewed map areas on its own.)
 */
import { OfflineManager } from "@maplibre/maplibre-react-native";

export type OfflineResult = "ok" | "too_big" | "failed" | "unsupported";
export interface OfflineSummary { areas: number; bytes: number }

const MAX_TILES = 6000;
const MIN_ZOOM = 6;
const MAX_ZOOM = 14; // the map data's most detailed level; closer zooms reuse these tiles

function tileCount(bbox: [number, number, number, number]): number {
  const lon2x = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const lat2y = (lat: number, z: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  };
  let n = 0;
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) n += (lon2x(bbox[2], z) - lon2x(bbox[0], z) + 1) * (lat2y(bbox[1], z) - lat2y(bbox[3], z) + 1);
  return n;
}

export function offlineSupported(): boolean {
  return true;
}

/** bbox = [west, south, east, north] of the area on screen. */
export async function downloadAreaBBox(bbox: [number, number, number, number], styleURL: string, onProgress: (pct: number) => void): Promise<OfflineResult> {
  if (tileCount(bbox) > MAX_TILES) return "too_big";
  const name = `darbna-${Date.now()}`;
  return new Promise<OfflineResult>((resolve) => {
    let settled = false;
    const finish = (r: OfflineResult) => { if (!settled) { settled = true; resolve(r); } };
    OfflineManager.createPack(
      { name, styleURL, bounds: [[bbox[2], bbox[3]], [bbox[0], bbox[1]]], minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, metadata: { createdAt: Date.now() } } as any,
      (_pack: unknown, status: any) => {
        const pct = Math.round(status?.percentage ?? 0);
        onProgress(pct);
        if (pct >= 100) finish("ok");
      },
      () => finish("failed"),
    ).catch(() => finish("failed"));
  });
}

export async function offlineSummary(): Promise<OfflineSummary> {
  try {
    const packs: any[] = await OfflineManager.getPacks();
    let bytes = 0;
    for (const p of packs) {
      try { bytes += (await p.status())?.completedResourceSize ?? 0; } catch {}
    }
    return { areas: packs.length, bytes };
  } catch {
    return { areas: 0, bytes: 0 };
  }
}

export async function clearOffline(): Promise<void> {
  try {
    const packs: any[] = await OfflineManager.getPacks();
    for (const p of packs) await OfflineManager.deletePack(p.name);
  } catch {}
}
