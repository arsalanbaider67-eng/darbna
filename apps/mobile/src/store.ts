import { useSyncExternalStore } from "react";
import type { ApiRoute, Place, PublicReport, RouteResult, ServerConfig } from "./types";
import { DEFAULT_SETTINGS, type SavedPlaces, type Settings } from "./storage";

export type Mode = "browse" | "search" | "place" | "preview" | "navigating" | "arrived";

export interface AppState {
  ready: boolean;
  mode: Mode;
  settings: Settings;
  config: ServerConfig | null;
  saved: SavedPlaces;
  recents: Place[];
  selected: Place | null;
  /** Route preview */
  preview: { loading: boolean; error: string | null; result: RouteResult | null; selectedIdx: number; avoidReportIds: string[] };
  /** Active trip */
  trip: { route: ApiRoute; destination: Place; startedAt: number; paused: boolean; muted: boolean; avoidReportIds: string[] } | null;
  reports: Record<string, PublicReport>;
  /** Report the user tapped on the map. */
  openReportId: string | null;
  sheet: null | "report" | "settings";
  toast: { text: string; kind: "info" | "error" | "ok"; at: number } | null;
}

let state: AppState = {
  ready: false,
  mode: "browse",
  settings: DEFAULT_SETTINGS,
  config: null,
  saved: { favorites: [] },
  recents: [],
  selected: null,
  preview: { loading: false, error: null, result: null, selectedIdx: 0, avoidReportIds: [] },
  trip: null,
  reports: {},
  openReportId: null,
  sheet: null,
  toast: null,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

export function toast(text: string, kind: "info" | "error" | "ok" = "info"): void {
  setState({ toast: { text, kind, at: Date.now() } });
}

export function mergeReports(list: PublicReport[]): void {
  const cur = state.reports;
  const now = Date.now();
  let changed = false;
  const next = { ...cur };
  for (const r of list) {
    const old = cur[r.id];
    if (!old || old.confirms !== r.confirms || old.gone !== r.gone || old.expiresAt !== r.expiresAt || old.confidence !== r.confidence) {
      next[r.id] = r;
      changed = true;
    }
  }
  // Drop anything expired locally, so stale reports vanish even while offline.
  for (const [id, r] of Object.entries(next)) if (Date.parse(r.expiresAt) <= now) { delete next[id]; changed = true; }
  // Same object when nothing changed → no re-render, no map redraw.
  if (changed) setState({ reports: next });
}

export function removeReport(id: string): void {
  setState((s) => {
    const next = { ...s.reports };
    delete next[id];
    return { reports: next };
  });
}
