import type { ExpoConfig } from "expo/config";

// Location permission text. The localized versions (Arabic, Sorani, English) live in locales/*.json
// and are what iPhone users see; this English one is the fallback. It names every use, including
// sharing a report's or a shared trip's location, as App Review requires (guideline 5.1.1).
const LOCATION_WHY_EN = "Darbna uses your location while the app is open to show your position and calculate routes through service providers. Road reports, trip sharing and traffic contribution are optional and can send location to our services and intended recipients. Traffic contribution is off by default.";

// Test builds that talk to a dev server over plain http on your Wi-Fi (EXPO_PUBLIC_API_URL=http://…)
// get the http exceptions below. Everything else, including "direct" mode (store builds: all
// services are https), gets none: no ATS exceptions and no local-network text in the App Store build.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";
const TEST_BUILD = API_URL.startsWith("http://");

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
  // Per-language app name and permission text (ar = default language, ckb = Sorani Kurdish).
  locales: { ar: "./locales/ar.json", ckb: "./locales/ckb.json", en: "./locales/en.json" },
  ios: {
    bundleIdentifier: "iq.darbna.app",
    // Store builds: signing team for the app target (GitHub secret APPLE_TEAM_ID).
    ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
    // Privacy manifest (PrivacyInfo.xcprivacy), required for App Store uploads: no tracking; precise
    // location and a random per-install id are used only to make the app work; the "required reason"
    // system APIs used by React Native, AsyncStorage and the map with Apple's approved reasons.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePreciseLocation",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeDeviceID",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeOtherUserContent",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeEmailAddress", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePhoneNumber", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeOtherUserContactInfo", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
      ],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: ["C617.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime", NSPrivacyAccessedAPITypeReasons: ["35F9.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace", NSPrivacyAccessedAPITypeReasons: ["E174.1"] },
      ],
    },
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
    // "Share → دربنا" from Google Maps, Apple Maps, WhatsApp, Safari… (iOS share extension; on
    // Android, Darbna shows up for shared text and links). The app reads the link and opens the route.
    // Needs the App Group to be signed in, which needs a registered iPhone for the archive signing
    // (see .github/workflows/ios-store.yml); off until then (DARBNA_SHARE_EXTENSION=1 turns it on).
    ...(process.env.DARBNA_SHARE_EXTENSION === "1" ? [["expo-share-intent", {
      iosShareExtensionName: "Darbna Share",
      iosActivationRules: {
        NSExtensionActivationSupportsWebURLWithMaxCount: 1,
        NSExtensionActivationSupportsWebPageWithMaxCount: 1,
        NSExtensionActivationSupportsText: true,
      },
      androidIntentFilters: ["text/*"],
    }] as [string, any]] : []),
  ],
  extra: {
    supportsRTL: true,
    forcesRTL: false,
  },
  // OTA updates off until an update server is configured; Updates.reloadAsync() still works for the RTL switch.
  updates: { enabled: false },
};

export default config;
