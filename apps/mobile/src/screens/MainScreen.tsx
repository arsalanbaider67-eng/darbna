import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, StyleSheet, View } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { haversine, parseSharedLocation, type LngLat, type TrafficCell } from "@darbna/core";
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
import { fmt } from "../i18n";
import { primeVoice, stopSpeaking } from "../nav/prompt";
import { useDemoDrive } from "../hooks/useDemoDrive";
import { useTrafficSampler } from "../hooks/useTrafficSampler";
import { useGuidance } from "../nav/useGuidance";
import { loadCachedConfig, loadTrip, saveCachedConfig, saveRecents, saveSettings, saveTrip } from "../storage";
import { getState, mergeReports, setState, useStore } from "../store";
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
  useTrafficSampler(tripRoute ?? null, guidance, trip?.startedAt ?? null, mode === "navigating" && !demo && shareTraffic !== false && !!config?.sharedTraffic);

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
    setState({ selected: p, mode: "place", preview: { ...getState().preview, result: null, error: null } });
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
      const res = await api.route(fix.coord, dest.coord, { avoidReportIds: avoidIds });
      mergeReports(res.reports);
      setState({ preview: { loading: false, error: null, result: res, selectedIdx: 0, avoidReportIds: avoidIds } });
      const pts = res.routes.flatMap((r) => [r.geometry[0], r.geometry[Math.floor(r.geometry.length / 2)], r.geometry[r.geometry.length - 1]]);
      map.current?.fitTo(pts, 380);
    } catch (e) {
      const code = e instanceof ApiError ? (e.isNetwork ? "offline" : e.code) : "generic";
      setState({ preview: { loading: false, error: code, result: null, selectedIdx: 0, avoidReportIds: avoidIds } });
    }
  }

  function toggleAvoid(id: string) {
    const cur = getState().preview.avoidReportIds;
    void requestRoutes(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
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
    setDemo(false);
    void saveTrip(null);
    setState({ trip: null, mode: "browse", selected: null, preview: { loading: false, error: null, result: null, selectedIdx: 0, avoidReportIds: [] } });
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
      />

      {showSearchBar && <SearchBar onFocus={() => setState({ mode: "search" })} onSettings={() => setState({ sheet: "settings" })} />}
      {mode !== "navigating" && <ConnectionPill online={online} top={pillTop} />}
      {mode === "browse" && loc.permission === "granted" && !fix && online !== false && <LocatingPill top={pillTop} />}

      {(mode === "browse" || mode === "place") && (
        <View style={[s.fab, { bottom: insets.bottom + (mode === "place" ? 240 : 28) }]}>
          <RoundBtn icon={satellite ? "map-outline" : "satellite-variant"} label={satellite ? t.settings.mapView : t.settings.satellite} onPress={toggleSatellite} />
          {loc.permission === "granted" && fix && <>
            <RoundBtn icon="alert-plus" label={t.reports.title} onPress={() => setState({ sheet: "report", openReportId: null })} />
            <RoundBtn icon="crosshairs-gps" label={t.nav.recenter} onPress={() => { enableCompass(); map.current?.flyTo(fix.coord, 15); }} />
          </>}
        </View>
      )}

      {mode === "browse" && !sheet && !openReportId && (
        <PermissionPanel state={loc.permission} onAllow={loc.request} onOpenSettings={loc.openSettings} />
      )}

      {mode === "place" && selected && !sheet && !openReportId && (
        <PlaceSheet
          place={selected}
          userCoord={fix?.coord ?? null}
          lookingUp={lookingUp}
          onDirections={() => requestRoutes([])}
          onClose={() => setState({ mode: "browse", selected: null })}
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
