import { Platform } from "react-native";
import type { ReportCategory } from "@darbna/core";

/**
 * Darbna identity: black and gold. A black map, metallic-gold route and arrow, black glass
 * panels with thin gold edges. Danger stays red and warnings amber so they never blend into the gold.
 */
export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
  accent: string;
  onAccent: string;
  danger: string;
  warn: string;
  ok: string;
  route: string;
  routeCasing: string;
  routeAlt: string;
  banner: string;
  onBanner: string;
  shadow: string;
  /** Your arrow on the map. */
  puck: string;
  /** Part of the route already driven. */
  driven: string;
}

export const gold: Theme = {
  dark: true,
  bg: "#070707",
  surface: "#121212",
  surfaceAlt: "#1B1A17",
  text: "#F6F0E1",
  textMuted: "#A99F88",
  border: "#3A3220",
  primary: "#D4AF37",
  onPrimary: "#0A0907",
  accent: "#E6C35C",
  onAccent: "#0A0907",
  danger: "#FF5A4E",
  warn: "#F2A23A",
  ok: "#5BD39A",
  route: "#E2B53E",
  routeCasing: "#2E2408",
  routeAlt: "#5E5643",
  banner: "#121212",
  onBanner: "#F6F0E1",
  shadow: "#000000",
  puck: "#F1C94B",
  driven: "#4A4740",
};

// The app has one look now (black & gold); both names kept for older imports.
export const day = gold;
export const night = gold;

// On the web, fall back to the phone's own font if the downloaded one is blocked or slow
// (Lockdown Mode, in-app browsers), instead of the browser's default serif.
const FALLBACK = Platform.OS === "web" ? ', system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif' : "";
export const font = {
  regular: "NotoSansArabic_400Regular" + FALLBACK,
  semibold: "NotoSansArabic_600SemiBold" + FALLBACK,
  bold: "NotoSansArabic_700Bold" + FALLBACK,
};

/** Minimum touch target: larger than platform minimums, for use in a mounted phone. */
export const TOUCH = 56;

export const REPORT_STYLE: Record<ReportCategory, { icon: string; color: string }> = {
  congestion: { icon: "car-multiple", color: "#D9822B" },
  crash: { icon: "car-emergency", color: "#C62828" },
  closure: { icon: "minus-circle", color: "#7B1F1F" },
  roadworks: { icon: "traffic-cone", color: "#E09A1A" },
  pothole: { icon: "alert-circle-outline", color: "#6D5A3A" },
  flooding: { icon: "waves", color: "#1F6FB2" },
  checkpoint: { icon: "shield-car", color: "#2E7D5B" },
  checkpoint_slow: { icon: "shield-alert", color: "#B4442C" },
  camera: { icon: "cctv", color: "#5B4BB7" },
  fuel_queue: { icon: "gas-station", color: "#C27A12" },
  fuel_closed: { icon: "gas-station-off", color: "#6B6B6B" },
};
