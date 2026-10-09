/**
 * Smaller pieces for the newer features: quick nearby search, SOS, the driving menu
 * (share trip / add stop), map-problem notes, a shared trip someone is watching, helper points,
 * lane hints, the speed-limit sign and the "checkpoint ahead" warning.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { buildShareLink, haversine, levelFor, type LaneHint, type LngLat, type ReportCategory } from "@darbna/core";
import { api, ApiError } from "../api";
import { useUi } from "../context";
import { NEARBY_KINDS, nearby, reportMapProblem, type NearbyKind } from "../external";
import { fmt, fmtClock, fmtDistance, fmtNumber } from "../i18n";
import { shareText, webBase } from "../share";
import { getState, setState, toast, useStore } from "../store";
import { font, REPORT_STYLE, TOUCH } from "../theme";
import type { Place, PublicReport } from "../types";
import { Btn, Icon, Panel, Row, Txt, type IconName } from "./ui";

// ---------------------------------------------------------------- quick nearby search
const QUICK_ICON: Record<NearbyKind, IconName> = {
  fuel: "gas-station", mosque: "mosque", hospital: "hospital-box", pharmacy: "pill", restaurant: "silverware-fork-knife", atm: "cash",
};

/** Row of round buttons (fuel, mosque, hospital…) that list what's near you. */
export function QuickSearch({ userCoord, onResults }: { userCoord: LngLat | null; onResults(r: { kind: NearbyKind; places: Place[] | null; error?: string } | null): void }) {
  const { theme, t } = useUi();
  const lang = useStore((s) => s.settings.lang);
  const [busy, setBusy] = useState<NearbyKind | null>(null);
  async function run(kind: NearbyKind) {
    if (!userCoord) return;
    setBusy(kind);
    onResults({ kind, places: null });
    try {
      onResults({ kind, places: await nearby(kind, userCoord, lang, t.x.quick[kind]) });
    } catch (e) {
      onResults({ kind, places: [], error: e instanceof ApiError && e.isNetwork ? t.status.offline : t.x.quick.failed });
    } finally {
      setBusy(null);
    }
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 2, paddingVertical: 4 }}>
      {NEARBY_KINDS.map((k) => (
        <Pressable key={k} accessibilityRole="button" accessibilityLabel={t.x.quick[k]} onPress={() => void run(k)} disabled={!userCoord}
          style={{ alignItems: "center", gap: 4, width: 62, opacity: userCoord ? 1 : 0.4 }}>
          <View style={[s.quick, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
            {busy === k ? <ActivityIndicator color={theme.primary} /> : <Icon name={QUICK_ICON[k]} size={24} color={theme.primary} />}
          </View>
          <Txt size={12} numberOfLines={1}>{t.x.quick[k]}</Txt>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- SOS
const EMERGENCY = [
  { key: "police", num: "104", icon: "police-badge" },
  { key: "ambulance", num: "122", icon: "ambulance" },
  { key: "fire", num: "115", icon: "fire-truck" },
] as const;

export function SosSheet({ coord, onClose }: { coord: LngLat | null; onClose(): void }) {
  const { theme, t, fmtCtx } = useUi();
  async function sendLocation() {
    if (!coord) return;
    const url = buildShareLink(coord, "SOS", webBase());
    const maps = `https://maps.google.com/?q=${coord[1].toFixed(6)},${coord[0].toFixed(6)}`;
    await shareText(`${fmt(t.x.sos.message, { url })}\n${maps}`, url, t.place.linkCopied);
  }
  return (
    <Panel>
      <Row style={{ marginBottom: 8 }}>
        <Icon name="alarm-light" color={theme.danger} />
        <Txt size={20} weight="bold" style={{ flex: 1 }}>{t.x.sos.title}</Txt>
        <Pressable accessibilityLabel={t.common.close} onPress={onClose} hitSlop={12}><Icon name="close" /></Pressable>
      </Row>
      <View style={{ gap: 10 }}>
        {EMERGENCY.map((e) => (
          <Pressable key={e.key} accessibilityRole="button" accessibilityLabel={`${t.x.sos[e.key]} ${e.num}`} onPress={() => void Linking.openURL(`tel:${e.num}`)}
            style={({ pressed }) => [s.sosRow, { borderColor: theme.danger, opacity: pressed ? 0.8 : 1 }]}>
            <Icon name={e.icon as IconName} color={theme.danger} size={28} />
            <Txt size={18} weight="semibold" style={{ flex: 1 }}>{t.x.sos[e.key]}</Txt>
            <Txt size={24} weight="bold" style={{ color: theme.danger }}>{fmtNumber(Number(e.num), fmtCtx)}</Txt>
            <Icon name="phone" color={theme.danger} />
          </Pressable>
        ))}
        <Btn kind="danger" icon="crosshairs-gps" label={t.x.sos.shareLoc} onPress={() => void sendLocation()} disabled={!coord} />
        <Txt size={13} muted style={{ textAlign: "center" }}>{t.x.sos.note}</Txt>
      </View>
    </Panel>
  );
}

// ---------------------------------------------------------------- driving menu
export function NavMenuSheet({ onClose, onShare, onAddStop, onSos }: { onClose(): void; onShare(): void; onAddStop(): void; onSos(): void }) {
  const { theme, t } = useUi();
  const share = useStore((s) => s.share);
  const social = useStore((s) => !!s.config?.social);
  return (
    <Panel>
      <Row style={{ marginBottom: 8 }}>
        <Txt size={20} weight="bold" style={{ flex: 1 }}>{t.x.menu.title}</Txt>
        <Pressable accessibilityLabel={t.common.close} onPress={onClose} hitSlop={12}><Icon name="close" /></Pressable>
      </Row>
      <View style={{ gap: 10 }}>
        {social && <Btn kind={share ? "secondary" : "primary"} icon={share ? "share-off-outline" : "share-variant"} label={share ? t.x.share.stop : t.x.share.start} onPress={onShare} />}
        <Btn kind="secondary" icon="map-marker-plus-outline" label={t.x.stops.add} onPress={onAddStop} accessibilityHint={t.x.stops.addHint} />
        <Btn kind="secondary" icon="alarm-light-outline" label={t.x.sos.title} onPress={onSos} style={{ borderColor: theme.danger }} />
      </View>
    </Panel>
  );
}

// ---------------------------------------------------------------- map problem → OpenStreetMap note
export function MapProblemSheet({ at, onClose }: { at: LngLat; onClose(): void }) {
  const { theme, t } = useUi();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      await reportMapProblem(at, text);
      toast(t.x.mapProblem.sent, "ok");
      onClose();
    } catch (e) {
      toast(e instanceof ApiError && e.isNetwork ? t.status.offline : t.x.mapProblem.failed, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <Row style={{ marginBottom: 6 }}>
        <Icon name="map-marker-question-outline" color={theme.primary} />
        <Txt size={19} weight="bold" style={{ flex: 1 }}>{t.x.mapProblem.title}</Txt>
        <Pressable accessibilityLabel={t.common.close} onPress={onClose} hitSlop={12}><Icon name="close" /></Pressable>
      </Row>
      <Txt size={14} muted>{t.x.mapProblem.hint}</Txt>
      <TextInput
        value={text} onChangeText={setText} multiline maxLength={900} placeholder={t.x.mapProblem.placeholder}
        placeholderTextColor={theme.textMuted}
        style={[s.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt, fontFamily: font.regular }]}
      />
      <Btn label={t.x.mapProblem.send} icon="send" onPress={() => void send()} loading={busy} disabled={text.trim().length < 4} />
    </Panel>
  );
}

// ---------------------------------------------------------------- watching a shared trip
export function WatchCard({ onClose }: { onClose(): void }) {
  const { theme, t, fmtCtx } = useUi();
  const watch = useStore((s) => s.watch);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(i); }, []);
  if (!watch) return null;
  const tr = watch.trip;
  const mins = tr ? Math.floor((Date.now() - Date.parse(tr.updatedAt)) / 60_000) : 0;
  return (
    <Panel>
      <Row>
        <View style={[s.watchDot, { backgroundColor: theme.primary }]}>
          <Icon name={tr?.travel === "walk" ? "walk" : "car"} color={theme.onPrimary} size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={13} muted>{t.x.share.title}</Txt>
          <Txt size={19} weight="bold" numberOfLines={1}>
            {watch.error ? t.x.share.notFound : tr ? (tr.ended ? t.x.share.ended : fmt(t.x.share.watching, { name: tr.destName ?? "" })) : t.common.loading}
          </Txt>
        </View>
        <Pressable accessibilityLabel={t.common.close} onPress={onClose} hitSlop={12}><Icon name="close" /></Pressable>
      </Row>
      {tr && !tr.ended && !watch.error && (
        <Row style={{ marginTop: 10, flexWrap: "wrap" }} gap={16}>
          {tr.eta && <Txt size={22} weight="bold" style={{ color: theme.primary }}>{fmt(t.x.share.eta, { time: fmtClock(new Date(tr.eta), fmtCtx) })}</Txt>}
          {tr.remainingM != null && <Txt size={16}>{fmt(t.x.share.left, { d: fmtDistance(tr.remainingM, fmtCtx) })}</Txt>}
        </Row>
      )}
      {tr && !watch.error && <Txt size={13} muted style={{ marginTop: 4 }}>{mins < 1 ? t.x.share.updatedNow : fmt(t.x.share.updated, { n: fmtNumber(mins, fmtCtx) })}</Txt>}
    </Panel>
  );
}

// ---------------------------------------------------------------- helper points
export function PointsCard() {
  const { theme, t, fmtCtx } = useUi();
  const points = useStore((s) => s.points);
  const social = useStore((s) => !!s.config?.social);
  useEffect(() => {
    if (!social) return;
    api.me().then((p) => setState({ points: p })).catch(() => {});
  }, [social]);
  if (!social) return null;
  const p = points?.points ?? 0;
  const lv = levelFor(p);
  return (
    <View style={[s.points, { borderColor: theme.primary, backgroundColor: theme.surfaceAlt }]}>
      <Row>
        <Icon name="star-four-points" color={theme.primary} size={28} />
        <View style={{ flex: 1 }}>
          <Txt size={13} muted>{t.x.points.title}</Txt>
          <Txt size={20} weight="bold" style={{ color: theme.primary }}>{fmtNumber(p, fmtCtx)} · {t.x.points.levels[lv.level - 1]}</Txt>
        </View>
        <Txt weight="semibold">{fmt(t.x.points.level, { n: fmtNumber(lv.level, fmtCtx) })}</Txt>
      </Row>
      <View style={[s.bar, { backgroundColor: theme.border }]}>
        <View style={{ width: `${Math.round(lv.progress * 100)}%`, height: "100%", backgroundColor: theme.primary, borderRadius: 3 }} />
      </View>
      <Txt size={13} muted>
        {lv.next != null ? fmt(t.x.points.next, { n: fmtNumber(lv.next - p, fmtCtx) }) + " · " : ""}
        {fmt(t.x.points.stats, { r: fmtNumber(points?.reports ?? 0, fmtCtx), t: fmtNumber(points?.thanks ?? 0, fmtCtx) })}
      </Txt>
      <Txt size={13} muted>{t.x.points.how}</Txt>
    </View>
  );
}

/** After a report: refresh points and show what was earned. */
export async function refreshPoints(): Promise<number | null> {
  if (!getState().config?.social) return null;
  const before = getState().points?.points ?? null;
  try {
    const p = await api.me();
    setState({ points: p });
    return before == null ? null : p.points - before;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- driving bits
/** Three lanes; the ones to use are gold. A hint for exits and forks. */
export function LaneHintView({ hint }: { hint: LaneHint }) {
  const { theme } = useUi();
  const icon = (i: number): IconName => (i === 0 ? "arrow-top-left" : i === hint.lanes - 1 ? "arrow-top-right" : "arrow-up");
  return (
    <Row gap={0} style={[s.lanes, { borderColor: theme.border }]}>
      {hint.use.map((on, i) => (
        <View key={i} style={[s.lane, { borderColor: theme.border, borderLeftWidth: i ? 1 : 0, backgroundColor: on ? "rgba(212,175,55,0.14)" : "transparent" }]}>
          <Icon name={icon(i)} size={26} color={on ? theme.primary : theme.textMuted} />
        </View>
      ))}
    </Row>
  );
}

/** Round speed-limit sign; turns into a red warning when you're over. */
export function SpeedSign({ kmh, over }: { kmh: number; over: boolean }) {
  const { fmtCtx } = useUi();
  return (
    <View style={[s.sign, { backgroundColor: over ? "#FF3B30" : "#FFFFFF" }]} accessibilityLabel={`${kmh} km/h`}>
      <Txt size={22} weight="bold" style={{ color: over ? "#FFFFFF" : "#111111", lineHeight: 26 }}>{fmtNumber(kmh, fmtCtx)}</Txt>
    </View>
  );
}

/** "Checkpoint in 600 m" chip shown while driving. */
export function AheadChip({ report, distanceM }: { report: PublicReport; distanceM: number }) {
  const { theme, t, fmtCtx } = useUi();
  const st = REPORT_STYLE[report.category as ReportCategory];
  return (
    <Row style={[s.ahead, { backgroundColor: "rgba(18,18,18,0.94)", borderColor: theme.warn }]} accessibilityLiveRegion="polite">
      <View style={[s.aheadIcon, { backgroundColor: st.color }]}><Icon name={st.icon as IconName} color="#fff" size={18} /></View>
      <Txt size={16} weight="semibold" style={{ color: theme.warn }}>
        {fmt(t.x.warn.ahead, { what: t.reports.categories[report.category], d: fmtDistance(distanceM, fmtCtx) })}
      </Txt>
    </Row>
  );
}

// ---------------------------------------------------------------- fuel station status
export function FuelStatus({ place, reports }: { place: Place; reports: PublicReport[] }) {
  const { theme, t } = useUi();
  const near = reports.filter((r) => (r.category === "fuel_queue" || r.category === "fuel_closed") && haversine(r.coord, place.coord) < 150);
  const [busy, setBusy] = useState(false);
  async function send(category: "fuel_queue" | "fuel_closed") {
    setBusy(true);
    try {
      const r = await api.createReport(category, place.coord);
      setState((st) => ({ reports: { ...st.reports, [r.report.id]: r.report } }));
      toast(r.duplicate ? t.reports.merged : t.reports.sent, "ok");
      void refreshPoints();
    } catch (e) {
      toast(e instanceof ApiError && e.code === "rate_limited" ? t.reports.rateLimited : t.common.retry, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ marginTop: 10, gap: 6 }}>
      <Txt size={14} weight="semibold">{t.x.fuel.title}</Txt>
      {near.length ? near.map((r) => (
        <Row key={r.id} gap={6}>
          <Icon name={REPORT_STYLE[r.category].icon as IconName} size={18} color={REPORT_STYLE[r.category].color} />
          <Txt size={14}>{t.reports.categories[r.category]}</Txt>
        </Row>
      )) : <Txt size={13} muted>{t.x.fuel.none}</Txt>}
      <Row>
        <Btn kind="secondary" icon="car-multiple" label={t.x.fuel.queue} onPress={() => void send("fuel_queue")} disabled={busy} style={{ flex: 1, minHeight: 44 }} />
        <Btn kind="secondary" icon="gas-station-off" label={t.x.fuel.closed} onPress={() => void send("fuel_closed")} disabled={busy} style={{ flex: 1, minHeight: 44, borderColor: theme.border }} />
      </Row>
    </View>
  );
}

const s = StyleSheet.create({
  quick: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  sosRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: TOUCH + 8, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1.5 },
  input: { minHeight: 90, borderWidth: 1, borderRadius: 14, padding: 12, fontSize: 16, textAlignVertical: "top", marginVertical: 10 },
  watchDot: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  points: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 8 },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
  lanes: { borderWidth: 1, borderRadius: 12, overflow: "hidden", alignSelf: "stretch", marginTop: 8 },
  lane: { flex: 1, alignItems: "center", paddingVertical: 6 },
  sign: { width: 58, height: 58, borderRadius: 29, borderWidth: 5, borderColor: "#E01E1E", alignItems: "center", justifyContent: "center" },
  ahead: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" },
  aheadIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
