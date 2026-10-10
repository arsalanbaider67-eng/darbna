/**
 * SOS region and emergency numbers in the app.
 *
 *  - The numbers live in an updateable config (packages/core/data/emergency-numbers.json, with
 *    sources and a last-verified date). A copy is published with the web app; a downloaded copy is
 *    used only if it's valid and newer than the one built into the app.
 *  - The region is tracked from GPS all the time (not only when the SOS screen is open), so the
 *    screen is already right when someone needs it, and it updates when you cross a boundary.
 *  - The last region confirmed by location, a manual choice and the last good config are saved on
 *    the phone, so SOS works offline and after a restart.
 * Emergency numbers never depend on an account, points or levels.
 */
import { useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_TRACKER, locateRegion, pickEmergencyConfig, RegionTracker,
  type EmergencyConfig, type LocationFix, type RegionShapes,
} from "@darbna/core";
import bundledConfig from "@darbna/core/data/emergency-numbers.json";
import shapesJson from "@darbna/core/data/sos-regions.json";
import { webBase } from "../share";
import { getState, setState } from "../store";

export const BUNDLED_CONFIG = bundledConfig as unknown as EmergencyConfig;
const SHAPES = shapesJson as unknown as RegionShapes;

const K = { config: "darbna:sosConfig", region: "darbna:sosRegion", manual: "darbna:sosManual" };

async function readJSON<T>(k: string): Promise<T | null> {
  try { const v = await AsyncStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
const writeJSON = (k: string, v: unknown) => AsyncStorage.setItem(k, JSON.stringify(v)).catch(() => {});

/** Saved state: last good config, last region confirmed by location, manual choice. */
export async function loadSosState(): Promise<void> {
  const [cfg, region, manual] = await Promise.all([
    readJSON<unknown>(K.config), readJSON<{ region: string; at: number }>(K.region), readJSON<{ region: string; at: number }>(K.manual),
  ]);
  setState((s) => ({ sos: { ...s.sos, config: pickEmergencyConfig(BUNDLED_CONFIG, cfg), cached: region, manual } }));
}

/** When online: fetch the published config; keep it only if it's valid and newer. */
export async function refreshSosConfig(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`${webBase()}emergency-numbers.json`, { signal: ctrl.signal, cache: "no-cache" as RequestCache });
    clearTimeout(timer);
    if (!res.ok) return;
    const remote = await res.json();
    const cur = getState().sos.config;
    const next = pickEmergencyConfig(cur, remote);
    if (next !== cur) {
      setState((s) => ({ sos: { ...s.sos, config: next } }));
      void writeJSON(K.config, next);
    }
  } catch {
    // Offline or blocked: keep what we have.
  }
}

/** The user picked their region (location off, uncertain, or they know better). null clears it. */
export function chooseSosRegion(region: string | null): void {
  const manual = region ? { region, at: Date.now() } : null;
  setState((s) => ({ sos: { ...s.sos, manual } }));
  if (manual) void writeJSON(K.manual, manual); else void AsyncStorage.removeItem(K.manual).catch(() => {});
}

/**
 * Feeds GPS fixes to the region tracker (throttled: when you've moved 100 m or every 20 s).
 * Mounted once, near the top of the app.
 */
export function useSosRegion(fix: LocationFix | null, permission: string, online: boolean | null): void {
  const tracker = useRef<RegionTracker | null>(null);
  const last = useRef<{ coord: [number, number]; at: number } | null>(null);

  useEffect(() => { void loadSosState(); }, []);
  useEffect(() => { if (online) void refreshSosConfig(); }, [online]);

  useEffect(() => {
    const perm = permission === "granted" ? "granted" : permission === "unknown" ? "unknown" : "denied";
    if (getState().sos.permission !== perm) setState((s) => ({ sos: { ...s.sos, permission: perm } }));
  }, [permission]);

  useEffect(() => {
    if (!fix) return;
    const now = Date.now();
    const l = last.current;
    if (l && now - l.at < 20_000 && Math.abs(fix.coord[0] - l.coord[0]) + Math.abs(fix.coord[1] - l.coord[1]) < 0.001) return;
    last.current = { coord: fix.coord, at: now };
    tracker.current ??= new RegionTracker((p) => locateRegion(p, SHAPES), DEFAULT_TRACKER, getState().sos.cached);
    const before = tracker.current.status;
    const st = tracker.current.update({ coord: fix.coord, accuracyM: fix.accuracyM, at: now });
    setState((s) => ({ sos: { ...s.sos, live: st } }));
    // A newly confirmed (or re-confirmed) region is saved for offline use.
    if (st.region && st.confirmedAt != null && (st.region !== before.region || st.confirmedAt !== before.confirmedAt)) {
      const cached = { region: st.region, at: st.confirmedAt };
      setState((s) => ({ sos: { ...s.sos, cached } }));
      void writeJSON(K.region, cached);
    }
  }, [fix]);
}
