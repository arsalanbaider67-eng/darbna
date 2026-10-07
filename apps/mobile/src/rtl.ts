import { DevSettings, I18nManager } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";

const GUARD = "darbna:rtlReloadAt";

/**
 * React Native fixes layout direction when the JS bundle starts, so switching between
 * RTL (Arabic, Sorani) and LTR (English) needs one reload. A guard prevents a reload loop
 * on devices where forceRTL doesn't stick.
 */
export async function ensureDirection(rtl: boolean): Promise<void> {
  if (I18nManager.isRTL === rtl) return;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  const last = Number((await AsyncStorage.getItem(GUARD)) ?? 0);
  if (Date.now() - last < 15_000) return; // already tried just now — carry on rather than loop
  await AsyncStorage.setItem(GUARD, String(Date.now()));
  try {
    await Updates.reloadAsync();
  } catch {
    DevSettings.reload();
  }
}
