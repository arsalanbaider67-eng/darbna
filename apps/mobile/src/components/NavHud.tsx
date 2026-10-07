import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { GuidanceState, ManeuverKind, Route } from "@darbna/core";
import { useUi } from "../context";
import { fmt, fmtClock, fmtDistance, fmtDuration, instructionText } from "../i18n";
import type { RerouteStatus } from "../nav/useGuidance";
import { TOUCH } from "../theme";
import { Btn, Icon, Panel, RoundBtn, Row, Txt, type IconName } from "./ui";

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
  onExit(): void;
  onPauseToggle(): void;
  onMuteToggle(): void;
  onReport(): void;
  onRecenter(): void;
}

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

  let status: { text: string; icon: IconName; color: string } | null = null;
  if (p.paused) status = { text: t.nav.paused, icon: "pause-circle", color: theme.textMuted };
  else if (p.reroute === "requesting") status = { text: t.nav.rerouting, icon: "sync", color: theme.primary };
  else if (p.reroute === "offline") status = { text: t.nav.rerouteOffline, icon: "wifi-off", color: theme.warn };
  else if (p.g?.status === "off_route") status = { text: t.nav.offRoute, icon: "map-marker-question", color: theme.warn };
  else if (p.g?.status === "gps_lost") status = { text: t.status.gpsLost, icon: "crosshairs-off", color: theme.danger };
  else if (p.g?.status === "gps_weak") status = { text: t.status.gpsWeak, icon: "crosshairs-question", color: theme.warn };
  else if (p.online === false) status = { text: t.status.offlineNav, icon: "wifi-off", color: theme.textMuted };

  return (
    <>
      {/* Maneuver banner — biggest, highest-contrast thing on screen. */}
      <View style={[s.banner, { top: insets.top + 8, backgroundColor: theme.banner }]} accessibilityLiveRegion="polite">
        {step && (
          <Row gap={14}>
            <Icon name={MANEUVER_ICON[step.kind]} size={52} color={theme.onBanner} />
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

      <View style={[s.side, { bottom: 190 + insets.bottom }]}>
        {!p.following && <RoundBtn icon="crosshairs-gps" label={t.nav.recenter} onPress={p.onRecenter} />}
        <RoundBtn icon={p.muted ? "volume-off" : "volume-high"} label={p.muted ? t.nav.unmute : t.nav.mute} onPress={p.onMuteToggle} />
        <RoundBtn icon="alert-plus" label={t.reports.title} onPress={p.onReport} />
      </View>

      <Panel>
        {confirmExit ? (
          <View style={{ gap: 10 }}>
            <Txt size={18} weight="bold">{t.nav.confirmExit}</Txt>
            <Row>
              <Btn kind="secondary" label={t.common.cancel} onPress={() => setConfirmExit(false)} style={{ flex: 1 }} />
              <Btn kind="danger" label={t.nav.exit} onPress={p.onExit} style={{ flex: 1 }} />
            </Row>
          </View>
        ) : (
          <Row>
            <View style={{ flex: 1 }}>
              <Txt size={26} weight="bold" style={{ color: theme.ok }}>{fmtDuration(remainingS, fmtCtx)}</Txt>
              <Txt size={15} muted>
                {fmtDistance(remainingM, fmtCtx)} · {fmt(t.nav.arrivalAt, { time: fmtClock(new Date(Date.now() + remainingS * 1000), fmtCtx) })}
              </Txt>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={p.paused ? t.nav.resume : t.nav.pause} onPress={p.onPauseToggle} style={[s.ctrl, { backgroundColor: theme.surfaceAlt }]}>
              <Icon name={p.paused ? "play" : "pause"} size={28} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t.nav.exit} onPress={() => setConfirmExit(true)} style={[s.ctrl, { backgroundColor: theme.danger }]}>
              <Icon name="close" size={28} color="#fff" />
            </Pressable>
          </Row>
        )}
      </Panel>
    </>
  );
}

const s = StyleSheet.create({
  banner: { position: "absolute", left: 10, right: 10, borderRadius: 20, padding: 16, elevation: 8, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  then: { marginTop: 10, paddingTop: 8, borderTopWidth: 1 },
  status: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 2, maxWidth: "92%" },
  side: { position: "absolute", end: 12, gap: 12 },
  ctrl: { width: TOUCH + 4, height: TOUCH + 4, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
