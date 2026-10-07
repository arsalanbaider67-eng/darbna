import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUi } from "../context";
import type { PermissionState } from "../hooks/useLocation";
import { setState, useStore } from "../store";
import { Btn, Icon, Panel, Row, Txt } from "./ui";

/** Connection pill under the search bar. Appears offline, flashes "back online" for 3 s. */
export function ConnectionPill({ online, top }: { online: boolean | null; top: number }) {
  const { theme, t } = useUi();
  const [showBack, setShowBack] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  useEffect(() => {
    if (online === false) setWasOffline(true);
    if (online && wasOffline) {
      setShowBack(true);
      setWasOffline(false);
      const id = setTimeout(() => setShowBack(false), 3000);
      return () => clearTimeout(id);
    }
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  if (online !== false && !showBack) return null;
  const off = online === false;
  return (
    <View accessibilityLiveRegion="polite" style={[s.pill, { top, backgroundColor: off ? theme.text : theme.ok }]}>
      <Icon name={off ? "wifi-off" : "wifi"} size={16} color={theme.bg} />
      <Txt size={13} weight="semibold" style={{ color: theme.bg }}>{off ? t.status.offline : t.status.online}</Txt>
    </View>
  );
}

/** Location permission states, shown as a panel over the map (the map stays usable). */
export function PermissionPanel({ state, onAllow, onOpenSettings }: { state: PermissionState; onAllow(): void; onOpenSettings(): void }) {
  const { theme, t } = useUi();
  if (state === "granted") return null;
  const blocked = state === "blocked" || state === "denied";
  const servicesOff = state === "services_off";
  return (
    <Panel>
      <Row style={{ alignItems: "flex-start" }}>
        <View style={[s.iconWrap, { backgroundColor: theme.surfaceAlt }]}>
          <Icon name={servicesOff ? "map-marker-off" : "map-marker-radius"} size={30} color={theme.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={19} weight="bold">{blocked ? t.permission.deniedTitle : t.permission.title}</Txt>
          <Txt muted>{servicesOff ? t.permission.servicesOff : blocked ? t.permission.deniedBody : t.permission.body}</Txt>
        </View>
      </Row>
      <Btn
        label={blocked || servicesOff ? t.permission.openSettings : t.permission.allow}
        icon={blocked || servicesOff ? "cog-outline" : "crosshairs-gps"}
        onPress={state === "unknown" ? onAllow : onOpenSettings}
        style={{ marginTop: 12 }}
      />
    </Panel>
  );
}

export function LocatingPill({ top }: { top: number }) {
  const { theme, t } = useUi();
  return (
    <View style={[s.pill, { top, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 }]}>
      <ActivityIndicator size="small" color={theme.primary} />
      <Txt size={13} weight="semibold">{t.status.locating}</Txt>
    </View>
  );
}

export function Toast() {
  const { theme } = useUi();
  const insets = useSafeAreaInsets();
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setState({ toast: null }), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  const bg = toast.kind === "error" ? theme.danger : toast.kind === "ok" ? theme.ok : theme.text;
  return (
    <Pressable onPress={() => setState({ toast: null })} style={[s.toast, { bottom: insets.bottom + 220, backgroundColor: bg }]} accessibilityLiveRegion="assertive">
      <Txt size={15} weight="semibold" style={{ color: theme.bg, textAlign: "center" }}>{toast.text}</Txt>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pill: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  iconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  toast: { position: "absolute", left: 24, right: 24, padding: 14, borderRadius: 16, elevation: 10 },
});
