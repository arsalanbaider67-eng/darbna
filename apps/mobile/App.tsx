import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { getLocales } from "expo-localization";
import {
  NotoSansArabic_400Regular, NotoSansArabic_600SemiBold, NotoSansArabic_700Bold, useFonts,
} from "@expo-google-fonts/noto-sans-arabic";
import { UiProvider } from "./src/context";
import { isRTL, type Lang } from "./src/i18n";
import { MainScreen } from "./src/screens/MainScreen";
import { DEFAULT_SETTINGS, loadRecents, loadSaved, loadSettings, saveSettings } from "./src/storage";
import { setState } from "./src/store";
import { ensureDirection } from "./src/rtl";

/** Arabic by default; Kurdish or English only if the phone is set to them. */
function initialLang(): Lang {
  const tag = getLocales()[0]?.languageCode ?? "ar";
  if (tag === "ckb" || tag === "ku") return "ckb";
  if (tag === "en") return "en";
  return "ar";
}

export default function App() {
  const [fontsLoaded] = useFonts({ NotoSansArabic_400Regular, NotoSansArabic_600SemiBold, NotoSansArabic_700Bold });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      let settings = await loadSettings();
      if (!settings) {
        settings = { ...DEFAULT_SETTINGS, lang: initialLang() };
        await saveSettings(settings);
      } else {
        settings = { ...DEFAULT_SETTINGS, ...settings }; // fill in settings added since last launch
      }
      // Layout direction is fixed per JS session; reload once if it doesn't match the language.
      await ensureDirection(isRTL(settings.lang));
      const [saved, recents] = await Promise.all([loadSaved(), loadRecents()]);
      setState({ settings, saved, recents, ready: true });
      setReady(true);
    })();
  }, []);

  if (!ready || !fontsLoaded) return <View style={{ flex: 1, backgroundColor: "#0E5E6F" }} />;

  return (
    <SafeAreaProvider>
      <UiProvider>
        <MainScreen />
      </UiProvider>
    </SafeAreaProvider>
  );
}
