import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { GuidanceState, ManeuverKind, Route } from "@darbna/core";
import { useUi } from "../context";
import { fmt, fmtClock, fmtDistance, fmtDuration, instructionText } from "../i18n";
import type { RerouteStatus } from "../nav/useGuidance";
import { TOUCH } from "../theme";
import { Btn, Icon, RoundBtn, Row, Txt, type IconName } from "./ui";

/**
 * Maneuver glyphs. Never mirrored for RTL: a right turn points right in every language.
 * Iraq drives on the right, so roundabouts circulate counter-clockwise and U-turns go left.
 */
export const MANEUVER_ICON: Record<ManeuverKind, IconName> = {
  depart: "navigation-variant", arrive: "flag-checkered", straight: "arrow-up",
  slight_right: "arrow-top-right", right: "arrow-right-top", sharp_right: "arrow-right-bottom", uturn: "arrow-u-left-top",
  sharp_left: "arrow-left-bottom", left: "arrow-left-top", slight_left: "arrow-top-left",
  ramp_right: "arrow-top-right", ramp_left: "arrow-top-left", ramp_straight: "arrow-up",
  exit_right: "arrow-top-right", exit_left: "arrow-top-left",
  keep_right: "arrow-top-right", keep_left: "arrow-top-left", keep_straight: "arrow-up",
  merge: "call-merge", roundabout: "rotate-left", roundabout_exit: "arrow-top-right", ferry: "ferry",
};

interface Props {
  route: Route;
  g: GuidanceState | null;
  reroute: RerouteStatus;
  online: boolean | null;
  paused: boolean;
  muted: boolean;
  following: boolean;
  /** Current speed from GPS (m/s), if known. */
  speedMps: number | null;
  onExit(): void;
  onPauseToggle(): void;
  onMuteToggle(): void;
  onReport(): void;
  onRecenter(): void;
}

/**
 * Driving screen. Always dark (rendered inside UiOverride), map-first: instruction banner on top,
 * speed / current street / report along the bottom edge, and a slim trip bar.
 */
export function NavHud(p: Props) {
  const { theme, t, fmtCtx } = useUi();
  const insets = useSafeAreaInsets();
  const [confirmExit, setConfirmExit] = useState(false);
  const step = p.g?.nextStep ?? p.route.steps[1] ?? p.route.steps[0];
  const dist = p.g?.distanceToNextM ?? p.route.steps[0]?.distanceM ?? 0;
  const remainingS = p.g?.remainingS ?? p.route.durationS;
  const remainingM = p.g?.remainingM ?? p.route.distanceM;
  const then = p.g && step ? p.route.steps[step.index + 1] : undefined;
  const thenSoon = then && step && then.kind !== "arrive" && step.distanceM < 150;
  // The road you're on is the one the previous maneuver turned onto.
  const current = step ? p.route.steps[Math.max(0, step.index - 1)] : undefined;
  const street = current?.streetName ?? "";
  const kmh = Math.max(0, Math.round((p.speedMps ?? 0) * 3.6));

  let status: { text: string; icon: IconName; color: string } | null = null;
  if (p.paused) status = { text: t.nav.paused, icon: "pause-circle", color: theme.textMuted };
  else if (p.reroute === "requesting") status = { text: t.nav.rerouting, icon: "sync", color: theme.primary };
  else if (p.reroute === "offline") status = { text: t.nav.rerouteOffline, icon: "wifi-off", color: theme.warn };
  else if (p.g?.status === "off_route") status = { text: t.nav.offRoute, icon: "map-marker-question", color: theme.warn };
  else if (p.g?.status === "gps_lost") status = { text: t.status.gpsLost, icon: "crosshairs-off", color: theme.danger };
  else if (p.g?.status === "gps_weak") status = { text: t.status.gpsWeak, icon: "crosshairs-question", color: theme.warn };
  else if (p.online === false) status = { text: t.status.offlineNav, icon: "wifi-off", color: theme.textMuted };

  const barH = 92 + Math.max(insets.bottom, 10);

  return (
    <>
      {/* Maneuver banner — biggest, highest-contrast thing on screen. */}
      <View style={[s.banner, { top: insets.top + 8, backgroundColor: theme.banner }]} accessibilityLiveRegion="polite">
        {step && (
          <Row gap={14}>
            <Icon name={MANEUVER_ICON[step.kind]} size={50} color={theme.onBanner} />
            <View style={{ flex: 1 }}>
              <Txt size={30} weight="bold" style={{ color: theme.onBanner, lineHeight: 40 }}>{fmtDistance(dist, fmtCtx)}</Txt>
              <Txt size={18} weight="semibold" numberOfLines={2} style={{ color: theme.onBanner }}>{instructionText(step, null, fmtCtx)}</Txt>
            </View>
          </Row>
        )}
        {thenSoon && then && (
          <Row gap={6} style={[s.then, { borderTopColor: "rgba(255,255,255,0.25)" }]}>
            <Txt size={14} style={{ color: theme.onBanner }}>{t.nav.then}</Txt>
            <Icon name={MANEUVER_ICON[then.kind]} size={22} color={theme.onBanner} />
          </Row>
        )}
      </View>

      {status && (
        <View style={[s.status, { top: insets.top + 150, backgroundColor: theme.surface, borderColor: status.color }]}>
          <Icon name={status.icon} size={20} color={status.color} />
          <Txt size={15} weight="semibold" style={{ color: status.color, flexShrink: 1 }}>{status.text}</Txt>
        </View>
      )}

      {/* Top corners under the banner: sound on the right, re-center on the left when you've panned away. */}
      <View style={[s.topRight, { top: insets.top + 150 }]}>
        <RoundBtn icon={p.muted ? "volume-off" : "volume-high"} label={p.muted ? t.nav.unmute : t.nav.mute} onPress={p.onMuteToggle} size={52} />
      </View>
      {!p.following && (
        <View style={[s.topLeft, { top: insets.top + 150 }]}>
          <RoundBtn icon="navigation-variant" label={t.nav.recenter} onPress={p.onRecenter} size={52} />
        </View>
      )}

      {/* Bottom edge of the map: speed · street · report. Physical left/right like a dashboard. */}
      <View style={[s.speed, { bottom: barH + 14, backgroundColor: theme.surface, borderColor: theme.border }]} accessibilityLabel={`${kmh} km/h`}>
        <Txt size={28} weight="bold" style={{ lineHeight: 32 }}>{String(kmh)}</Txt>
        <Txt size={11} muted style={{ lineHeight: 13 }}>km/h</Txt>
      </View>
      {!!street && (
        <View style={[s.street, { bottom: barH + 22 }]} pointerEvents="none">
          <View style={[s.streetPill, { backgroundColor: "rgba(10,16,20,0.92)" }]}>
            <Txt size={16} weight="semibold" numberOfLines={2} style={{ color: "#FFFFFF", textAlign: "center" }}>{street}</Txt>
          </View>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.reports.title}
        onPress={p.onReport}
        style={({ pressed }) => [s.report, { bottom: barH + 14, backgroundColor: pressed ? "#7A5A12" : "#5C4511", borderColor: theme.accent }]}
      >
        <Icon name="alert-plus" size={36} color={theme.accent} />
      </Pressable>

      {/* Slim trip bar */}
      <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 10), backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={[s.grabber, { backgroundColor: theme.border }]} />
        {confirmExit ? (
          <Row style={{ gap: 10 }}>
            <Txt size={17} weight="bold" style={{ flex: 1 }}>{t.nav.confirmExit}</Txt>
            <Btn kind="secondary" label={t.common.cancel} onPress={() => setConfirmExit(false)} />
            <Btn kind="danger" label={t.nav.exit} onPress={p.onExit} />
          </Row>
        ) : (
          <Row>
            <Pressable accessibilityRole="button" accessibilityLabel={t.nav.exit} onPress={() => setConfirmExit(true)} style={[s.ctrl, { backgroundColor: theme.surfaceAlt }]}>
              <Icon name="close" size={26} color={theme.danger} />
            </Pressable>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Txt size={24} weight="bold" style={{ color: theme.ok, lineHeight: 30 }}>{fmtDuration(remainingS, fmtCtx)}</Txt>
              <Txt size={14} muted>
                {fmtDistance(remainingM, fmtCtx)} · {fmt(t.nav.arrivalAt, { time: fmtClock(new Date(Date.now() + remainingS * 1000), fmtCtx) })}
              </Txt>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={p.paused ? t.nav.resume : t.nav.pause} onPress={p.onPauseToggle} style={[s.ctrl, { backgroundColor: theme.surfaceAlt }]}>
              <Icon name={p.paused ? "play" : "pause"} size={26} />
            </Pressable>
          </Row>
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  banner: { position: "absolute", left: 10, right: 10, borderRadius: 20, padding: 14, elevation: 8, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  then: { marginTop: 10, paddingTop: 8, borderTopWidth: 1 },
  status: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 2, maxWidth: "70%" },
  topRight: { position: "absolute", right: 12 },
  topLeft: { position: "absolute", left: 12 },
  speed: {
    position: "absolute", left: 12, width: 76, height: 76, borderRadius: 38, borderWidth: 3, alignItems: "center", justifyContent: "center",
    elevation: 6, shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  street: { position: "absolute", left: 96, right: 96, alignItems: "center" },
  streetPill: { borderRadius: 22, paddingHorizontal: 18, paddingVertical: 8, maxWidth: "100%" },
  report: {
    position: "absolute", right: 12, width: 72, height: 72, borderRadius: 20, borderWidth: 2, alignItems: "center", justifyContent: "center",
    elevation: 6, shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  bar: {
    position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 8, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth, elevation: 12, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: -2 },
  },
  grabber: { alignSelf: "center", width: 44, height: 4, borderRadius: 2, marginBottom: 8 },
  ctrl: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: "center", justifyContent: "center" },
});
