import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useUi } from "../context";
import { useStore } from "../store";
import type { Place } from "../types";
import { Icon, Panel, Row, Txt, type IconName } from "./ui";

/** Only real saved/recent places appear here; the empty state opens search. */
export function JourneyPanel({ onPick, onSearch }: { onPick(p: Place): void; onSearch(): void }) {
  const { theme, t } = useUi();
  const saved = useStore(s => s.saved);
  const recent = useStore(s => s.recents[0]);
  const items: { label: string; icon: IconName; place?: Place; hint: string }[] = [
    { label: t.saved.home, icon: "home-outline", place: saved.home, hint: t.saved.setHomeHint },
    { label: t.saved.work, icon: "briefcase-outline", place: saved.work, hint: t.saved.setWorkHint },
    ...saved.favorites.slice(0, 4).map(place => ({ label: place.name, icon: "star-outline" as IconName, place, hint: "" })),
  ];
  return <Panel style={s.panel}>
    <Txt size={21} weight="bold">{t.journey.ready}</Txt>
    <Txt size={13} muted style={{ marginBottom: 14 }}>{t.journey.subtitle}</Txt>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
      {items.map((item, i) => <Pressable key={i} accessibilityRole="button" accessibilityLabel={`${item.label}, ${item.place?.name ?? item.hint}`}
        onPress={() => item.place ? onPick(item.place) : onSearch()}
        style={({ pressed }) => [s.place, { backgroundColor: pressed ? theme.highlight : theme.surfaceAlt, borderColor: theme.border }]}>
        <View style={[s.icon, { backgroundColor: theme.highlight }]}><Icon name={item.icon} color={theme.primary} size={23} /></View>
        <View style={{ flex: 1 }}><Txt size={15} weight="semibold" numberOfLines={1}>{item.label}</Txt>
          <Txt size={12} muted numberOfLines={1}>{item.place?.name ?? item.hint}</Txt></View>
      </Pressable>)}
    </ScrollView>
    {recent && <Pressable accessibilityRole="button" onPress={() => onPick(recent)} style={[s.recent, { borderColor: theme.border }]}>
      <Icon name="history" size={20} color={theme.textMuted} />
      <View style={{ flex: 1 }}><Txt size={11} muted>{t.journey.recent}</Txt><Txt size={14} numberOfLines={1}>{recent.name}</Txt></View>
      <Icon name="chevron-right" color={theme.primary} size={20} />
    </Pressable>}
  </Panel>;
}
const s = StyleSheet.create({
  panel: { paddingTop: 10 },
  place: { flexDirection: "row", alignItems: "center", gap: 10, width: 158, minHeight: 76, padding: 12, borderRadius: 18, borderWidth: 1 },
  icon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  recent: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 10, minHeight: 56 },
});
