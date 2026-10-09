import {
  decodePolyline, mapValhallaResponse, valhallaErrorCode, valhallaRouteBody,
  type LngLat, type ManeuverKind, type Route, type RouteStep, type ValhallaResponse,
} from "@darbna/core";

export { mapValhallaTrip, type ValhallaResponse } from "@darbna/core";

export interface RouteRequest {
  origin: LngLat;
  destination: LngLat;
  /** Current heading at origin (degrees), used on reroute so the engine doesn't start with a U-turn. */
  originHeading?: number;
  alternatives: boolean;
  /** Closed rings to route around (verified closures, or reports the driver chose to avoid). */
  excludePolygons: LngLat[][];
}

export type RoutingErrorCode = "no_route" | "off_network" | "unavailable" | "timeout";
export class RoutingError extends Error {
  constructor(public code: RoutingErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface RoutingProvider {
  readonly name: string;
  /** Whether excludePolygons is honoured. */
  readonly supportsExclusions: boolean;
  route(req: RouteRequest): Promise<Route[]>;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if ((e as Error).name === "TimeoutError") throw new RoutingError("timeout");
    throw new RoutingError("unavailable", (e as Error).message);
  }
}

export class ValhallaProvider implements RoutingProvider {
  readonly name = "valhalla";
  readonly supportsExclusions = true;
  constructor(private baseUrl: string, private timeoutMs: number) {}

  /** Retries "no path" answers with stricter snapping (see ValhallaRouteInput.snap). */
  async route(r: RouteRequest): Promise<Route[]> {
    let last: unknown;
    for (const snap of ["default", "connected", "main", "major"] as const) {
      try {
        return await this.routeOnce(r, snap);
      } catch (e) {
        last = e;
        if (!(e instanceof RoutingError && (e.code === "no_route" || e.code === "off_network"))) throw e;
      }
    }
    throw last;
  }

  private async routeOnce(r: RouteRequest, snap: "default" | "connected" | "main" | "major"): Promise<Route[]> {
    const body = valhallaRouteBody({ ...r, snap });
    const res = await fetchWithTimeout(`${this.baseUrl}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, this.timeoutMs);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error_code?: number; error?: string };
      const code = valhallaErrorCode(err);
      throw new RoutingError(code, code === "unavailable" ? `valhalla ${res.status} ${err.error ?? ""}` : err.error);
    }
    return mapValhallaResponse((await res.json()) as ValhallaResponse);
  }
}

// ---------------------------------------------------------------- OSRM
// Drop-in alternative. Note: OSRM cannot exclude arbitrary polygons, so verified
// closures are NOT avoided with this provider — the route response says so.
const OSRM_MOD: Record<string, ManeuverKind> = {
  "straight": "straight", "slight right": "slight_right", "right": "right", "sharp right": "sharp_right",
  "uturn": "uturn", "sharp left": "sharp_left", "left": "left", "slight left": "slight_left",
};
export class OsrmProvider implements RoutingProvider {
  readonly name = "osrm";
  readonly supportsExclusions = false;
  constructor(private baseUrl: string, private timeoutMs: number) {}
  async route(r: RouteRequest): Promise<Route[]> {
    const coords = `${r.origin[0]},${r.origin[1]};${r.destination[0]},${r.destination[1]}`;
    const url = `${this.baseUrl}/route/v1/driving/${coords}?overview=full&geometries=polyline6&steps=true&alternatives=${r.alternatives}`;
    const res = await fetchWithTimeout(url, {}, this.timeoutMs);
    const data = (await res.json().catch(() => ({}))) as any;
    if (data.code === "NoRoute") throw new RoutingError("no_route");
    if (data.code === "NoSegment") throw new RoutingError("off_network");
    if (!res.ok || data.code !== "Ok") throw new RoutingError("unavailable", `osrm ${res.status}`);
    return data.routes.map((rt: any, i: number) => {
      const geometry = decodePolyline(rt.geometry, 6);
      const steps: RouteStep[] = [];
      let cursor = 0;
      for (const s of rt.legs[0].steps) {
        const sg = decodePolyline(s.geometry, 6);
        const t = s.maneuver.type as string;
        const kind: ManeuverKind =
          t === "depart" ? "depart" : t === "arrive" ? "arrive" :
          t === "roundabout" || t === "rotary" ? "roundabout" :
          t === "merge" ? "merge" :
          OSRM_MOD[s.maneuver.modifier] ?? "straight";
        steps.push({
          index: steps.length, kind, shapeIndex: cursor,
          location: [s.maneuver.location[0], s.maneuver.location[1]],
          distanceM: Math.round(s.distance), durationS: Math.round(s.duration),
          streetName: s.name || undefined, roundaboutExit: s.maneuver.exit,
        });
        cursor += Math.max(0, sg.length - 1);
      }
      return {
        id: `o${Date.now().toString(36)}-${i}`, provider: "osrm",
        distanceM: Math.round(rt.distance), durationS: Math.round(rt.duration),
        durationSource: "engine_no_traffic", geometry, steps,
        via: [...new Set(steps.filter((s) => s.streetName).sort((a, b) => b.distanceM - a.distanceM).map((s) => s.streetName!))].slice(0, 2),
      } satisfies Route;
    });
  }
}
