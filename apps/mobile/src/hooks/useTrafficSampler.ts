import { useEffect, useMemo, useRef } from "react";
import * as Crypto from "expo-crypto";
import { TrafficSampler, type GuidanceState, type SpeedSample } from "@darbna/core";
import { api } from "../api";
import type { ApiRoute } from "../types";

const MAX_AGE_MS = 15 * 60_000;

/**
 * Live traffic contribution: while navigating, turns guidance progress into anonymous speed
 * samples (see core/traffic.ts) and uploads them once a minute. Samples that can't be sent
 * within 15 minutes are dropped — old traffic is useless and not worth keeping.
 */
export function useTrafficSampler(route: ApiRoute | null, g: GuidanceState | null, tripKey: number | null, active: boolean) {
  const sampler = useMemo(() => (route ? new TrafficSampler(route) : null), [route?.id, route?.geometry]); // eslint-disable-line react-hooks/exhaustive-deps
  // Random per trip, never stored: lets the database count distinct cars without knowing who.
  const tripId = useMemo(() => (tripKey ? Crypto.randomUUID() : ""), [tripKey]);
  const queue = useRef<{ s: SpeedSample; t: number }[]>([]);
  const sending = useRef(false);

  useEffect(() => {
    if (!active || !sampler || !g) return;
    if (g.status !== "on_route") return sampler.reset();
    const s = sampler.feed(g.distanceAlongM, Date.now());
    if (s) queue.current.push({ s, t: Date.now() });
  }, [g, active, sampler]);

  useEffect(() => {
    if (!active || !tripId) return;
    const flush = async () => {
      if (sending.current) return;
      queue.current = queue.current.filter((x) => Date.now() - x.t < MAX_AGE_MS);
      const batch = queue.current.slice(0, 40);
      if (!batch.length) return;
      sending.current = true;
      try {
        await api.trafficSubmit(tripId, batch.map((x) => x.s));
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
      void flush(); // trip ended: send what's left
    };
  }, [active, tripId]);
}
