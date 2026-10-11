import type { ExpoConfig } from "expo/config";

// Arabic location-permission text for iOS (wire up via locales/*.json when building iOS).
export const LOCATION_WHY_AR = "يستخدم دربنا موقعك لعرضه على الخريطة وحساب المسار وإرشادك أثناء القيادة. لا يُحفظ مسار رحلتك على خوادمنا.";
const LOCATION_WHY_EN = "Darbna uses your location to show you on the map, calculate routes and guide you while driving. Your trip path is not stored on our servers.";

// Test builds talk to a dev server over plain http on your Wi-Fi. Store builds must use https;
// the http exceptions below are only switched on when the API URL isn't https.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";
const TEST_BUILD = !API_URL.startsWith("https://");

const config: ExpoConfig = {
  // ASCII project name keeps generated Xcode/Gradle project paths simple; the home-screen
  // label is "دربنا" (CFBundleDisplayName on iOS, app_name on Android via withArabicLabel).
  name: "Darbna",
  slug: "darbna",
  scheme: "darbna",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  web: {
    bundler: "metro",
    output: "single",
    name: "دربنا",
    shortName: "دربنا",
    lang: "ar",
    themeColor: "#21194A",
    backgroundColor: "#21194A",
    favicon: "./public/favicon-v3.png",
  },
  // GitHub Pages serves the web build from /<repo>/ — set by the web workflow.
  experiments: process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : undefined,
  // Old architecture for now: fewer native-module surprises with MapLibre on Expo SDK 54.
  newArchEnabled: false,
  ios: {
    bundleIdentifier: "iq.darbna.app",
    // Store builds: GitHub's run number, so every upload has a higher build number.
    buildNumber: process.env.APP_BUILD_NUMBER ?? "1",
    supportsTablet: false,
    infoPlist: {
      CFBundleDisplayName: "دربنا",
      NSLocationWhenInUseUsageDescription: LOCATION_WHY_EN,
      ...(TEST_BUILD
        ? {
            NSAppTransportSecurity: { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true },
            NSLocalNetworkUsageDescription: "Test build: connects to the Darbna server on your Wi-Fi network.",
          }
        : {}),
      CFBundleAllowMixedLocalizations: true,
      CFBundleDevelopmentRegion: "ar",
      // HTTPS only (standard encryption): no export compliance paperwork for App Store uploads.
      ITSAppUsesNonExemptEncryption: false,
      CFBundleLocalizations: ["ar", "ckb", "en"],
    },
  },
  android: {
    // Brand guide v1.0: adaptive icon = symbol on Darbna Purple, plus a monochrome layer.
    adaptiveIcon: { foregroundImage: "./assets/adaptive-foreground.png", monochromeImage: "./assets/adaptive-monochrome.png", backgroundColor: "#21194A" },
    package: "iq.darbna.app",
    versionCode: Number(process.env.APP_BUILD_NUMBER ?? 1),
    permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
    // Opens shared "geo:" locations (WhatsApp/Telegram "open with") directly in Darbna.
    intentFilters: [
      { action: "VIEW", data: [{ scheme: "geo" }], category: ["BROWSABLE", "DEFAULT"] },
      { action: "VIEW", data: [{ scheme: "darbna" }], category: ["BROWSABLE", "DEFAULT"] },
    ],
  },
  plugins: [
    "@maplibre/maplibre-react-native",
    ["expo-location", { locationWhenInUsePermission: LOCATION_WHY_EN }],
    ["expo-localization", { supportsRTL: true }],
    "expo-font",
    // Recorded guidance prompts. No microphone use.
    ["expo-audio", { microphonePermission: false }],
    // Plain http only for test builds (dev server on your LAN); store builds are https-only.
    ["expo-build-properties", { android: { usesCleartextTraffic: TEST_BUILD }, ios: { deploymentTarget: "15.1" } }],
    "./plugins/withReleaseSigning",
    "./plugins/withArabicLabel",
  ],
  extra: {
    supportsRTL: true,
    forcesRTL: false,
  },
  // OTA updates off until an update server is configured; Updates.reloadAsync() still works for the RTL switch.
  updates: { enabled: false },
};

export default config;
