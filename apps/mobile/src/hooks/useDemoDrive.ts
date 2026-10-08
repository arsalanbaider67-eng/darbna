import { useEffect, useMemo, useRef, useState } from "react";
import { cumulativeDistances, pointAlong, type LngLat, type LocationFix } from "@darbna/core";

/** Driving speed for the demo: the route's own average, kept between 40 and 70 km/h. */
function demoSpeed(distanceM: number, durationS: number): number {
  const avg = durationS > 0 ? distanceM / durationS : 12;
  return Math.max(11, Math.min(19.4, avg));
}

/**
 * Demo drive: produces a simulated GPS fix once a second, moving along `geometry` at a
 * realistic speed, so guidance, voice and the map can be tried without moving.
 * Returns null when inactive. Paused trips stand still.
 */
export function useDemoDrive(geometry: LngLat[] | null, distanceM: number, durationS: number, active: boolean, paused: boolean): LocationFix | null {
  const cum = useMemo(() => (geometry && geometry.length > 1 ? cumulativeDistances(geometry) : null), [geometry]);
  const [fix, setFix] = useState<LocationFix | null>(null);
  const travelled = useRef(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // A new route (reroute) starts from its beginning, which is where the car already is.
  useEffect(() => { travelled.current = 0; }, [geometry]);

  useEffect(() => {
    if (!active || !geometry || !cum) {
      setFix(null);
      return;
    }
    const speed = demoSpeed(distanceM, durationS);
    const total = cum[cum.length - 1];
    const emit = () => {
      const { p, brg } = pointAlong(geometry, cum, travelled.current);
      const moving = !pausedRef.current && travelled.current < total;
      setFix({ coord: p, accuracyM: 5, speedMps: moving ? speed : 0, headingDeg: brg, timestamp: Date.now() });
    };
    emit();
    const id = setInterval(() => {
      if (!pausedRef.current) travelled.current = Math.min(total, travelled.current + speed);
      emit();
    }, 1000);
    return () => clearInterval(id);
  }, [active, geometry, cum]); // eslint-disable-line react-hooks/exhaustive-deps

  return active ? fix : null;
}
