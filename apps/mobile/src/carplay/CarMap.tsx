/**
 * The map on the CarPlay screen: the app's own MapCanvas (same style, route colours, report icons,
 * heading-up 3D camera while driving), fed from the shared store and the phone's live position.
 */
import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { MapCanvas, type MapCanvasHandle } from "../components/MapCanvas";
import { UiProvider } from "../context";
import { useStore } from "../store";
import type { ApiRoute } from "../types";
import { carBridge } from "./bridge";
import { CAR_DEBUG, carDiag, carLog } from "./diag";

const NO_ROUTES: ApiRoute[] = [];

export function CarMap() {
  useEffect(() => { carLog("CarMap root mounted"); }, []);
  return (
    <CarErrorBoundary>
      <UiProvider>
        <CarMapInner />
      </UiProvider>
      {CAR_DEBUG && <DiagOverlay />}
    </CarErrorBoundary>
  );
}

/** A crash in the car map must never take down the phone app; in test builds it shows the error. */
class CarErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: String((e as Error)?.stack ?? e).slice(0, 600) }; }
  componentDidCatch(e: unknown) { carLog(`CarMap error: ${String((e as Error)?.message ?? e)}`); }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: "#21194A", padding: 12 }}>
          {CAR_DEBUG && <Text style={{ color: "#FFD25E", fontSize: 11 }}>{this.state.error}</Text>}
        </View>
      );
    }
    return this.props.children;
  }
}

function DiagOverlay() {
  const ev = useSyncExternalStore(carDiag.subscribe, carDiag.events);
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 4, bottom: 4, right: 4, backgroundColor: "rgba(0,0,0,0.6)", padding: 4 }}>
      {ev.slice(-8).map((l, i) => <Text key={i} style={{ color: "#fff", fontSize: 9 }}>{l}</Text>)}
    </View>
  );
}

function CarMapInner() {
  const live = useSyncExternalStore(carBridge.subscribe, carBridge.live);
  const mode = useStore((s) => s.mode);
  const trip = useStore((s) => s.trip);
  const preview = useStore((s) => s.preview);
  const selected = useStore((s) => s.selected);
  const reports = useStore((s) => s.reports);
  const map = useRef<MapCanvasHandle>(null);
  const noop = useCallback(() => {}, []);

  const routes = useMemo(
    () => (mode === "navigating" && trip ? [trip.route] : mode === "preview" && preview.result ? preview.result.routes : NO_ROUTES),
    [mode, trip?.route, preview.result], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const reportList = useMemo(() => Object.values(reports), [reports]);

  // Route choices: show them all (the CarPlay trip panel covers the left/right side, not the bottom).
  useEffect(() => {
    if (mode !== "preview" || !preview.result) return;
    const pts = preview.result.routes.flatMap((r) => [r.geometry[0], r.geometry[Math.floor(r.geometry.length / 2)], r.geometry[r.geometry.length - 1]]);
    map.current?.fitTo(pts, 60);
  }, [mode, preview.result]);

  useEffect(() => { carLog(`CarMap mounted, style ${live.styleUrl ? "ready" : "missing"}, fix ${live.fix ? "yes" : "no"}`); }, [!!live.styleUrl, !!live.fix]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!live.styleUrl) return <View style={{ flex: 1, backgroundColor: "#21194A" }} />;
  return (
    <MapCanvas
      ref={map}
      styleUrl={live.styleUrl}
      follow={mode === "navigating" ? "navigation" : mode === "preview" ? "none" : "user"}
      routes={routes}
      selectedRouteIdx={mode === "preview" ? preview.selectedIdx : 0}
      destination={mode === "place" || mode === "preview" || mode === "navigating" ? selected : null}
      reports={reportList}
      initialCenter={live.fix?.coord ?? null}
      onLongPress={noop}
      onReportPress={noop}
      onRegionChange={noop}
      simFix={live.demo && mode === "navigating" ? live.fix : null}
      traveled={mode === "navigating"}
    />
  );
}
