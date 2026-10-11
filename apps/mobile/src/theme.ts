import { Platform } from "react-native";
import type { ReportCategory } from "@darbna/core";

/**
 * Darbna identity (brand guide v1.0, 11 Oct 2026): Darbna Purple #21194A, Darbna Yellow #FFD25E,
 * Darbna White #FFF5EF. Inside the app: warm-white panels and map, purple text and controls, your
 * arrow and route in purple. Yellow only ever sits on purple (never on white: 1.34:1).
 * Safety colours (danger red, warning amber, traffic, report categories, the grey driven route)
 * stay as they are: they carry meaning, not branding.
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
  /** Floating buttons and pills over the map. */
  glass: string;
  /** Bottom panels. */
  glassPanel: string;
  /** Selected row / lane highlight. */
  highlight: string;
}

export const BRAND = { purple: "#21194A", yellow: "#FFD25E", white: "#FFF5EF" } as const;

export const brand: Theme = {
  dark: false,
  bg: BRAND.white,
  surface: BRAND.white,
  surfaceAlt: "#F5E9E1",
  text: BRAND.purple,
  textMuted: "#5B5478",
  border: "#E4D6CC",
  primary: BRAND.purple,
  onPrimary: BRAND.white,
  accent: BRAND.yellow,
  onAccent: BRAND.purple,
  danger: "#D92D20",
  warn: "#B54708",
  ok: "#1E7A4C",
  route: BRAND.purple,
  routeCasing: BRAND.white,
  routeAlt: "#9A93B5",
  banner: BRAND.white,
  onBanner: BRAND.purple,
  shadow: BRAND.purple,
  puck: BRAND.purple,
  driven: "#B7B0AB",
  glass: "rgba(255,245,239,0.94)",
  glassPanel: "rgba(255,245,239,0.98)",
  highlight: "rgba(33,25,74,0.08)",
};

// One look (brand guide v1.0) day and night; names kept for older imports.
export const gold = brand;
export const day = brand;
export const night = brand;

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
