import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Camera, CircleLayer, LineLayer, MapView, ShapeSource, UserLocation, type CameraRef,
} from "@maplibre/maplibre-react-native";
import { lightenStyle, lineProgress, lineProgressTable, satelliteStyle, snapToLine, trafficLevel, type LngLat, type LocationFix, type TrafficCell } from "@darbna/core";
import { useUi } from "../context";
import { downloadAreaBBox, type OfflineResult } from "../offline";
import { REPORT_STYLE } from "../theme";
import type { ApiRoute, Place, PublicReport } from "../types";

export interface MapCanvasHandle {
  fitTo(points: LngLat[], bottomPadding?: number): void;
  flyTo(p: LngLat, zoom?: number): void;
  /** Save the area on screen for offline use. */
  downloadVisible(onProgress: (pct: number) => void): Promise<OfflineResult>;
}

interface Props {
  styleUrl: string;
  follow: "none" | "user" | "navigation";
  routes: ApiRoute[];
  selectedRouteIdx: number;
  destination: Place | null;
  reports: PublicReport[];
  /** Used once, for the first camera position. Later changes are ignored on purpose. */
  initialCenter: LngLat | null;
  onLongPress(p: LngLat): void;
  onReportPress(id: string): void;
  onRegionChange(bbox: [number, number, number, number], zoom: number, byUser: boolean): void;
  onRoutePress?(idx: number): void;
  /** Demo drive: a simulated position that replaces the phone GPS for the dot and camera. */
  simFix?: LocationFix | null;
  /** Live traffic slow spots (browse mode). */
  jams?: TrafficCell[];
  /** On a trip: the part of the route already driven turns grey. */
  traveled?: boolean;
}

const TRAFFIC_COLOR = ["match", ["get", "level"], "heavy", "#E5383B", "#F2994A"];
const BAGHDAD: LngLat = [44.3661, 33.3152];
const DRIVEN_COLOR = "#7D8794";

// Category → colour as a GPU-side expression, so markers cost nothing per frame.
const REPORT_COLOR: any = [
  "match", ["get", "category"],
  ...Object.entries(REPORT_STYLE).flatMap(([k, v]) => [k, v.color]),
  "#666666",
];

/**
 * Performance notes (older Android phones and emulators):
 *  - GLSurfaceView (`surfaceView`) instead of the default TextureView: noticeably faster drawing.
 *  - Reports and the destination are GeoJSON circle layers drawn by the map's GPU renderer,
 *    not React Native views (MarkerView re-positions a native view on every frame).
 *  - Callbacks are routed through a ref and the component is memoised, so location updates and
 *    unrelated state changes in the screen don't re-render the map.
 */
function MapCanvasInner(p: Props, ref: React.Ref<MapCanvasHandle>) {
  const { theme } = useUi();
  const camera = useRef<CameraRef>(null);
  const mapView = useRef<any>(null);
  const styleRef = useRef(p.styleUrl.split("#")[0]);
  styleRef.current = p.styleUrl.split("#")[0];
  // "#sat": satellite photos with the roads and names on top, built from the normal style.
  const [mapStyle, setMapStyle] = useState<string | object>(styleRef.current);
  useEffect(() => {
    const [url, tag] = p.styleUrl.split("#");
    if (tag !== "sat") { setMapStyle(url); return; }
    let live = true;
    fetch(url).then((r) => r.json()).then((st) => { if (live) setMapStyle(satelliteStyle(lightenStyle(st))); }).catch(() => live && setMapStyle(url));
    return () => { live = false; };
  }, [p.styleUrl]);

  // Grey "already driven" part of the route, from the phone's own position updates.
  const [driven, setDriven] = useState<number | null>(null);
  const progRoute = useRef<{ line: LngLat[]; table: number[]; seg: number } | null>(null);
  const selLine = p.routes[p.selectedRouteIdx]?.geometry;
  useEffect(() => { progRoute.current = null; setDriven(null); }, [selLine, p.traveled]);
  const onUserUpdate = useCallback((loc: any) => {
    if (!p.traveled || !selLine || selLine.length < 2) return;
    const c = loc?.coords;
    if (!c) return;
    if (progRoute.current?.line !== selLine) progRoute.current = { line: selLine, table: lineProgressTable(selLine), seg: 0 };
    const r = progRoute.current;
    const sn = snapToLine([c.longitude, c.latitude], r.line, Math.min(35, Math.max(15, c.accuracy ?? 15)), r.seg);
    if (!sn) return;
    r.seg = sn.index;
    const prog = lineProgress(r.table, r.line, sn.index, sn.point);
    setDriven((d) => (d != null && prog < d && d - prog < 0.02 ? d : prog));
  }, [p.traveled, selLine]);
  const handlers = useRef(p);
  handlers.current = p;

  const initial = useRef(p.initialCenter);
  const defaultSettings = useMemo(
    () => ({ centerCoordinate: initial.current ?? BAGHDAD, zoomLevel: initial.current ? 14 : 11 }),
    [],
  );

  useImperativeHandle(ref, () => ({
    fitTo(points, bottomPadding = 320) {
      if (!points.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of points) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      camera.current?.fitBounds([maxX, maxY], [minX, minY], [120, 48, bottomPadding, 48], 600);
    },
    flyTo(pt, zoom = 15) {
      camera.current?.setCamera({ centerCoordinate: pt, zoomLevel: zoom, animationDuration: 500, animationMode: "easeTo" });
    },
    async downloadVisible(onProgress) {
      try {
        const vb = await mapView.current?.getVisibleBounds(); // [[ne], [sw]]
        if (!vb) return "failed";
        const [[e, n], [w, s]] = vb;
        return downloadAreaBBox([w, s, e, n], styleRef.current.split("#")[0], onProgress);
      } catch {
        return "failed";
      }
    },
  }), []);

  const onLongPress = useCallback((f: any) => {
    const c = f?.geometry?.coordinates;
    if (Array.isArray(c)) handlers.current.onLongPress([c[0], c[1]]);
  }, []);

  const onRegionDidChange = useCallback((f: any) => {
    const vb = f?.properties?.visibleBounds as [[number, number], [number, number]] | undefined;
    if (!vb) return;
    const [ne, sw] = vb;
    handlers.current.onRegionChange([sw[0], sw[1], ne[0], ne[1]], f.properties.zoomLevel ?? 12, !!f.properties.isUserInteraction);
  }, []);

  const onRoutePress = useCallback((e: any) => {
    const idx = e?.features?.[0]?.properties?.idx;
    if (typeof idx === "number") handlers.current.onRoutePress?.(idx);
  }, []);

  const onReportPress = useCallback((e: any) => {
    const id = e?.features?.[0]?.properties?.id;
    if (typeof id === "string") handlers.current.onReportPress(id);
  }, []);

  const routeShape = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: p.routes.map((r, i) => ({
      type: "Feature" as const,
      id: r.id,
      properties: { idx: i, selected: i === p.selectedRouteIdx ? 1 : 0 },
      geometry: { type: "LineString" as const, coordinates: r.geometry },
    })),
  }), [p.routes, p.selectedRouteIdx]);

  const reportShape = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: p.reports.map((r) => ({
      type: "Feature" as const,
      id: r.id,
      properties: {
        id: r.id,
        category: r.category,
        verified: r.verified ? 1 : 0,
        opacity: r.verified ? 1 : 0.45 + r.confidence * 0.55,
      },
      geometry: { type: "Point" as const, coordinates: r.coord },
    })),
  }), [p.reports]);

  const destShape = useMemo(() => (p.destination ? {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Point" as const, coordinates: p.destination.coord },
  } : null), [p.destination]);

  const navigating = p.follow === "navigation";
  const trafficShape = useMemo(() => {
    const r = p.routes[p.selectedRouteIdx];
    return {
      type: "FeatureCollection" as const,
      features: (r?.trafficSpans ?? []).map((sp, i) => ({
        type: "Feature" as const, id: `t${i}`, properties: { level: sp.level },
        geometry: { type: "LineString" as const, coordinates: r.geometry.slice(sp.from, sp.to + 1) },
      })),
    };
  }, [p.routes, p.selectedRouteIdx]);
  const jamShape = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: (p.jams ?? []).map((j) => ({
      type: "Feature" as const, id: `${j.cell}:${j.dir}`, properties: { level: trafficLevel(j.ratio) },
      geometry: { type: "Point" as const, coordinates: j.coord },
    })),
  }), [p.jams]);
  const sim = p.simFix ?? null;
  useEffect(() => {
    if (!sim || p.follow === "none") return;
    camera.current?.setCamera({
      centerCoordinate: sim.coord, zoomLevel: navigating ? 16.5 : 15, pitch: navigating ? 45 : 0,
      heading: navigating && sim.headingDeg != null ? sim.headingDeg : undefined, animationDuration: 950, animationMode: "easeTo",
    });
  }, [sim, p.follow]); // eslint-disable-line react-hooks/exhaustive-deps
  const simShape = useMemo(() => (sim ? { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: sim.coord } } : null), [sim]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapView}
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyle as any}
        surfaceView
        logoEnabled={false}
        attributionEnabled
        attributionPosition={{ top: 8, left: 8 }}
        compassEnabled={!navigating}
        pitchEnabled={navigating}
        rotateEnabled
        regionDidChangeDebounceTime={600}
        onLongPress={onLongPress}
        onRegionDidChange={onRegionDidChange}
      >
        <Camera
          ref={camera}
          defaultSettings={defaultSettings}
          followUserLocation={p.follow !== "none" && !sim}
          followUserMode={navigating ? "course" : "normal"}
          followZoomLevel={navigating ? 16.5 : 15}
          followPitch={navigating ? 45 : 0}
          animationDuration={400}
        />

        {p.routes.length > 0 && (
          <ShapeSource id="routes" shape={routeShape} lineMetrics onPress={onRoutePress} hitbox={{ width: 24, height: 24 }}>
            <LineLayer id="route-alt" filter={["==", ["get", "selected"], 0]}
              style={{ lineColor: theme.routeAlt, lineWidth: 7, lineCap: "round", lineJoin: "round" }} />
            <LineLayer id="route-casing" filter={["==", ["get", "selected"], 1]}
              style={{ lineColor: theme.routeCasing, lineWidth: 11, lineCap: "round", lineJoin: "round" }} />
            <LineLayer id="route-main" filter={["==", ["get", "selected"], 1]}
              style={{
                lineColor: theme.route, lineWidth: 7, lineCap: "round", lineJoin: "round",
                ...(p.traveled && driven != null ? { lineGradient: ["step", ["line-progress"], DRIVEN_COLOR, Math.min(1, Math.max(1e-6, driven)), theme.route] as any } : {}),
              }} />
          </ShapeSource>
        )}

        {trafficShape.features.length > 0 && (
          <ShapeSource id="traffic" shape={trafficShape}>
            <LineLayer id="route-traffic" style={{ lineColor: TRAFFIC_COLOR as any, lineWidth: 7, lineCap: "round", lineJoin: "round" }} />
          </ShapeSource>
        )}

        <ShapeSource id="jams" shape={jamShape}>
          <CircleLayer id="jam-dot" minZoomLevel={11} style={{
            circleRadius: ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 9], circleColor: TRAFFIC_COLOR as any, circleOpacity: 0.75, circleBlur: 0.4,
          }} />
        </ShapeSource>

        <ShapeSource id="reports" shape={reportShape} onPress={onReportPress} hitbox={{ width: 36, height: 36 }}>
          <CircleLayer
            id="report-dot"
            minZoomLevel={10}
            style={{
              circleRadius: ["interpolate", ["linear"], ["zoom"], 10, 6, 15, 13],
              circleColor: REPORT_COLOR,
              circleOpacity: ["get", "opacity"],
              circleStrokeWidth: ["case", ["==", ["get", "verified"], 1], 3, 2],
              circleStrokeColor: ["case", ["==", ["get", "verified"], 1], theme.accent, "#FFFFFF"],
              circlePitchAlignment: "map",
            }}
          />
          <CircleLayer
            id="report-core"
            minZoomLevel={13}
            style={{ circleRadius: 3.5, circleColor: "#FFFFFF", circleOpacity: ["get", "opacity"] }}
          />
        </ShapeSource>

        {destShape && (
          <ShapeSource id="destination" shape={destShape}>
            <CircleLayer id="dest-halo" style={{ circleRadius: 16, circleColor: theme.accent, circleOpacity: 0.25 }} />
            <CircleLayer id="dest-dot" style={{ circleRadius: 8, circleColor: theme.accent, circleStrokeWidth: 3, circleStrokeColor: "#FFFFFF" }} />
          </ShapeSource>
        )}

        {simShape && (
          <ShapeSource id="sim-me" shape={simShape}>
            <CircleLayer id="sim-halo" style={{ circleRadius: 18, circleColor: "#2F80ED", circleOpacity: 0.18 }} />
            <CircleLayer id="sim-dot" style={{ circleRadius: 8, circleColor: "#2F80ED", circleStrokeWidth: 3, circleStrokeColor: "#FFFFFF" }} />
          </ShapeSource>
        )}

        {!sim && <UserLocation
          renderMode="native"
          androidRenderMode={navigating ? "gps" : "compass"}
          showsUserHeadingIndicator
          minDisplacement={navigating ? 0 : 5}
          onUpdate={onUserUpdate}
        />}
      </MapView>
    </View>
  );
}

const sameExceptCallbacks = (a: Props, b: Props) =>
  a.styleUrl === b.styleUrl &&
  a.follow === b.follow &&
  a.routes === b.routes &&
  a.selectedRouteIdx === b.selectedRouteIdx &&
  a.destination === b.destination &&
  a.reports === b.reports &&
  a.simFix === b.simFix &&
  a.jams === b.jams &&
  a.traveled === b.traveled;

export const MapCanvas = memo(forwardRef<MapCanvasHandle, Props>(MapCanvasInner), sameExceptCallbacks);
