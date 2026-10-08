import type { LngLat, ReportCategory, ReportSource, Route, RoutingTreatment } from "@darbna/core";

export interface Place {
  id: string;
  name: string;
  secondary?: string;
  kind: string;
  coord: LngLat;
  /** 'seed_unverified' places get an "approximate" label in the UI. */
  quality?: string;
  source?: string;
}

export interface PublicReport {
  id: string;
  category: ReportCategory;
  source: ReportSource;
  verified: boolean;
  coord: LngLat;
  heading: number | null;
  createdAt: string;
  expiresAt: string;
  confirms: number;
  gone: number;
  confidence: number;
  treatment: RoutingTreatment;
  isSample: boolean;
  officialRef?: string;
}

export interface ApiRoute extends Route {
  reportIdsOnRoute: string[];
}

export interface RouteResult {
  routes: ApiRoute[];
  reports: PublicReport[];
  avoidance: { requested: boolean; honoured: boolean; providerSupportsIt: boolean };
  generatedAt: string;
}

export interface ServerConfig {
  map: { styleDay: string; styleNight: string; attribution: string };
  routing: { provider: string; traffic: boolean; avoidsVerifiedClosures: boolean };
  features: { offlineMapDisplay: boolean; offlineRouting: boolean; liveTraffic: boolean };
  sampleData: boolean;
  /** "direct" = web preview talking to public services with no Darbna server. */
  mode?: "server" | "direct";
}
