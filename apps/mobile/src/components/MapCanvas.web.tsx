/**
 * Web version of MapCanvas (react-native-web build): same props and handle as the native
 * component, drawn with MapLibre GL JS. The native file is used on Android/iOS.
 */
import React, { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { bearing, darkenStyle, FixFilter, haversine, lightenStyle, lineProgress, lineProgressTable, satelliteStyle, snapToLine, trafficLevel, type LngLat, type LocationFix, type TrafficCell } from "@darbna/core";
import { useUi } from "../context";
import { REPORT_STYLE } from "../theme";
import type { ApiRoute, Place, PublicReport } from "../types";
import type { MapCanvasHandle } from "./MapCanvas";
import { downloadArea } from "../offline";
import { compassHeading } from "../compass";

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
  /** Demo drive: a simulated position that replaces the browser's GPS for the blue dot and camera. */
  simFix?: LocationFix | null;
  /** Live traffic slow spots (browse mode). */
  jams?: TrafficCell[];
  /** On a trip: the arrow rides the route line and the part already driven turns grey. */
  traveled?: boolean;
}

let attribCss = false;
function ensureAttributionCss() {
  if (attribCss || typeof document === "undefined") return;
  attribCss = true;
  const st = document.createElement("style");
  st.textContent = `
    .maplibregl-ctrl-attrib.maplibregl-compact { min-height: 20px; opacity: .35; transition: opacity .2s; }
    .maplibregl-ctrl-attrib.maplibregl-compact-show { opacity: .9; }
    .maplibregl-ctrl-attrib-button { width: 20px !important; height: 20px !important; background-size: 16px !important; }
    .maplibregl-ctrl-attrib.maplibregl-compact:not(.maplibregl-compact-show) { background: transparent !important; box-shadow: none !important; }
    .maplibregl-ctrl-bottom-right .maplibregl-ctrl { margin: 0 4px 4px 0; }
  `;
  document.head.appendChild(st);
}

const BAGHDAD: LngLat = [44.3661, 33.3152];
const DRIVEN_COLOR = "#7D8794";

interface Pose { c: LngLat; h: number | null; prog: number | null }
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Turn from a to b the short way round. */
const lerpAngle = (a: number, b: number, k: number) => (a + ((((b - a) % 360) + 540) % 360 - 180) * k + 360) % 360;
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

/** Style URL + transform: lightened always; "#night" recolours it for night, "#sat" puts it over satellite photos. */
function styleArgs(url: string): [string, { transformStyle: (prev: unknown, next: any) => any }] {
  const [clean, tag] = url.split("#");
  const t = (next: any) => (tag === "night" ? darkenStyle(lightenStyle(next)) : tag === "sat" ? satelliteStyle(lightenStyle(next)) : lightenStyle(next));
  return [clean, { transformStyle: (_prev, next) => t(next) }];
}

const REPORT_COLOR: any = ["match", ["get", "category"], ...Object.entries(REPORT_STYLE).flatMap(([k, v]) => [k, v.color]), "#666666"];

function routesFC(routes: ApiRoute[], sel: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.map((r, i) => ({ type: "Feature", properties: { idx: i, selected: i === sel ? 1 : 0 }, geometry: { type: "LineString", coordinates: r.geometry } })),
  };
}
/** Slow/heavy stretches of the selected route, drawn over it in orange/red. */
function trafficFC(routes: ApiRoute[], sel: number): GeoJSON.FeatureCollection {
  const r = routes[sel];
  return {
    type: "FeatureCollection",
    features: (r?.trafficSpans ?? []).map((sp) => ({
      type: "Feature", properties: { level: sp.level },
      geometry: { type: "LineString", coordinates: r.geometry.slice(sp.from, sp.to + 1) },
    })),
  };
}
function jamsFC(jams: TrafficCell[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: jams.map((j) => ({ type: "Feature", properties: { level: trafficLevel(j.ratio) }, geometry: { type: "Point", coordinates: j.coord } })),
  };
}
export const TRAFFIC_COLOR = ["match", ["get", "level"], "heavy", "#E5383B", "#F2994A"] as const;

/** Your position: an arrow when the direction is known, otherwise a dot. */
function meFC(c: LngLat | null, heading: number | null): GeoJSON.FeatureCollection {
  return pointFC(c, { heading: heading ?? 0, hasHeading: heading == null ? 0 : 1 });
}

/** Navigation arrow drawn once into an image (2× for sharp edges on phone screens). */
function puckImage(): ImageData | null {
  if (typeof document === "undefined") return null;
  const S = 72, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  if (!g) return null;
  g.translate(S / 2, S / 2);
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 6;
  g.beginPath();
  g.moveTo(0, -27); // tip (points north; the map rotates it)
  g.lineTo(21, 23);
  g.lineTo(0, 13);
  g.lineTo(-21, 23);
  g.closePath();
  g.fillStyle = "#2EC4DA";
  g.fill();
  g.shadowColor = "transparent";
  g.lineWidth = 4;
  g.strokeStyle = "#FFFFFF";
  g.lineJoin = "round";
  g.stroke();
  return g.getImageData(0, 0, S, S);
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
  const me = useRef<{ coord: LngLat; raw: LngLat; heading: number | null; at: number; moving: boolean } | null>(null);
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
    downloadVisible(onProgress) {
      return map.current ? downloadArea(map.current, onProgress) : Promise.resolve("failed" as const);
    },
  }), []);

  /**
   * Which way you're heading: the GPS course while moving, else the direction of your last few
   * metres of movement, else the phone's compass, else the last known direction.
   */
  const pickHeading = (coord: LngLat, gps: number | null, speed: number | null): { h: number | null; moving: boolean } => {
    const prev = me.current;
    if (gps != null && !Number.isNaN(gps) && (speed ?? 0) > 1.5) return { h: gps, moving: true };
    if (prev && haversine(prev.raw, coord) > 6 && (speed == null || speed > 0.8)) return { h: bearing(prev.raw, coord), moving: true };
    return { h: compassHeading() ?? prev?.heading ?? null, moving: false };
  };

  // ---- smooth movement ----
  // GPS gives a position about once a second (28 m apart at 100 km/h). Instead of jumping, the
  // arrow, the camera and the grey "already driven" line glide from the last position to the new
  // one over the time between fixes, so they move continuously like Waze.
  const shown = useRef<Pose | null>(null);
  const anim = useRef<{ from: Pose; to: Pose; t0: number; dur: number; lastFix: number; raf: number | null }>({
    from: { c: [0, 0], h: null, prog: null }, to: { c: [0, 0], h: null, prog: null }, t0: 0, dur: 0, lastFix: 0, raf: null,
  });
  const cam = useRef<{ zoom: number; pitch: number; pad: number } | null>(null);
  const userCam = useRef(false); // you dragged/zoomed the map: stop steering the camera
  const route = useRef<{ line: LngLat[]; table: number[]; seg: number } | null>(null);

  const routeLine = () => {
    const L = latest.current;
    const line = L.traveled ? L.routes[L.selectedRouteIdx]?.geometry : undefined;
    if (!line || line.length < 2) return (route.current = null);
    if (route.current?.line !== line) route.current = { line, table: lineProgressTable(line), seg: 0 };
    return route.current;
  };

  const setDriven = (m: MLMap, prog: number | null) => {
    if (!m.getLayer("route-main")) return;
    const blue = themeRef.current.route;
    m.setPaintProperty("route-main", "line-gradient", prog == null || !latest.current.traveled
      ? null as any
      : ["step", ["line-progress"], DRIVEN_COLOR, Math.min(1, Math.max(1e-6, prog)), blue]);
  };

  /** Draws one frame: arrow, grey line, and (when following) the camera. Returns true when the camera has settled. */
  const draw = (m: MLMap, pose: Pose): boolean => {
    (m.getSource("me") as GeoJSONSource | undefined)?.setData(meFC(pose.c, pose.h));
    setDriven(m, pose.prog);
    const f = latest.current.follow;
    if (f === "none" || userCam.current) return true;
    const nav = f === "navigation";
    const target = { zoom: nav ? 16.5 : 15, pitch: nav ? 50 : 0, pad: nav ? Math.round(m.getContainer().clientHeight * 0.32) : 0 };
    const c = cam.current ?? { zoom: m.getZoom(), pitch: m.getPitch(), pad: 0 };
    c.zoom = lerp(c.zoom, target.zoom, 0.12); c.pitch = lerp(c.pitch, target.pitch, 0.12); c.pad = lerp(c.pad, target.pad, 0.12);
    cam.current = c;
    // Course-up while driving; keep the map still when stopped so it doesn't spin.
    const moving = me.current?.moving ?? false;
    const brg = nav && moving && pose.h != null ? pose.h : m.getBearing();
    m.jumpTo({ center: pose.c, zoom: c.zoom, pitch: c.pitch, bearing: brg, padding: { top: c.pad, bottom: 0, left: 0, right: 0 } } as any);
    return Math.abs(c.zoom - target.zoom) < 0.01 && Math.abs(c.pitch - target.pitch) < 0.3 && Math.abs(c.pad - target.pad) < 1;
  };

  const loop = () => {
    const m = map.current, a = anim.current;
    a.raf = null;
    if (!m) return;
    const k = a.dur > 0 ? Math.min(1, (performance.now() - a.t0) / a.dur) : 1;
    const pose: Pose = {
      c: [lerp(a.from.c[0], a.to.c[0], k), lerp(a.from.c[1], a.to.c[1], k)],
      h: a.to.h == null ? null : a.from.h == null ? a.to.h : lerpAngle(a.from.h, a.to.h, k),
      prog: a.to.prog == null ? null : a.from.prog == null ? a.to.prog : lerp(a.from.prog, a.to.prog, k),
    };
    shown.current = pose;
    const settled = draw(m, pose);
    if (k < 1 || !settled) a.raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (anim.current.raf == null) anim.current.raf = requestAnimationFrame(loop); };

  /** A new position: works out where to draw the arrow, then glides there. */
  const moveMe = (m: MLMap, raw: LngLat, gpsHeading: number | null, speed: number | null, accuracyM = 10) => {
    const pk = pickHeading(raw, gpsHeading, speed);
    const moving = pk.moving;
    let h = pk.h;
    let coord = raw;
    let prog: number | null = null;
    // On a trip: put the arrow on the road you're driving (the route line), like Waze.
    const rl = routeLine();
    if (rl) {
      const sn = snapToLine(raw, rl.line, Math.min(35, Math.max(15, accuracyM)), rl.seg);
      if (sn) {
        coord = sn.point;
        rl.seg = sn.index;
        if (moving && h != null && Math.abs(((h - sn.bearing + 540) % 360) - 180) < 60) h = sn.bearing;
        prog = lineProgress(rl.table, rl.line, sn.index, sn.point);
        // GPS wobble mustn't make the grey line creep backwards.
        const before = shown.current?.prog;
        if (before != null && prog < before && before - prog < 0.02) prog = before;
      } else prog = shown.current?.prog ?? null; // off the route for now: keep what's driven
    }
    me.current = { coord, raw, heading: h, at: Date.now(), moving };
    const a = anim.current, now = performance.now();
    const to: Pose = { c: coord, h, prog };
    const first = !shown.current || haversine(shown.current.c, coord) > 500; // first fix or a big gap: jump
    a.from = first ? to : shown.current!;
    a.to = to;
    a.t0 = now;
    // Glide over the time the next fix is expected to take, so the arrow never stops between fixes.
    a.dur = first || !a.lastFix ? 0 : Math.min(1500, Math.max(250, now - a.lastFix));
    a.lastFix = now;
    kick();
  };

  /** (Re)adds Darbna's own sources and layers; needed after every style load. */
  const addOverlays = () => {
    const m = map.current;
    if (!m || m.getSource("routes")) return;
    const t = themeRef.current;
    m.addSource("routes", { type: "geojson", lineMetrics: true, data: routesFC(latest.current.routes, latest.current.selectedRouteIdx) });
    m.addLayer({ id: "route-alt", type: "line", source: "routes", filter: ["==", ["get", "selected"], 0], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": t.routeAlt, "line-width": 7 } });
    m.addLayer({ id: "route-casing", type: "line", source: "routes", filter: ["==", ["get", "selected"], 1], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": t.routeCasing, "line-width": 11 } });
    m.addLayer({ id: "route-main", type: "line", source: "routes", filter: ["==", ["get", "selected"], 1], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": t.route, "line-width": 7 } });
    m.addSource("traffic", { type: "geojson", data: trafficFC(latest.current.routes, latest.current.selectedRouteIdx) });
    m.addLayer({ id: "route-traffic", type: "line", source: "traffic", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": TRAFFIC_COLOR as any, "line-width": 7 } });
    m.addSource("jams", { type: "geojson", data: jamsFC(latest.current.jams ?? []) });
    m.addLayer({ id: "jam-dot", type: "circle", source: "jams", minzoom: 11, paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 9], "circle-color": TRAFFIC_COLOR as any, "circle-opacity": 0.75, "circle-blur": 0.4,
    } });
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
    m.addSource("me", { type: "geojson", data: meFC(me.current?.coord ?? null, me.current?.heading ?? null) });
    m.addLayer({ id: "me-halo", type: "circle", source: "me", paint: { "circle-radius": 24, "circle-color": "#2EC4DA", "circle-opacity": 0.16, "circle-pitch-alignment": "map" } });
    m.addLayer({ id: "me-dot", type: "circle", source: "me", filter: ["==", ["get", "hasHeading"], 0], paint: { "circle-radius": 8, "circle-color": "#2F80ED", "circle-stroke-width": 3, "circle-stroke-color": "#FFFFFF" } });
    if (!m.hasImage("darbna-puck")) { const img = puckImage(); if (img) m.addImage("darbna-puck", img, { pixelRatio: 2 }); }
    m.addLayer({
      id: "me-arrow", type: "symbol", source: "me", filter: ["==", ["get", "hasHeading"], 1],
      layout: {
        "icon-image": "darbna-puck", "icon-size": 1.35, "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map",
        "icon-allow-overlap": true, "icon-ignore-placement": true,
      },
    });
    setDriven(m, shown.current?.prog ?? null);
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
    (m as any).setStyle(...styleArgs(latest.current.styleUrl));
    styleLoaded.current = latest.current.styleUrl;
    m.touchZoomRotate.disableRotation();
    map.current = m;
    // Map credit: required by the OpenStreetMap licence, so it stays reachable behind the small
    // faded (i), but it's folded away a few seconds after the map opens.
    ensureAttributionCss();
    const fold = setTimeout(() => {
      el.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    }, 4000);
    m.once("remove", () => clearTimeout(fold));
    m.on("style.load", addOverlays);
    // Standing still: turn the arrow with the phone's compass (when allowed).
    const compassTimer = setInterval(() => {
      const cur = me.current, h = compassHeading();
      if (!cur || cur.moving || h == null) return;
      if (cur.heading != null && Math.abs(((h - cur.heading + 540) % 360) - 180) < 4) return;
      cur.heading = h;
      (m.getSource("me") as GeoJSONSource | undefined)?.setData(meFC(cur.coord, h));
    }, 400);
    m.once("remove", () => clearInterval(compassTimer));

    // The camera follows you every frame while driving; tell the screen about it at most once a second.
    let lastAuto = 0;
    m.on("moveend", (e: any) => {
      const byUser = !!e.originalEvent;
      if (!byUser && Date.now() - lastAuto < 1000) return;
      if (!byUser) lastAuto = Date.now();
      const b = m.getBounds();
      handlers.current.onRegionChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], m.getZoom(), byUser);
    });
    // You moved the map yourself: stop steering the camera until you tap recenter.
    const grabbed = (e: any) => {
      if (!e.originalEvent || latest.current.follow === "none") return;
      userCam.current = true;
      const b = m.getBounds();
      handlers.current.onRegionChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], m.getZoom(), true);
    };
    m.on("dragstart", grabbed);
    m.on("zoomstart", grabbed);
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
    // Always the phone's precise GPS (never a cached or Wi-Fi guess), and rough fixes that land
    // 10+ m away from the good ones around them are skipped.
    let watch: number | null = null;
    const filter = new FixFilter();
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      watch = navigator.geolocation.watchPosition(
        (pos) => {
          if (latest.current.simFix) return; // demo drive owns the dot
          const coord: LngLat = [pos.coords.longitude, pos.coords.latitude];
          const acc = pos.coords.accuracy ?? 50;
          if (!filter.accept({ coord, accuracyM: acc, at: Date.now() })) return;
          moveMe(m, coord, pos.coords.heading, pos.coords.speed, acc);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      );
    }

    return () => {
      cancel();
      if (anim.current.raf != null) cancelAnimationFrame(anim.current.raf);
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
    const [url, opts] = styleArgs(p.styleUrl);
    // Full reload (no diff), so "style.load" fires and our route/report layers are re-added.
    (m as any).setStyle(url, { ...opts, diff: false });
  }, [p.styleUrl]);

  useEffect(() => {
    (map.current?.getSource("routes") as GeoJSONSource | undefined)?.setData(routesFC(p.routes, p.selectedRouteIdx));
    (map.current?.getSource("traffic") as GeoJSONSource | undefined)?.setData(trafficFC(p.routes, p.selectedRouteIdx));
    // New route (e.g. after a reroute): it starts where you are, so nothing on it is driven yet.
    if (shown.current) shown.current = { ...shown.current, prog: null };
    anim.current.from = { ...anim.current.from, prog: null };
    anim.current.to = { ...anim.current.to, prog: null };
    if (map.current) setDriven(map.current, null);
  }, [p.routes, p.selectedRouteIdx, p.traveled]);

  useEffect(() => {
    (map.current?.getSource("jams") as GeoJSONSource | undefined)?.setData(jamsFC(p.jams ?? []));
  }, [p.jams]);

  useEffect(() => {
    (map.current?.getSource("reports") as GeoJSONSource | undefined)?.setData(reportsFC(p.reports));
  }, [p.reports]);

  useEffect(() => {
    (map.current?.getSource("dest") as GeoJSONSource | undefined)?.setData(pointFC(p.destination?.coord ?? null));
  }, [p.destination]);

  useEffect(() => {
    const m = map.current;
    if (m && p.simFix) moveMe(m, p.simFix.coord, p.simFix.headingDeg ?? null, p.simFix.speedMps ?? null, 5);
  }, [p.simFix]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    userCam.current = false;
    cam.current = null; // the camera glides from wherever it is now
    if (p.follow === "none") m.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 500 } as any);
    else if (shown.current) kick();
  }, [p.follow]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} style={{ position: "absolute", inset: 0 }} />;
}

const sameExceptCallbacks = (a: Props, b: Props) =>
  a.styleUrl === b.styleUrl && a.follow === b.follow && a.routes === b.routes &&
  a.selectedRouteIdx === b.selectedRouteIdx && a.destination === b.destination && a.reports === b.reports && a.simFix === b.simFix && a.jams === b.jams && a.traveled === b.traveled;

export const MapCanvas = memo(forwardRef<MapCanvasHandle, Props>(MapCanvasWeb), sameExceptCallbacks);
