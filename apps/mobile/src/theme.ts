import { Platform } from "react-native";
import type { ReportCategory } from "@darbna/core";

/**
 * Darbna identity: Tigris teal + date-palm gold on warm sand. Calm, high-contrast,
 * nothing cartoonish — the map is the hero.
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
}

export const day: Theme = {
  dark: false,
  bg: "#F4EFE6",
  surface: "#FFFFFF",
  surfaceAlt: "#F7F3EC",
  text: "#14232A",
  textMuted: "#55666C",
  border: "#E1D8C8",
  primary: "#0E5E6F",
  onPrimary: "#FFFFFF",
  accent: "#E0A526",
  onAccent: "#1F1606",
  danger: "#B3261E",
  warn: "#B4551F",
  ok: "#1E7B4D",
  route: "#0E7C93",
  routeCasing: "#0A4A57",
  routeAlt: "#8FA7AE",
  banner: "#0E5E6F",
  onBanner: "#FFFFFF",
  shadow: "#000000",
};

export const night: Theme = {
  dark: true,
  bg: "#0F1A1F",
  surface: "#18262C",
  surfaceAlt: "#1F3036",
  text: "#EAF2F3",
  textMuted: "#9DB2B7",
  border: "#2B3D44",
  primary: "#46B9CC",
  onPrimary: "#04161B",
  accent: "#F2B544",
  onAccent: "#1F1606",
  danger: "#FF7A6E",
  warn: "#FF9F5A",
  ok: "#5BD39A",
  route: "#46B9CC",
  routeCasing: "#0B2A31",
  routeAlt: "#4D646B",
  banner: "#123D47",
  onBanner: "#EAF2F3",
  shadow: "#000000",
};

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
