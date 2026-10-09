import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, StyleSheet, View } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { cumulativeDistances, haversine, parseSharedLocation, reportsAhead, speedLimitAt, WARN_AHEAD, type LngLat, type TrafficCell, type Travel } from "@darbna/core";
import { api, API_URL, ApiError } from "../api";
import { confirmDialog } from "../dialog";
import { ArrivalSheet } from "../components/ArrivalSheet";
import { MapCanvas, type MapCanvasHandle } from "../components/MapCanvas";
import { NavHud } from "../components/NavHud";
import { PlaceSheet } from "../components/PlaceSheet";
import { flushReportQueue, ReportDetails, ReportSheet } from "../components/ReportSheet";
import { RoutePreview } from "../components/RoutePreview";
import { SearchBar, SearchPanel } from "../components/SearchPanel";
import { SettingsSheet } from "../components/SettingsSheet";
import { ConnectionPill, LocatingPill, PermissionPanel, Toast } from "../components/States";
import { Btn, Icon, RoundBtn, Txt } from "../components/ui";
import { UiOverride, useUi } from "../context";
import { enableCompass } from "../compass";
import { useConnectivity } from "../hooks/useConnectivity";
import { useLocation } from "../hooks/useLocation";
import { fmt, fmtClock } from "../i18n";
import { primeVoice, stopSpeaking } from "../nav/prompt";
import { useDemoDrive } from "../hooks/useDemoDrive";
import { useTrafficSampler } from "../hooks/useTrafficSampler";
import { useGuidance } from "../nav/useGuidance";
import { loadCachedConfig, loadParked, loadTrip, saveCachedConfig, saveParked, saveRecents, saveSettings, saveTrip } from "../storage";
import { MapProblemSheet, NavMenuSheet, SosSheet, WatchCard } from "../components/Extras";
import { routeSpeedLimits } from "../external";
import { chime } from "../nav/chime";
import { routeAvoid } from "../nav/useGuidance";
import { shareText, tripLink } from "../share";
import { getState, mergeReports, setState, toast, useStore } from "../store";
import type { Place } from "../types";

const REPORT_MIN_ZOOM = 11;
const NO_ROUTES: never[] = [];
const NO_JAMS: TrafficCell[] = [];

/** A function whose identity never changes but always runs the latest closure (keeps the map memoised). */
function useStableCallback<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...a: A) => ref.current(...a), []);
}

export function MainScreen() {
  const { theme, t, fmtCtx } = useUi();
  const insets = useSafeAreaInsets();
  const mode = useStore((s) => s.mode);
  const selected = useStore((s) => s.selected);
  const preview = useStore((s) => s.preview);
  const trip = useStore((s) => s.trip);
  const config = useStore((s) => s.config);
  const reports = useStore((s) => s.reports);
  const sheet = useStore((s) => s.sheet);
  const openReportId = useStore((s) => s.openReportId);
  const lang = useStore((s) => s.settings.lang);
  const shareTraffic = useStore((s) => s.settings.shareTraffic);
  const satellite = useStore((s) => s.settings.satellite === true);
  const speedAlerts = useStore((s) => s.settings.speedAlerts !== false);
  const share = useStore((s) => s.share);
  const parked = useStore((s) => s.parked);
  const limits = useStore((s) => s.limits);
  const watch = useStore((s) => s.watch);
  const [jams, setJams] = useState<TrafficCell[]>([]);

  const online = useConnectivity();
  const loc = useLocation(mode === "navigating" ? "navigation" : "idle");
  const fix = loc.fix;
  const map = useRef<MapCanvasHandle>(null);
  const [following, setFollowing] = useState(true);
  const [lookingUp, setLookingUp] = useState(false);
  const [configError, setConfigError] = useState(false);
  const centeredOnce = useRef(false);
  const keepAwakeOn = useRef(false);
  const lastBBox = useRef<string>("");
  const lastArea = useRef<[number, number, number, number] | null>(null);

  const onMapLongPress = useStableCallback((c: LngLat) => { void dropPin(c); });
  const onMapReportPress = useStableCallback((id: string) => setState({ openReportId: id, sheet: null }));
  const onMapRegionChange = useStableCallback((b: [number, number, number, number], z: number, u: boolean) => onRegionChange(b, z, u));
  const onMapRoutePress = useStableCallback((i: number) => {
    if (getState().mode === "preview") setState((st) => ({ preview: { ...st.preview, selectedIdx: i } }));
  });
  const reportList = useMemo(() => Object.values(reports), [reports]);
  const tripRoute = trip?.route;
  const mapRoutes = useMemo(
    () => (mode === "navigating" && tripRoute ? [tripRoute] : mode === "preview" && preview.result ? preview.result.routes : NO_ROUTES),
    [mode, tripRoute, preview.result],
  );
  const mapDestination = mode === "place" || mode === "preview" || mode === "navigating" ? selected : null;
  const initialCenter = useRef<LngLat | null>(null);
  if (!initialCenter.current && fix) initialCenter.current = fix.coord;

  // Demo drive: a simulated position moves along the route instead of the phone's GPS.
  const [demo, setDemo] = useState(false);
  const demoFix = useDemoDrive(tripRoute?.geometry ?? null, tripRoute?.distanceM ?? 0, tripRoute?.durationS ?? 0, mode === "navigating" && demo, !!trip?.paused);
  const navFix = demo ? demoFix : fix;
  // Speed for the dashboard bubble: GPS speed, or worked out from the last two positions when the
  // browser doesn't report one.
  const lastFixRef = useRef<typeof navFix>(null);
  const speedRef = useRef<number | null>(null);
  if (navFix && navFix !== lastFixRef.current) {
    const prev = lastFixRef.current;
    if (navFix.speedMps != null && navFix.speedMps >= 0) speedRef.current = navFix.speedMps;
    else if (prev && navFix.timestamp > prev.timestamp) {
      const v = haversine(prev.coord, navFix.coord) / ((navFix.timestamp - prev.timestamp) / 1000);
      speedRef.current = v < 70 ? v : speedRef.current;
    }
    lastFixRef.current = navFix;
  }

  const { guidance, reroute } = useGuidance(mode === "navigating" ? navFix : null, online, fmtCtx);
  // Live traffic: real drives only (never the demo), and only if the user hasn't turned it off.
  useTrafficSampler(tripRoute ?? null, guidance, trip?.startedAt ?? null, mode === "navigating" && !demo && tripRoute?.travel !== "walk" && shareTraffic !== false && !!config?.sharedTraffic);

  // ---------------------------------------------------------------- stops passed on the way
  const passed = useRef<{ routeId: string; n: number }>({ routeId: "", n: 0 });
  const nextIdx = guidance?.nextStep?.index ?? -1;
  useEffect(() => {
    if (!tripRoute || nextIdx < 0) return;
    if (passed.current.routeId !== tripRoute.id) passed.current = { routeId: tripRoute.id, n: 0 };
    const n = tripRoute.steps.filter((s) => s.kind === "waypoint" && s.index < nextIdx).length;
    if (n > passed.current.n) {
      const d = n - passed.current.n;
      passed.current.n = n;
      setState((st) => ({ stops: st.stops.slice(d) }));
      toast(t.x.stops.reached, "ok");
    }
  }, [tripRoute, nextIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- speed limits along the trip (car)
  useEffect(() => {
    if (!tripRoute || tripRoute.travel === "walk" || mode !== "navigating") return;
    if (getState().limits?.routeId === tripRoute.id) return;
    let live = true;
    void routeSpeedLimits(tripRoute.geometry).then((spans) => { if (live) setState({ limits: { routeId: tripRoute.id, spans } }); });
    return () => { live = false; };
  }, [tripRoute, mode]);
  const limitKmh = mode === "navigating" && tripRoute && guidance && limits?.routeId === tripRoute.id ? speedLimitAt(limits.spans, guidance.segmentIndex) : null;
  const kmhNow = Math.round((speedRef.current ?? 0) * 3.6);
  const overLimit = limitKmh != null && kmhNow > limitKmh + 5;
  const lastOverChime = useRef(0);
  useEffect(() => {
    if (overLimit && speedAlerts && !trip?.muted && Date.now() - lastOverChime.current > 30_000) {
      lastOverChime.current = Date.now();
      chime(true);
    }
  }, [overLimit]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- checkpoints, cameras, crashes ahead
  const tripCum = useMemo(() => (tripRoute ? cumulativeDistances(tripRoute.geometry) : null), [tripRoute]);
  const warnItems = useMemo(
    () => reportList.filter((r) => WARN_AHEAD[r.category] && (r.category !== "camera" || speedAlerts)),
    [reportList, speedAlerts],
  );
  const ahead = mode === "navigating" && tripRoute && tripCum && guidance && guidance.status !== "arrived"
    ? reportsAhead(tripRoute.geometry, guidance.distanceAlongM, warnItems, tripCum)[0] ?? null
    : null;
  const warned = useRef(new Set<string>());
  useEffect(() => {
    if (ahead && !warned.current.has(ahead.item.id)) {
      warned.current.add(ahead.item.id);
      if (!trip?.muted) chime();
    }
  }, [ahead?.item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- "share my trip": live updates
  const navFixRef = useRef(navFix);
  navFixRef.current = navFix;
  const guidanceRef = useRef(guidance);
  guidanceRef.current = guidance;
  useEffect(() => {
    if (!share || mode !== "navigating") return;
    const push = () => {
      const f = navFixRef.current, g = guidanceRef.current;
      if (!f) return;
      void api.shareUpdate(share.id, share.secret, { coord: f.coord, heading: f.headingDeg ?? null, etaS: g?.remainingS ?? 0, remainingM: g?.remainingM ?? 0 }).catch(() => {});
    };
    push();
    const i = setInterval(push, 15_000);
    return () => clearInterval(i);
  }, [share, mode]);

  async function toggleShare() {
    const s = getState();
    setState({ sheet: null });
    if (s.share) {
      void api.shareUpdate(s.share.id, s.share.secret, { coord: navFix?.coord ?? s.trip?.destination.coord ?? [0, 0], heading: null, etaS: 0, remainingM: 0, ended: true }).catch(() => {});
      setState({ share: null });
      return;
    }
    if (!s.trip) return;
    try {
      const r = await api.shareStart(s.trip.destination.name, s.trip.destination.coord, s.trip.route.travel ?? "car");
      const url = tripLink(r.id);
      setState({ share: { ...r, url } });
      await shareText(fmt(t.x.share.message, { name: s.trip.destination.name, url }), url, t.x.share.started);
    } catch (e) {
      toast(e instanceof ApiError && e.code === "unsupported" ? t.x.share.unsupported : e instanceof ApiError && e.isNetwork ? t.status.offline : t.common.retry, "error");
    }
  }

  // ---------------------------------------------------------------- watching someone's shared trip
  const fittedWatch = useRef(false);
  useEffect(() => {
    if (!watch?.id) return;
    let live = true;
    const load = async () => {
      try {
        const tr = await api.shareGet(watch.id);
        if (!live) return;
        setState((st) => ({ watch: st.watch ? { ...st.watch, trip: tr, error: null } : null }));
        if (!fittedWatch.current && tr.coord) {
          fittedWatch.current = true;
          map.current?.fitTo([tr.coord, tr.dest], 300);
        }
      } catch (e) {
        if (live && e instanceof ApiError && !e.isNetwork) setState((st) => ({ watch: st.watch ? { ...st.watch, error: e.code } : null }));
      }
    };
    void load();
    const i = setInterval(load, 10_000);
    return () => { live = false; clearInterval(i); };
  }, [watch?.id]);
  const friend = useMemo(() => (watch?.trip?.coord && !watch.trip.ended ? { coord: watch.trip.coord, heading: watch.trip.heading } : null), [watch?.trip]);

  // ---------------------------------------------------------------- where you parked
  useEffect(() => { void loadParked().then((p) => setState({ parked: p })); }, []);

  // ---------------------------------------------------------------- server config (style URLs, capability flags)
  const loadConfig = useCallback(async () => {
    setConfigError(false);
    try {
      const c = await api.config();
      setState({ config: c });
      void saveCachedConfig(c);
    } catch {
      const cached = await loadCachedConfig();
      if (cached) setState({ config: cached });
      else setConfigError(true);
    }
  }, []);
  useEffect(() => { void loadConfig(); }, [loadConfig]);
  useEffect(() => {
    if (online && configError) void loadConfig();
    if (online) void flushReportQueue();
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- resume an interrupted trip
  useEffect(() => {
    loadTrip().then((saved) => {
      if (!saved || Date.now() - saved.startedAt > 6 * 3600_000) return void saveTrip(null);
      void confirmDialog(t.appName, fmt(t.nav.resumeTrip, { name: saved.destination.name }), t.nav.resumeYes, t.nav.resumeNo).then((yes) => {
        if (yes) setState({ selected: saved.destination, trip: { ...saved, paused: false, muted: false }, mode: "navigating" });
        else void saveTrip(null);
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- shared locations (geo:, darbna://)
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      const w = url.match(/[?&]watch=([0-9a-f-]{36})/i);
      if (w) {
        if (typeof window !== "undefined" && window.history?.replaceState) {
          try { window.history.replaceState(null, "", window.location.pathname); } catch {}
        }
        fittedWatch.current = false;
        setState({ watch: { id: w[1], trip: null, error: null } });
        return;
      }
      const loc = parseSharedLocation(url);
      if (!loc) return;
      // Web links (…/darbna/?to=…): drop the query so a reload doesn't reopen the place.
      if (typeof window !== "undefined" && window.history?.replaceState && /[?&]to=/.test(url)) {
        try { window.history.replaceState(null, "", window.location.pathname); } catch {}
      }
      pickPlace({ id: `shared:${loc.coord.join(",")}`, name: loc.label ?? t.kinds.shared, kind: "shared", coord: loc.coord }, false);
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- first fix → center map once
  useEffect(() => {
    if (fix && !centeredOnce.current && mode === "browse") {
      centeredOnce.current = true;
      map.current?.flyTo(fix.coord, 14);
    }
  }, [fix, mode]);

  // ---------------------------------------------------------------- keep screen awake only while guiding
  useEffect(() => {
    // Only release a wake lock we actually took (browsers throw otherwise), and never let a
    // refused wake lock (e.g. Safari in Low Power Mode) break navigation.
    if (mode === "navigating") {
      activateKeepAwakeAsync("nav").then(() => (keepAwakeOn.current = true)).catch(() => {});
    } else if (keepAwakeOn.current) {
      keepAwakeOn.current = false;
      try { void Promise.resolve(deactivateKeepAwake("nav")).catch(() => {}); } catch {}
    }
    if (mode !== "navigating") stopSpeaking();
  }, [mode]);

  // ---------------------------------------------------------------- Android back button
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const s = getState();
      if (s.sheet || s.openReportId) return setState({ sheet: null, openReportId: null }), true;
      if (s.mode === "search") return setState({ mode: s.selected ? "place" : "browse" }), true;
      if (s.mode === "preview") return setState({ mode: "place" }), true;
      if (s.mode === "place") return setState({ mode: "browse", selected: null }), true;
      return false; // navigating: require the explicit exit button
    });
    return () => sub.remove();
  }, []);

  // ---------------------------------------------------------------- actions
  function pickPlace(p: Place, remember = true) {
    if (remember && p.kind !== "pin") {
      const recents = [p, ...getState().recents.filter((r) => r.id !== p.id)].slice(0, 15);
      setState({ recents });
      void saveRecents(recents);
    }
    setState({ selected: p, mode: "place", stops: [], preview: { ...getState().preview, result: null, error: null } });
    map.current?.flyTo(p.coord, p.kind === "city" ? 12 : 15);
  }

  async function dropPin(coord: LngLat) {
    if (getState().mode === "navigating") return;
    const pin: Place = { id: `pin:${coord[0].toFixed(5)},${coord[1].toFixed(5)}`, name: t.place.droppedPin, kind: "pin", coord };
    pickPlace(pin, false);
    if (online === false) return;
    setLookingUp(true);
    try {
      const r = await api.reverse(coord, lang);
      if (r.result && getState().selected?.id === pin.id) {
        setState({ selected: { ...pin, name: r.result.name, secondary: r.result.secondary } });
      }
    } catch {} finally {
      setLookingUp(false);
    }
  }

  async function requestRoutes(avoidIds = getState().preview.avoidReportIds) {
    const dest = getState().selected;
    if (!dest) return;
    if (!fix) {
      setState({ mode: "preview", preview: { loading: false, error: "no_location", result: null, selectedIdx: 0, avoidReportIds: avoidIds } });
      if (loc.permission !== "granted") void loc.request();
      return;
    }
    setState({ mode: "preview", preview: { loading: true, error: null, result: null, selectedIdx: 0, avoidReportIds: avoidIds } });
    try {
      if (online === false) throw new ApiError("offline");
      const res = await api.route(fix.coord, dest.coord, {
        avoidReportIds: avoidIds, travel: getState().settings.travel ?? "car",
        via: getState().stops.map((s) => s.coord), avoid: routeAvoid(),
      });
      mergeReports(res.reports);
      setState({ preview: { loading: false, error: null, result: res, selectedIdx: 0, avoidReportIds: avoidIds } });
      const pts = res.routes.flatMap((r) => [r.geometry[0], r.geometry[Math.floor(r.geometry.length / 2)], r.geometry[r.geometry.length - 1]]);
      map.current?.fitTo(pts, 380);
    } catch (e) {
      const code = e instanceof ApiError ? (e.isNetwork ? "offline" : e.code) : "generic";
      setState({ preview: { loading: false, error: code, result: null, selectedIdx: 0, avoidReportIds: avoidIds } });
    }
  }

  function setTravel(travel: Travel) {
    const next = { ...getState().settings, travel };
    setState({ settings: next });
    void saveSettings(next);
    void requestRoutes([]);
  }

  function toggleAvoid(id: string) {
    const cur = getState().preview.avoidReportIds;
    void requestRoutes(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  function setOption(k: "avoidHighways" | "avoidUnpaved" | "avoidCheckpoints") {
    const next = { ...getState().settings, [k]: !getState().settings[k] };
    setState({ settings: next });
    void saveSettings(next);
    void requestRoutes();
  }

  async function addStop(p: Place) {
    const stops = [...getState().stops, p].slice(0, 3);
    setState({ stops, sheet: null });
    const s = getState();
    if (s.mode === "preview") return void requestRoutes();
    if (s.mode !== "navigating" || !s.trip || !navFix) return;
    // On a trip: new route from here through the stops.
    try {
      const res = await api.route(navFix.coord, s.trip.destination.coord, {
        alternatives: false, avoidReportIds: s.trip.avoidReportIds, travel: s.trip.route.travel ?? "car",
        via: stops.map((x) => x.coord), avoid: routeAvoid(),
      });
      const cur = getState().trip;
      if (cur && res.routes[0]) {
        setState({ trip: { ...cur, route: res.routes[0] } });
        toast(t.nav.rerouted, "ok");
      }
    } catch (e) {
      toast(e instanceof ApiError && e.isNetwork ? t.status.offline : t.common.retry, "error");
    }
  }

  function removeStop(i: number) {
    setState((st) => ({ stops: st.stops.filter((_, j) => j !== i) }));
    void requestRoutes();
  }

  function openParked() {
    const p = getState().parked;
    if (!p) return;
    pickPlace({ id: "parked", name: t.x.parked.title, kind: "parked", coord: p.coord, secondary: fmt(t.x.parked.ago, { time: fmtClock(new Date(p.at), fmtCtx) }) }, false);
  }

  function startNavigation(asDemo = false) {
    // Must run inside the tap, before anything async: lets iPhone Safari speak later prompts.
    primeVoice(getState().settings.lang);
    enableCompass(); // iPhone asks once, and only from a tap: lets the arrow turn with the phone
    const s = getState();
    const route = s.preview.result?.routes[s.preview.selectedIdx];
    if (!route || !s.selected) return;
    setDemo(asDemo);
    const tripState = { route, destination: s.selected, startedAt: Date.now(), paused: false, muted: false, avoidReportIds: s.preview.avoidReportIds };
    setState({ trip: tripState, mode: "navigating" });
    setFollowing(true);
    // A demo isn't a real trip: don't offer to resume it next time.
    if (!asDemo) void saveTrip({ route, destination: s.selected, startedAt: tripState.startedAt, avoidReportIds: tripState.avoidReportIds });
  }

  function endTrip() {
    const s = getState();
    // Arrived by car (a real trip): remember where you parked.
    if (s.mode === "arrived" && !demo && s.trip && s.trip.route.travel !== "walk") {
      const p = { coord: fix?.coord ?? s.trip.destination.coord, at: Date.now() };
      setState({ parked: p });
      void saveParked(p);
      toast(t.x.parked.saved, "ok");
    }
    if (s.share) {
      void api.shareUpdate(s.share.id, s.share.secret, { coord: fix?.coord ?? s.trip?.destination.coord ?? [0, 0], heading: null, etaS: 0, remainingM: 0, ended: true }).catch(() => {});
    }
    setDemo(false);
    void saveTrip(null);
    setState({ trip: null, mode: "browse", selected: null, stops: [], share: null, limits: null, preview: { loading: false, error: null, result: null, selectedIdx: 0, avoidReportIds: [] } });
  }

  function onRegionChange(bbox: [number, number, number, number], zoom: number, byUser: boolean) {
    if (byUser && getState().mode === "navigating") setFollowing(false);
    if (zoom < REPORT_MIN_ZOOM || online === false) return;
    // Snap to a ~1 km grid and skip refetches of the same area to save mobile data.
    const snapped = bbox.map((v, i) => (i < 2 ? Math.floor(v * 100) / 100 : Math.ceil(v * 100) / 100)) as [number, number, number, number];
    if (snapped[2] - snapped[0] > 2 || snapped[3] - snapped[1] > 2) return;
    const key = snapped.join(",");
    if (key === lastBBox.current) return;
    lastBBox.current = key;
    lastArea.current = snapped;
    refreshArea(snapped);
  }

  function refreshArea(area: [number, number, number, number]) {
    api.reports(area).then((r) => mergeReports(r.reports)).catch(() => {});
    if (getState().config?.sharedTraffic) api.traffic(area).then(setJams).catch(() => {});
  }

  // Reports and traffic change while the map sits still: refresh the visible area every 2 minutes.
  useEffect(() => {
    const id = setInterval(() => {
      if (lastArea.current && online !== false && getState().mode !== "navigating") refreshArea(lastArea.current);
    }, 120_000);
    return () => clearInterval(id);
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- render
  if (!config) {
    return (
      <View style={[s.center, { backgroundColor: theme.bg }]}>
        <StatusBar style={theme.dark ? "light" : "dark"} />
        <Icon name="map-search-outline" size={56} color={theme.primary} />
        <Txt size={22} weight="bold" style={{ color: theme.primary }}>{t.appName}</Txt>
        {configError ? (
          <>
            <Txt muted style={{ textAlign: "center", paddingHorizontal: 32 }}>{online === false ? t.status.offline : t.status.serverUnreachable}</Txt>
            <Txt size={12} muted style={{ textAlign: "center" }}>{API_URL}</Txt>
            <Btn label={t.common.retry} icon="refresh" onPress={loadConfig} />
          </>
        ) : <ActivityIndicator color={theme.primary} />}
      </View>
    );
  }

  // Driving is always on the dark map (easier on the eyes, makes the route and arrow pop).
  // Satellite: photos with the roads and names on top (same day or night).
  const styleUrl = satellite
    ? `${config.map.styleDay.split("#")[0]}#sat`
    : theme.dark || mode === "navigating" ? config.map.styleNight : config.map.styleDay;
  const toggleSatellite = () => {
    const next = { ...getState().settings, satellite: !satellite };
    setState({ settings: next });
    void saveSettings(next);
  };
  const selectedIdx = mode === "preview" ? preview.selectedIdx : 0;
  const showSearchBar = mode === "browse" || mode === "place";
  const pillTop = insets.top + 80;

  return (
    <UiOverride dark={mode === "navigating"}>
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.dark || mode === "navigating" ? "light" : "dark"} />
      <MapCanvas
        ref={map}
        styleUrl={styleUrl}
        follow={mode === "navigating" ? (following ? "navigation" : "none") : "none"}
        routes={mapRoutes}
        selectedRouteIdx={selectedIdx}
        destination={mapDestination}
        reports={reportList}
        initialCenter={initialCenter.current}
        onLongPress={onMapLongPress}
        onReportPress={onMapReportPress}
        onRegionChange={onMapRegionChange}
        onRoutePress={onMapRoutePress}
        simFix={mode === "navigating" && demo ? demoFix : null}
        jams={mode === "browse" || mode === "place" ? jams : NO_JAMS}
        traveled={mode === "navigating"}
        parked={mode === "navigating" ? null : parked?.coord ?? null}
        friend={friend}
      />

      {showSearchBar && <SearchBar onFocus={() => setState({ mode: "search" })} onSettings={() => setState({ sheet: "settings" })} />}
      {mode !== "navigating" && <ConnectionPill online={online} top={pillTop} />}
      {mode === "browse" && loc.permission === "granted" && !fix && online !== false && <LocatingPill top={pillTop} />}

      {(mode === "browse" || mode === "place") && !watch && (
        <View style={[s.fab, { bottom: insets.bottom + (mode === "place" ? 300 : 28) }]}>
          <RoundBtn icon="alarm-light-outline" label={t.x.sos.title} onPress={() => setState({ sheet: "sos" })} />
          {parked && mode === "browse" && <RoundBtn icon="car-back" label={t.x.parked.title} onPress={openParked} />}
          <RoundBtn icon={satellite ? "map-outline" : "satellite-variant"} label={satellite ? t.settings.mapView : t.settings.satellite} onPress={toggleSatellite} />
          {loc.permission === "granted" && fix && <>
            <RoundBtn icon="alert-plus" label={t.reports.title} onPress={() => setState({ sheet: "report", openReportId: null })} />
            <RoundBtn icon="crosshairs-gps" label={t.nav.recenter} onPress={() => { enableCompass(); map.current?.flyTo(fix.coord, 15); }} />
          </>}
        </View>
      )}

      {mode === "browse" && !sheet && !openReportId && !watch && (
        <PermissionPanel state={loc.permission} onAllow={loc.request} onOpenSettings={loc.openSettings} />
      )}

      {mode === "place" && selected && !sheet && !openReportId && (
        <PlaceSheet
          place={selected}
          userCoord={fix?.coord ?? null}
          lookingUp={lookingUp}
          onDirections={() => requestRoutes([])}
          onClose={() => setState({ mode: "browse", selected: null })}
          onWalkTo={() => setTravel("walk")}
          onForgetParked={() => { setState({ parked: null, mode: "browse", selected: null }); void saveParked(null); }}
          onMapProblem={() => setState({ sheet: "mapProblem" })}
        />
      )}

      {mode === "preview" && !openReportId && (
        preview.error === "no_location"
          ? <PermissionPanel state={loc.permission === "granted" ? "unknown" : loc.permission} onAllow={loc.request} onOpenSettings={loc.openSettings} />
          : <RoutePreview
              canStart={loc.permission === "granted" && !!fix}
              onStart={() => startNavigation(false)}
              onDemo={() => startNavigation(true)}
              onBack={() => setState({ mode: "place" })}
              onRetry={() => requestRoutes()}
              onToggleAvoid={toggleAvoid}
              onTravel={setTravel}
              onAddStop={() => setState({ sheet: "stopSearch" })}
              onRemoveStop={removeStop}
              onOption={setOption}
            />
      )}

      {mode === "navigating" && trip && !sheet && !openReportId && (
        <NavHud
          route={trip.route}
          g={guidance}
          reroute={reroute}
          online={online}
          paused={trip.paused}
          muted={trip.muted}
          following={following}
          speedMps={speedRef.current}
          onExit={endTrip}
          onPauseToggle={() => setState({ trip: { ...trip, paused: !trip.paused } })}
          onMuteToggle={() => { stopSpeaking(); setState({ trip: { ...trip, muted: !trip.muted } }); }}
          onReport={() => setState({ sheet: "report" })}
          onRecenter={() => setFollowing(true)}
          onMenu={() => setState({ sheet: "navMenu" })}
          limitKmh={limitKmh}
          ahead={ahead ? { report: ahead.item, distanceM: ahead.distanceM } : null}
          sharing={!!share}
        />
      )}

      {mode === "arrived" && selected && <ArrivalSheet destination={selected} onDone={endTrip} />}

      {mode === "search" && <SearchPanel online={online} userCoord={fix?.coord ?? null} onPick={(p) => pickPlace(p)} onSettings={() => setState({ sheet: "settings" })} />}

      {sheet === "report" && <ReportSheet fix={fix} online={online} onClose={() => setState({ sheet: null })} />}
      {sheet === "settings" && (
        <SettingsSheet
          onClose={() => setState({ sheet: null })}
          onDownloadArea={(cb) => map.current?.downloadVisible(cb) ?? Promise.resolve("failed")}
        />
      )}
      {openReportId && <ReportDetails id={openReportId} onClose={() => setState({ openReportId: null })} />}
      {sheet === "sos" && <SosSheet coord={navFix?.coord ?? fix?.coord ?? null} onClose={() => setState({ sheet: null })} />}
      {sheet === "navMenu" && (
        <NavMenuSheet
          onClose={() => setState({ sheet: null })}
          onShare={() => void toggleShare()}
          onAddStop={() => setState({ sheet: "stopSearch" })}
          onSos={() => setState({ sheet: "sos" })}
        />
      )}
      {sheet === "mapProblem" && selected && <MapProblemSheet at={selected.coord} onClose={() => setState({ sheet: null })} />}
      {sheet === "stopSearch" && (
        <SearchPanel
          online={online}
          userCoord={navFix?.coord ?? fix?.coord ?? null}
          title={t.x.stops.picking}
          onPick={(p) => void addStop(p)}
          onClose={() => setState({ sheet: null })}
          onSettings={() => {}}
        />
      )}
      {watch && mode === "browse" && !sheet && (
        <WatchCard onClose={() => { fittedWatch.current = false; setState({ watch: null }); }} />
      )}

      {config.mode === "direct" && !config.sharedReports && mode !== "navigating" && (
        <View pointerEvents="none" style={[s.sample, { top: insets.top + 72, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 }]}>
          <Txt size={11} weight="semibold" muted>{t.status.webPreview}</Txt>
        </View>
      )}
      {mode === "navigating" && demo && (
        <View pointerEvents="none" style={[s.sample, { top: insets.top + 4, backgroundColor: theme.accent }]}>
          <Txt size={11} weight="bold" style={{ color: theme.onAccent }}>{t.nav.demo}</Txt>
        </View>
      )}
      {config.sampleData && (
        <View pointerEvents="none" style={[s.sample, { top: insets.top + (mode === "navigating" ? 4 : 72), backgroundColor: theme.accent }]}>
          <Txt size={11} weight="bold" style={{ color: theme.onAccent }}>{t.reports.sample}</Txt>
        </View>
      )}
      <Toast />
    </View>
    </UiOverride>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  fab: { position: "absolute", end: 14, gap: 12 },
  sample: { position: "absolute", start: 14, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
});
