/**
 * "Satellite connection": which satellite systems (GPS, GLONASS, Galileo, BeiDou, QZSS, NavIC) your
 * phone's location chip supports, from the maker's published specs (packages/core/src/gnss.ts).
 * Not a live reading: iOS doesn't let apps see the satellites in use, and the phone combines every
 * system it supports by itself.
 */
import React from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Device from "expo-device";
import { GNSS_SYSTEMS, gnssForDevice, type GnssSystem } from "@darbna/core";
import { useUi } from "../context";
import { Icon, Panel, Row, Txt } from "./ui";

const FLAG: Record<GnssSystem["flag"], string> = { US: "🇺🇸", RU: "🇷🇺", EU: "🇪🇺", CN: "🇨🇳", JP: "🇯🇵", IN: "🇮🇳" };
const COLOR: Record<GnssSystem["id"], string> = {
  gps: "#7DB3F0", glonass: "#EE7D8C", galileo: "#A99BF0", beidou: "#E9B05A", qzss: "#5ED6C0", navic: "#EF9A55",
};

export function SatellitesSheet({ onClose }: { onClose(): void }) {
  const { theme, t } = useUi();
  const L = t.x.sat;
  const dev = gnssForDevice(Device.modelId, Device.modelName);
  const isIos = Platform.OS === "ios";
  const known = dev.published;

  return (
    <Panel>
      <Row style={{ marginBottom: 6 }}>
        <Icon name="satellite-variant" color={theme.primary} />
        <Txt size={20} weight="bold" style={{ flex: 1 }}>{L.title}</Txt>
        <Pressable accessibilityLabel={t.common.close} onPress={onClose} hitSlop={12}><Icon name="close" /></Pressable>
      </Row>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: 10, paddingBottom: 6 }}>
        {/* The phone */}
        <View style={[s.card, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
          <Row gap={10}>
            <Icon name="cellphone" color={theme.primary} size={28} />
            <View style={{ flex: 1 }}>
              <Txt size={18} weight="bold">{dev.model || L.unknownDevice}</Txt>
              {!known && <Txt size={13} muted>{L.notPublished}</Txt>}
            </View>
          </Row>
          {dev.dualFrequency && (
            <View style={[s.chip, { backgroundColor: theme.primary }]}>
              <Icon name="crosshairs-gps" size={16} color={theme.onPrimary} />
              <Txt size={13} weight="semibold" style={{ color: theme.onPrimary }}>{L.chipDual}</Txt>
            </View>
          )}
        </View>

        <Txt size={14} weight="semibold" style={{ color: theme.primary }}>{L.auto}</Txt>
        <Txt size={13} muted>{isIos ? L.iosNote : L.otherNote}</Txt>

        <Txt size={16} weight="bold">{known ? L.listTitle : L.allTitle}</Txt>
        {GNSS_SYSTEMS.map((g) => {
          const on = known && dev.systems.includes(g.id);
          const dim = known && !on;
          return (
            <View key={g.id} style={[s.sys, { borderColor: theme.border, backgroundColor: theme.surface, opacity: dim ? 0.55 : 1 }]}>
              <View style={[s.bar, { backgroundColor: COLOR[g.id] }]} />
              <View style={[s.flag, { backgroundColor: COLOR[g.id] + "33" }]}><Text style={{ fontSize: 22 }}>{FLAG[g.flag]}</Text></View>
              <View style={{ flex: 1 }}>
                <Txt size={16} weight="bold">{g.name}</Txt>
                <Txt size={13} muted>{L[g.id]}</Txt>
                {!g.overIraq && <Txt size={12} style={{ color: theme.warn }}>{L.regional}</Txt>}
              </View>
              {known && <Icon name={on ? "check-circle" : "minus-circle-outline"} size={22} color={on ? theme.ok : theme.textMuted} />}
            </View>
          );
        })}

        {dev.source && (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(dev.source!)} style={[s.card, { borderColor: theme.border, flexDirection: "row", alignItems: "center", gap: 10 }]}>
            <Icon name="open-in-new" color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Txt weight="semibold">{L.source}</Txt>
              <Txt size={13} muted>{L.sourceHint}</Txt>
            </View>
          </Pressable>
        )}
      </ScrollView>
    </Panel>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  sys: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 10, paddingStart: 14, overflow: "hidden" },
  bar: { position: "absolute", top: 0, bottom: 0, start: 0, width: 5 },
  flag: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
