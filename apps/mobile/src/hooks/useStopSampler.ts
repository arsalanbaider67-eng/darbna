import { useEffect, useMemo, useRef } from "react";
import * as Crypto from "expo-crypto";
import { StopDetector, type LocationFix, type StopEvent } from "@darbna/core";
import { api } from "../api";

/**
 * Traffic lights learned from drivers: while navigating by car, notices where you stand still for
 * a red light (core/signals.ts) and uploads those spots anonymously once a minute. Nothing is sent
 * from the first or last 300 m of a trip; stops that can't be sent within a day are dropped.
 */
export function useStopSampler(fix: LocationFix | null, tripKey: number | null, active: boolean) {
  const detector = useMemo(() => new StopDetector(), [tripKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const tripId = useMemo(() => (tripKey ? Crypto.randomUUID() : ""), [tripKey]);
  const queue = useRef<{ s: StopEvent; t: number }[]>([]);
  const sending = useRef(false);

  useEffect(() => {
    if (!active || !fix || fix.accuracyM > 30) return;
    detector.feed({ coord: fix.coord, speedMps: fix.speedMps, headingDeg: fix.headingDeg, t: fix.timestamp });
  }, [fix, active, detector]);

  useEffect(() => {
    if (!active || !tripId) return;
    const flush = async () => {
      for (const s of detector.take()) queue.current.push({ s, t: Date.now() });
      if (sending.current) return;
      queue.current = queue.current.filter((x) => Date.now() - x.t < 86_400_000);
      const batch = queue.current.slice(0, 30);
      if (!batch.length) return;
      sending.current = true;
      try {
        await api.stopSubmit(tripId, batch.map((x) => x.s));
        queue.current = queue.current.slice(batch.length);
      } catch {
        // offline or rate-limited: keep for the next attempt
      } finally {
        sending.current = false;
      }
    };
    const id = setInterval(flush, 60_000);
    return () => {
      clearInterval(id);
      void flush(); // trip ended: send what's ready (the last stop of the trip never is)
    };
  }, [active, tripId, detector]);
}
