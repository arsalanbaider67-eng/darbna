/**
 * SOS: the emergency numbers for where you are, one tap each to open the phone's dialer
 * (nothing is ever dialled automatically). Always available: no account, points or level needed,
 * works offline and without location (choose your region by hand).
 */
import React, { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  buildShareLink, IRAQ, KURDISTAN, minutesAgo, OTHER, resolveSos,
  type EmergencyContact, type EmergencyService, type LngLat,
} from "@darbna/core";
import { useUi } from "../context";
import { fmt, fmtNumber } from "../i18n";
import { shareText, webBase } from "../share";
import { chooseSosRegion } from "../sos/emergency";
import { useStore } from "../store";
import { TOUCH } from "../theme";
import { Btn, Icon, Panel, Row, Txt, type IconName } from "./ui";

const SERVICE_ICON: Record<EmergencyService, IconName> = {
  general: "alarm-light", police: "police-badge", ambulance: "ambulance", civil_defense: "fire-truck",
};

export function SosSheet({ coord, onClose }: { coord: LngLat | null; onClose(): void }) {
  const { theme, t, fmtCtx } = useUi();
  const sos = useStore((s) => s.sos);
  const [choosing, setChoosing] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);

  const v = resolveSos({ config: sos.config, now, permission: sos.permission, live: sos.live, cached: sos.cached, manual: sos.manual });
  const L = t.x.sos;
  const regionName = (r: string | null) =>
    r === KURDISTAN ? L.regionKR : r === IRAQ ? L.regionIQ : r === "TUR" ? L.regionTUR : r === OTHER ? L.regionOther : L.unknownRegion;
  const serviceName = (s: EmergencyService) => ({ general: L.general, police: L.police, ambulance: L.ambulance, civil_defense: L.civilDefense }[s]);
  const date = (d: string) => fmtNumber(Number(d.slice(8, 10)), fmtCtx) + "/" + fmtNumber(Number(d.slice(5, 7)), fmtCtx) + "/" + fmtNumber(Number(d.slice(0, 4)), fmtCtx);

  // Where the region came from, in plain words.
  const basisLine =
    v.basis === "location" ? fmt(L.fromLocation, { n: fmtNumber(minutesAgo(now, v.locationAt ?? now), fmtCtx) })
    : v.basis === "last_known" ? fmt(L.lastKnown, { n: fmtNumber(minutesAgo(now, v.locationAt ?? now), fmtCtx) })
    : v.basis === "manual" ? L.chosen
    : sos.permission === "denied" ? L.noPermission : L.noLocation;

  async function sendLocation() {
    if (!coord) return;
    const url = buildShareLink(coord, "SOS", webBase());
    const maps = `https://maps.google.com/?q=${coord[1].toFixed(6)},${coord[0].toFixed(6)}`;
    await shareText(`${fmt(L.message, { url })}\n${maps}`, url, t.place.linkCopied);
  }

  const callRow = (c: EmergencyContact, big: boolean) => (
    <Pressable
      key={`${c.service}-${c.number}`}
      accessibilityRole="button"
      accessibilityLabel={`${serviceName(c.service)} ${c.number}. ${L.tapHint}`}
      // One tap opens the dialer with the number filled in; the person presses call themselves.
      onPress={() => void Linking.openURL(`tel:${c.number}`)}
      style={({ pressed }) => [s.call, { minHeight: big ? TOUCH + 24 : TOUCH + 8, borderColor: theme.danger, backgroundColor: big ? "rgba(217,45,32,0.08)" : "transparent", opacity: pressed ? 0.8 : 1 }]}
    >
      <Icon name={SERVICE_ICON[c.service]} color={theme.danger} size={big ? 34 : 28} />
      <Txt size={big ? 20 : 18} weight="semibold" style={{ flex: 1 }}>{serviceName(c.service)}</Txt>
      <Txt size={big ? 32 : 24} weight="bold" style={{ color: theme.danger }}>{fmtNumber(Number(c.number), fmtCtx)}</Txt>
      <Icon name="phone" color={theme.danger} size={big ? 28 : 24} />
    </Pressable>
  );

  const chooser = (
    <View style={{ gap: 8 }}>
      <Txt size={15} weight="semibold">{L.choose}</Txt>
      {[KURDISTAN, IRAQ, "TUR", OTHER].map((r) => {
        const on = sos.manual?.region === r && v.basis === "manual";
        return (
          <Pressable key={r} accessibilityRole="radio" accessibilityState={{ selected: on }}
            onPress={() => { chooseSosRegion(r); setChoosing(false); }}
            style={[s.choice, { borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.highlight : "transparent" }]}>
            <Icon name={r === OTHER ? "earth" : r === "TUR" ? "flag-outline" : "map-marker-radius-outline"} color={theme.primary} />
            <Txt size={16} style={{ flex: 1 }}>{r === IRAQ ? L.regionIQLong : regionName(r)}</Txt>
          </Pressable>
        );
      })}
      {sos.manual && (
        <Btn kind="ghost" icon="crosshairs-gps" label={L.useLocation} onPress={() => { chooseSosRegion(null); setChoosing(false); }} />
      )}
    </View>
  );

  const showChooser = choosing || (v.needsChoice && v.contacts.length === 0 && v.alternatives.length === 0);
  const sources = v.region ? sos.config.regions[v.region]?.contacts ?? [] : [];

  return (
    <Panel>
      <Row style={{ marginBottom: 6 }}>
        <Icon name="alarm-light" color={theme.danger} />
        <Txt size={20} weight="bold" style={{ flex: 1 }}>{L.title}</Txt>
        <Pressable accessibilityLabel={t.common.close} onPress={onClose} hitSlop={12}><Icon name="close" /></Pressable>
      </Row>
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 10 }}>
        {/* Where we think you are, and how sure we are. */}
        <View style={[s.where, { borderColor: v.locationStale || v.basis === "none" ? theme.warn : theme.border }]}>
          <Row gap={8}>
            <Icon name={v.basis === "manual" ? "hand-pointing-right" : "map-marker"} color={theme.primary} size={20} />
            <Txt size={16} weight="semibold" style={{ flex: 1 }}>{v.region ? (v.region === IRAQ ? L.regionIQLong : regionName(v.region)) : L.unknownRegion}</Txt>
            <Pressable accessibilityRole="button" onPress={() => setChoosing((c) => !c)} hitSlop={8}>
              <Txt size={13} weight="semibold" style={{ color: theme.primary }}>{L.change}</Txt>
            </Pressable>
          </Row>
          <Txt size={13} style={{ color: v.locationStale || v.basis === "none" ? theme.warn : theme.textMuted }}>{basisLine}</Txt>
          {v.poorGps && <Txt size={13} style={{ color: theme.warn }}>{L.poorGps}</Txt>}
          {v.nearBoundary && <Txt size={13} style={{ color: theme.warn }}>{L.nearBoundary}</Txt>}
        </View>

        {showChooser && chooser}

        {/* The numbers: biggest first. */}
        {v.contacts.map((c, i) => callRow(c, i === 0 && (c.primary === true || v.contacts.length === 1)))}

        {/* Near the boundary with nothing confirmed yet: both sets, clearly labelled. */}
        {v.alternatives.map((a) => (
          <View key={a.region} style={{ gap: 8 }}>
            <Txt size={14} weight="semibold" style={{ color: theme.primary }}>{fmt(L.ifIn, { region: a.region === IRAQ ? L.regionIQLong : regionName(a.region) })}</Txt>
            {a.contacts.map((c) => callRow(c, false))}
          </View>
        ))}

        {v.unconfirmed && (
          <View style={[s.where, { borderColor: theme.warn }]}>
            <Txt size={15} weight="semibold" style={{ color: theme.warn }}>{L.unconfirmedTitle}</Txt>
            <Txt size={14}>{L.unconfirmed}</Txt>
          </View>
        )}

        <Btn kind="danger" icon="crosshairs-gps" label={L.shareLoc} onPress={() => void sendLocation()} disabled={!coord} />
        <Txt size={13} muted style={{ textAlign: "center" }}>{L.tapHint}</Txt>

        {/* How fresh the numbers are, and where they come from. */}
        {v.numbersVerified && (
          <Pressable accessibilityRole="button" onPress={() => setShowSources((x) => !x)}>
            <Txt size={13} style={{ textAlign: "center", color: v.numbersStale ? theme.warn : theme.textMuted }}>
              {(v.numbersStale ? fmt(L.stale, { date: date(v.numbersVerified) }) : fmt(L.verified, { date: date(v.numbersVerified) })) + " · " + L.sources}
            </Txt>
          </Pressable>
        )}
        {showSources && sources.map((c) => (
          <View key={`src-${c.service}`} style={{ gap: 2 }}>
            <Txt size={13} weight="semibold">{serviceName(c.service)} · {c.number}</Txt>
            {c.sources.map((src) => (
              <Pressable key={src.url + src.title} onPress={() => void Linking.openURL(src.url)} accessibilityRole="link">
                <Txt size={12} style={{ color: theme.primary }}>{src.official ? `★ ${L.official} · ` : ""}{src.title}</Txt>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </Panel>
  );
}

const s = StyleSheet.create({
  call: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1.5 },
  where: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 4 },
  choice: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, minHeight: TOUCH - 4 },
});
