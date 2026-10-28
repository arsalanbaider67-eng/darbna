/**
 * The map on the CarPlay screen: the app's own MapCanvas (same style, route colours, report icons,
 * heading-up 3D camera while driving), fed from the shared store and the phone's live position.
 */
import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { View } from "react-native";
import { MapCanvas, type MapCanvasHandle } from "../components/MapCanvas";
import { UiProvider } from "../context";
import { useStore } from "../store";
import type { ApiRoute } from "../types";
import { carBridge } from "./bridge";

const NO_ROUTES: ApiRoute[] = [];

export function CarMap() {
  return (
    <UiProvider>
      <CarMapInner />
    </UiProvider>
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
