import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { isRTL, strings, type FormatCtx } from "./i18n";
import type { Strings } from "./i18n/ar";
import { useStore } from "./store";
import { day, night, type Theme } from "./theme";

interface Ui {
  t: Strings;
  fmtCtx: FormatCtx;
  theme: Theme;
  rtl: boolean;
}

const UiContext = createContext<Ui | null>(null);

export function UiProvider({ children }: { children: React.ReactNode }) {
  const settings = useStore((s) => s.settings);
  const scheme = useColorScheme();
  const value = useMemo<Ui>(() => {
    const dark = settings.theme === "night" || (settings.theme === "auto" && scheme === "dark");
    return {
      t: strings(settings.lang),
      fmtCtx: { lang: settings.lang, digits: settings.digits },
      theme: dark ? night : day,
      rtl: isRTL(settings.lang),
    };
  }, [settings, scheme]);
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): Ui {
  const v = useContext(UiContext);
  if (!v) throw new Error("useUi outside UiProvider");
  return v;
}
