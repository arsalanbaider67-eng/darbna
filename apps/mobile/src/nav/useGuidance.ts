import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { GuidanceEngine, WALKING_GUIDANCE_OPTIONS, type GuidanceState, type LocationFix } from "@darbna/core";
import { api, ApiError } from "../api";
import { instructionText, strings, type FormatCtx } from "../i18n";
import { saveTrip } from "../storage";
import { getState, setState, toast, useStore } from "../store";
import { sayPrompt } from "./prompt";
import { instructionClips } from "./voicePlan";

export type RerouteStatus = "idle" | "requesting" | "offline" | "failed";

/**
 * Binds the pure GuidanceEngine to device location, voice and the network.
 * Guidance itself is entirely on-device; only rerouting needs the server.
 */
export function useGuidance(fix: LocationFix | null, online: boolean | null, fmtCtx: FormatCtx) {
  const trip = useStore((s) => s.trip);
  const routeId = trip?.route.id;
  // Browsers report position less regularly than native GPS, so wait longer before "GPS lost".
  const engine = useMemo(() => (trip ? new GuidanceEngine(trip.route, {
    ...(trip.route.travel === "walk" ? WALKING_GUIDANCE_OPTIONS : {}),
    ...(Platform.OS === "web" ? { gpsLostMs: 30_000 } : {}),
  }) : null), [routeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [g, setG] = useState<GuidanceState | null>(null);
  const [reroute, setReroute] = useState<RerouteStatus>("idle");
  const busy = useRef(false);
  const lastFix = useRef<LocationFix | null>(null);

  /** `clips`: the recorded-voice version of the same prompt (see voicePlan.ts). */
  async function say(text: (ctx: FormatCtx) => string, clips: string[] | null, urgent = false) {
    const s = getState();
    if (!s.settings.voice || s.trip?.muted || s.trip?.paused) return;
    await sayPrompt(s.settings.lang, (lang) => text({ lang, digits: "western" }), clips, urgent);
  }

  // Opening prompt.
  useEffect(() => {
    if (!engine) return;
    const steps = engine.route.steps;
    const next = steps[1];
    if (next) void say((c) => `${strings(c.lang).maneuver.depart}. ${instructionText(next, steps[0].distanceM, c, true)}`, ["mv_depart", ...instructionClips(next, steps[0].distanceM)]);
  }, [engine]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doReroute(from: LocationFix) {
    if (busy.current || !engine) return;
    const t = getState().trip;
    if (!t) return;
    if (online === false) {
      engine.rerouteFailed(from.timestamp);
      setReroute("offline");
      return;
    }
    busy.current = true;
    setReroute("requesting");
    void say((c) => strings(c.lang).nav.rerouting, ["rerouting"], true);
    try {
      const res = await api.route(from.coord, t.destination.coord, {
        heading: from.headingDeg != null && from.headingDeg >= 0 && (from.speedMps ?? 0) > 2 ? from.headingDeg : undefined,
        alternatives: false,
        avoidReportIds: t.avoidReportIds,
        travel: t.route.travel ?? "car",
      });
      const route = res.routes[0];
      const cur = getState().trip;
      if (cur && route) {
        const next = { ...cur, route };
        setState({ trip: next });
        void saveTrip({ route, destination: cur.destination, startedAt: cur.startedAt, avoidReportIds: cur.avoidReportIds });
        setReroute("idle");
        toast(strings(getState().settings.lang).nav.rerouted, "ok");
      }
    } catch (e) {
      engine.rerouteFailed(Date.now());
      setReroute(e instanceof ApiError && e.isNetwork ? "offline" : "failed");
    } finally {
      busy.current = false;
    }
  }

  // Location updates.
  useEffect(() => {
    if (!engine || !fix || fix === lastFix.current) return;
    lastFix.current = fix;
    const t = getState().trip;
    if (!t || t.paused) return;
    const st = engine.update(fix);
    setG(st);
    if (st.status === "on_route" && reroute !== "idle" && reroute !== "requesting") setReroute("idle");
    if (st.status === "arrived") {
      void say((c) => strings(c.lang).maneuver.arrive, ["mv_arrive"], true);
      void saveTrip(null);
      setState({ mode: "arrived" });
      return;
    }
    if (st.announcement) {
      const a = st.announcement;
      void say((c) => {
        let txt = instructionText(a.step, a.stage === "now" ? null : a.distanceM, c, true);
        if (a.then) txt += `${c.lang === "en" ? ", " : "، "}${strings(c.lang).nav.then} ${instructionText(a.then, null, c, true)}`;
        return txt;
      }, instructionClips(a.step, a.stage === "now" ? null : a.distanceM, a.then), a.stage === "now");
    }
    if (st.shouldReroute) void doReroute(fix);
  }, [fix, engine]); // eslint-disable-line react-hooks/exhaustive-deps

  // Retry a pending reroute as soon as we're back online.
  useEffect(() => {
    if (online && reroute === "offline" && lastFix.current && g?.status === "off_route") void doReroute(lastFix.current);
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect silent GPS.
  useEffect(() => {
    if (!engine) return;
    const id = setInterval(() => {
      const st = engine.tick(Date.now());
      setG((prev) => (prev && prev.status !== st.status ? st : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [engine]);

  return { guidance: g, reroute, engine };
}
