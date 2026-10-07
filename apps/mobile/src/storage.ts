import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import type { LngLat, ReportCategory } from "@darbna/core";
import type { ApiRoute, Place, ServerConfig } from "./types";
import type { Lang } from "./i18n";

const K = {
  install: "darbna:installId",
  settings: "darbna:settings",
  saved: "darbna:saved",
  recents: "darbna:recents",
  trip: "darbna:activeTrip",
  queue: "darbna:reportQueue",
  config: "darbna:config",
};

async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
const setJSON = (key: string, v: unknown) => AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => {});

/** Random, app-scoped, resettable. Never derived from device identifiers. */
let installId: string | null = null;
export async function getInstallId(): Promise<string> {
  if (installId) return installId;
  installId = await AsyncStorage.getItem(K.install);
  if (!installId) {
    installId = Crypto.randomUUID();
    await AsyncStorage.setItem(K.install, installId);
  }
  return installId;
}

export interface Settings {
  lang: Lang;
  theme: "auto" | "day" | "night";
  voice: boolean;
  digits: "arabic" | "western";
}
export const DEFAULT_SETTINGS: Settings = { lang: "ar", theme: "auto", voice: true, digits: "western" };
export const loadSettings = () => getJSON<Settings | null>(K.settings, null);
export const saveSettings = (s: Settings) => setJSON(K.settings, s);

export interface SavedPlaces {
  home?: Place;
  work?: Place;
  favorites: Place[];
}
export const loadSaved = () => getJSON<SavedPlaces>(K.saved, { favorites: [] });
export const saveSaved = (s: SavedPlaces) => setJSON(K.saved, s);

export const loadRecents = () => getJSON<Place[]>(K.recents, []);
export const saveRecents = (r: Place[]) => setJSON(K.recents, r.slice(0, 15));

/** The active trip, so guidance survives an app restart or crash. Holds no history. */
export interface ActiveTrip {
  route: ApiRoute;
  destination: Place;
  startedAt: number;
  avoidReportIds: string[];
}
export const loadTrip = () => getJSON<ActiveTrip | null>(K.trip, null);
export const saveTrip = (t: ActiveTrip | null) => (t ? setJSON(K.trip, t) : AsyncStorage.removeItem(K.trip).catch(() => {}));

export interface QueuedReport {
  category: ReportCategory;
  coord: LngLat;
  heading?: number;
  queuedAt: number;
}
export const loadQueue = () => getJSON<QueuedReport[]>(K.queue, []);
export const saveQueue = (q: QueuedReport[]) => setJSON(K.queue, q.slice(-10));

export const loadCachedConfig = () => getJSON<ServerConfig | null>(K.config, null);
export const saveCachedConfig = (c: ServerConfig) => setJSON(K.config, c);

/** "Delete my data": everything except the language/theme preference. */
export async function wipeLocalData(): Promise<void> {
  await AsyncStorage.multiRemove([K.install, K.saved, K.recents, K.trip, K.queue]);
  installId = null;
}
