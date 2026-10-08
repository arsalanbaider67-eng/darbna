import { useCallback, useEffect, useRef, useState } from "react";
import type { LocationFix } from "@darbna/core";
import type { LocationMode, PermissionState } from "./useLocation";

export type { LocationMode, PermissionState } from "./useLocation";

/**
 * Browser version of useLocation: talks to navigator.geolocation directly (more predictable on
 * iPhone Safari than a shim). Same return shape as the native hook.
 * Geolocation only works on https pages — GitHub Pages is https.
 */
export function useLocation(mode: LocationMode) {
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [visible, setVisible] = useState(typeof document === "undefined" || document.visibilityState === "visible");
  const watchId = useRef<number | null>(null);
  const supported = typeof navigator !== "undefined" && !!navigator.geolocation;

  const onPos = useCallback((p: GeolocationPosition) => {
    setPermission("granted");
    setFix({
      coord: [p.coords.longitude, p.coords.latitude],
      accuracyM: p.coords.accuracy ?? 100,
      speedMps: p.coords.speed,
      headingDeg: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
      timestamp: p.timestamp || Date.now(),
    });
  }, []);

  const onErr = useCallback((e: GeolocationPositionError) => {
    // 1 = denied: a web page can't ask again; the user must allow it in Safari's settings.
    if (e.code === 1) setPermission("blocked");
    else if (e.code === 2) setPermission((p) => (p === "granted" ? p : "services_off"));
    // 3 = timeout: keep waiting, the watcher continues.
  }, []);

  // Already allowed earlier? Start without prompting (Safari 16+ and Chrome support this query).
  useEffect(() => {
    if (!supported) return setPermission("services_off");
    const perms = (navigator as any).permissions;
    perms?.query?.({ name: "geolocation" })
      .then((st: PermissionStatus) => {
        if (st.state === "granted") setPermission("granted");
        else if (st.state === "denied") setPermission("blocked");
        st.onchange = () => setPermission(st.state === "granted" ? "granted" : st.state === "denied" ? "blocked" : "unknown");
      })
      .catch(() => {});
  }, [supported]);

  const request = useCallback(async () => {
    if (!supported) return;
    navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 });
  }, [supported, onPos, onErr]);

  const openSettings = useCallback(() => {
    // Browsers can't open their own settings; asking again is the most a page can do.
    void request();
  }, [request]);

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (permission !== "granted" || !visible || !supported) return;
    const nav = mode === "navigation";
    watchId.current = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: nav,
      maximumAge: nav ? 0 : 5000,
      timeout: 30_000,
    });
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [permission, mode, visible, supported, onPos, onErr]);

  return { permission, fix, request, openSettings };
}
