/**
 * Web version of MapCanvas (react-native-web build): same props and handle as the native
 * component, drawn with MapLibre GL JS. The native file is used on Android/iOS.
 */
import React, { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { lightenStyle, type LngLat } from "@darbna/core";
import { useUi } from "../context";
import { REPORT_STYLE } from "../theme";
import type { ApiRoute, Place, PublicReport } from "../types";
import type { MapCanvasHandle } from "./MapCanvas";

export type { MapCanvasHandle } from "./MapCanvas";

interface Props {
  styleUrl: string;
  follow: "none" | "user" | "navigation";
  routes: ApiRoute[];
  selectedRouteIdx: number;
  destination: Place | null;
  reports: PublicReport[];
  initialCenter: LngLat | null;
  onLongPress(p: LngLat): void;
  onReportPress(id: string): void;
  onRegionChange(bbox: [number, number, number, number], zoom: number, byUser: boolean): void;
  onRoutePress?(idx: number): void;
}

const BAGHDAD: LngLat = [44.3661, 33.3152];
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// Arabic/Kurdish label shaping in the browser needs MapLibre's RTL text plugin (loaded once, lazily).
let rtlRequested = false;
function ensureRtlPlugin() {
  if (rtlRequested) return;
  rtlRequested = true;
  try {
    const status = (maplibregl as any).getRTLTextPluginStatus?.();
    if (status === "unavailable" || status === undefined) {
      void (maplibregl as any).setRTLTextPlugin("https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js", true);
    }
  } catch {
    /* labels still render, just unshaped */
  }
}

const REPORT_COLOR: any = ["match", ["get", "category"], ...Object.entries(REPORT_STYLE).flatMap(([k, v]) => [k, v.color]), "#666666"];

function routesFC(routes: ApiRoute[], sel: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.map((r, i) => ({ type: "Feature", properties: { idx: i, selected: i === sel ? 1 : 0 }, geometry: { type: "LineString", coordinates: r.geometry } })),
  };
}
function reportsFC(reports: PublicReport[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: reports.map((r) => ({
      type: "Feature",
      properties: { id: r.id, category: r.category, verified: r.verified ? 1 : 0, opacity: r.verified ? 1 : 0.45 + r.confidence * 0.55 },
      geometry: { type: "Point", coordinates: r.coord },
    })),
  };
}
function pointFC(c: LngLat | null, props: Record<string, unknown> = {}): GeoJSON.FeatureCollection {
  return c ? { type: "FeatureCollection", features: [{ type: "Feature", properties: props, geometry: { type: "Point", coordinates: c } }] } : EMPTY;
}

function MapCanvasWeb(p: Props, ref: React.Ref<MapCanvasHandle>) {
  const { theme } = useUi();
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<MLMap | null>(null);
  const handlers = useRef(p);
  handlers.current = p;
  const latest = useRef(p);
  latest.current = p;
  const me = useRef<{ coord: LngLat; heading: number | null } | null>(null);
  const styleLoaded = useRef<string | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useImperativeHandle(ref, () => ({
    fitTo(points, bottomPadding = 320) {
      if (!points.length || !map.current) return;
      const b = new maplibregl.LngLatBounds(points[0], points[0]);
      for (const pt of points) b.extend(pt);
      map.current.fitBounds(b, { padding: { top: 120, right: 40, bottom: Math.min(bottomPadding, window.innerHeight * 0.5), left: 40 }, duration: 600 });
    },
    flyTo(pt, zoom = 15) {
      map.current?.easeTo({ center: pt, zoom, duration: 500 });
    },
  }), []);

  /** (Re)adds Darbna's own sources and layers; needed after every style load. */
  const addOverlays = () => {
    const m = map.current;
    if (!m || m.getSource("routes")) return;
    const t = themeRef.current;
    m.addSource("routes", { type: "geojson", data: routesFC(latest.current.routes, latest.current.selectedRouteIdx) });
    m.addLayer({ id: "route-alt", type: "line", source: "routes", filter: ["==", ["get", "selected"], 0], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": t.routeAlt, "line-width": 7 } });
    m.addLayer({ id: "route-casing", type: "line", source: "routes", filter: ["==", ["get", "selected"], 1], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": t.routeCasing, "line-width": 11 } });
    m.addLayer({ id: "route-main", type: "line", source: "routes", filter: ["==", ["get", "selected"], 1], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": t.route, "line-width": 7 } });
    m.addSource("reports", { type: "geojson", data: reportsFC(latest.current.reports) });
    m.addLayer({
      id: "report-dot", type: "circle", source: "reports", minzoom: 10,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 6, 15, 13],
        "circle-color": REPORT_COLOR, "circle-opacity": ["get", "opacity"],
        "circle-stroke-width": ["case", ["==", ["get", "verified"], 1], 3, 2],
        "circle-stroke-color": ["case", ["==", ["get", "verified"], 1], t.accent, "#FFFFFF"],
      },
    });
    m.addSource("dest", { type: "geojson", data: pointFC(latest.current.destination?.coord ?? null) });
    m.addLayer({ id: "dest-halo", type: "circle", source: "dest", paint: { "circle-radius": 16, "circle-color": t.accent, "circle-opacity": 0.25 } });
    m.addLayer({ id: "dest-dot", type: "circle", source: "dest", paint: { "circle-radius": 8, "circle-color": t.accent, "circle-stroke-width": 3, "circle-stroke-color": "#FFFFFF" } });
    m.addSource("me", { type: "geojson", data: pointFC(me.current?.coord ?? null) });
    m.addLayer({ id: "me-halo", type: "circle", source: "me", paint: { "circle-radius": 18, "circle-color": "#2F80ED", "circle-opacity": 0.18 } });
    m.addLayer({ id: "me-dot", type: "circle", source: "me", paint: { "circle-radius": 8, "circle-color": "#2F80ED", "circle-stroke-width": 3, "circle-stroke-color": "#FFFFFF" } });
  };

  // ---------------------------------------------------------------- create the map once
  useEffect(() => {
    if (!el.current) return;
    ensureRtlPlugin();
    const start = latest.current.initialCenter ?? BAGHDAD;
    const m = new maplibregl.Map({
      container: el.current,
      style: { version: 8, sources: {}, layers: [] }, // real style set below, lightened
      center: start,
      zoom: latest.current.initialCenter ? 14 : 11,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
      maxPitch: 50,
      fadeDuration: 0,
    } as any);
    // Same lightening as the server does: no 3D buildings, later POIs.
    (m as any).setStyle(latest.current.styleUrl, { transformStyle: (_prev: unknown, next: any) => lightenStyle(next) });
    styleLoaded.current = latest.current.styleUrl;
    m.touchZoomRotate.disableRotation();
    map.current = m;
    m.on("style.load", addOverlays);

    m.on("moveend", (e: any) => {
      const b = m.getBounds();
      handlers.current.onRegionChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], m.getZoom(), !!e.originalEvent);
    });
    m.on("click", "report-dot", (e: any) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") handlers.current.onReportPress(id);
    });
    m.on("click", "route-alt", (e: any) => {
      const idx = e.features?.[0]?.properties?.idx;
      if (typeof idx === "number") handlers.current.onRoutePress?.(idx);
    });
    for (const layer of ["report-dot", "route-alt"]) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }

    // Long-press to drop a pin: right-click on desktop, press-and-hold on touch screens.
    m.on("contextmenu", (e) => handlers.current.onLongPress([e.lngLat.lng, e.lngLat.lat]));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
    m.on("touchstart", (e: any) => {
      cancel();
      if (e.originalEvent?.touches?.length !== 1) return;
      const at = e.lngLat;
      timer = setTimeout(() => { timer = null; handlers.current.onLongPress([at.lng, at.lat]); }, 600);
    });
    m.on("touchend", cancel);
    m.on("touchcancel", cancel);
    m.on("touchmove", cancel);
    m.on("movestart", cancel);

    // The blue dot comes straight from the browser's geolocation (the screen's own watcher
    // feeds guidance; this one only draws).
    let watch: number | null = null;
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      watch = navigator.geolocation.watchPosition(
        (pos) => {
          const coord: LngLat = [pos.coords.longitude, pos.coords.latitude];
          me.current = { coord, heading: pos.coords.heading };
          (m.getSource("me") as GeoJSONSource | undefined)?.setData(pointFC(coord));
          const f = latest.current.follow;
          if (f !== "none") {
            const heading = f === "navigation" && pos.coords.heading != null && !Number.isNaN(pos.coords.heading) && (pos.coords.speed ?? 0) > 2 ? pos.coords.heading : m.getBearing();
            m.easeTo({ center: coord, zoom: f === "navigation" ? 16.5 : 15, bearing: heading, pitch: f === "navigation" ? 45 : 0, duration: 800 });
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
      );
    }

    return () => {
      cancel();
      if (watch !== null) navigator.geolocation.clearWatch(watch);
      m.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- prop → map sync
  useEffect(() => {
    const m = map.current;
    if (!m || styleLoaded.current === p.styleUrl) return;
    styleLoaded.current = p.styleUrl;
    m.setStyle(p.styleUrl, { transformStyle: (_prev: unknown, next: any) => lightenStyle(next) } as any);
  }, [p.styleUrl]);

  useEffect(() => {
    (map.current?.getSource("routes") as GeoJSONSource | undefined)?.setData(routesFC(p.routes, p.selectedRouteIdx));
  }, [p.routes, p.selectedRouteIdx]);

  useEffect(() => {
    (map.current?.getSource("reports") as GeoJSONSource | undefined)?.setData(reportsFC(p.reports));
  }, [p.reports]);

  useEffect(() => {
    (map.current?.getSource("dest") as GeoJSONSource | undefined)?.setData(pointFC(p.destination?.coord ?? null));
  }, [p.destination]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (p.follow === "none") m.easeTo({ pitch: 0, bearing: 0, duration: 500 });
    else if (me.current) m.easeTo({ center: me.current.coord, zoom: p.follow === "navigation" ? 16.5 : 15, pitch: p.follow === "navigation" ? 45 : 0, duration: 600 });
  }, [p.follow]);

  return <div ref={el} style={{ position: "absolute", inset: 0 }} />;
}

const sameExceptCallbacks = (a: Props, b: Props) =>
  a.styleUrl === b.styleUrl && a.follow === b.follow && a.routes === b.routes &&
  a.selectedRouteIdx === b.selectedRouteIdx && a.destination === b.destination && a.reports === b.reports;

export const MapCanvas = memo(forwardRef<MapCanvasHandle, Props>(MapCanvasWeb), sameExceptCallbacks);
