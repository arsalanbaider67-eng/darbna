import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import * as Location from "expo-location";
import { FixFilter, type LocationFix } from "@darbna/core";

export type PermissionState = "unknown" | "granted" | "denied" | "blocked" | "services_off";
export type LocationMode = "idle" | "navigation";

/**
 * One foreground location watcher for the whole app.
 *  - idle: high (GPS) accuracy, every 2 s / 3 m, so the dot sits where you really are.
 *  - navigation: best accuracy, every second.
 * Stops entirely when the app is backgrounded (no background tracking outside navigation;
 * background navigation is not implemented yet — see docs/STATUS.md).
 */
export function useLocation(mode: LocationMode) {
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const sub = useRef<Location.LocationSubscription | null>(null);
  const filter = useRef(new FixFilter());

  const check = useCallback(async () => {
    const services = await Location.hasServicesEnabledAsync().catch(() => true);
    if (!services) return setPermission("services_off");
    const p = await Location.getForegroundPermissionsAsync();
    setPermission(p.granted ? "granted" : p.canAskAgain ? (p.status === "undetermined" ? "unknown" : "denied") : "blocked");
  }, []);

  const request = useCallback(async () => {
    const p = await Location.requestForegroundPermissionsAsync();
    if (p.granted) {
      const services = await Location.hasServicesEnabledAsync().catch(() => true);
      setPermission(services ? "granted" : "services_off");
    } else setPermission(p.canAskAgain ? "denied" : "blocked");
  }, []);

  const openSettings = useCallback(() => Linking.openSettings(), []);

  useEffect(() => {
    void check();
    const s = AppState.addEventListener("change", (st) => {
      setAppActive(st === "active");
      if (st === "active") void check(); // user may have changed permission in Settings
    });
    return () => s.remove();
  }, [check]);

  useEffect(() => {
    if (permission !== "granted" || !appActive) return;
    let cancelled = false;
    const nav = mode === "navigation";
    (async () => {
      // Show something fast from the OS cache, then refine.
      if (!fix) {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 }).catch(() => null);
        if (last && !cancelled) setFix(toFix(last));
      }
      sub.current = await Location.watchPositionAsync(
        nav
          ? { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }
          : { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 3 },
        (loc) => {
          if (cancelled) return;
          const f = toFix(loc);
          // Skip rough fixes that land 10+ m away from the good ones around them.
          if (filter.current.accept({ coord: f.coord, accuracyM: f.accuracyM, at: Date.now() })) setFix(f);
        },
      );
      if (cancelled) sub.current.remove();
    })().catch(() => setPermission("services_off"));
    return () => {
      cancelled = true;
      sub.current?.remove();
      sub.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission, mode, appActive]);

  return { permission, fix, request, openSettings };
}

function toFix(l: Location.LocationObject): LocationFix {
  return {
    coord: [l.coords.longitude, l.coords.latitude],
    accuracyM: l.coords.accuracy ?? 100,
    speedMps: l.coords.speed,
    headingDeg: l.coords.heading,
    timestamp: l.timestamp,
  };
}
