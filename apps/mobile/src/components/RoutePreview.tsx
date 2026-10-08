import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useUi } from "../context";
import { fmt, fmtClock, fmtDistance, fmtDuration, fmtNumber } from "../i18n";
import { setState, useStore } from "../store";
import { REPORT_STYLE } from "../theme";
import { Btn, Chip, Icon, Panel, Row, Txt } from "./ui";

export function RoutePreview({ onStart, onDemo, onBack, onRetry, onToggleAvoid, canStart }: {
  onStart(): void; onDemo(): void; onBack(): void; onRetry(): void; onToggleAvoid(id: string): void; canStart: boolean;
}) {
  const { theme, t, fmtCtx } = useUi();
  const preview = useStore((s) => s.preview);
  const dest = useStore((s) => s.selected);
  const config = useStore((s) => s.config);
  const { result, selectedIdx, loading, error, avoidReportIds } = preview;

  const header = (
    <Row style={{ marginBottom: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t.common.close} onPress={onBack} hitSlop={12}>
        <Icon name={fmtCtx.lang === "en" ? "arrow-left" : "arrow-right"} size={26} />
      </Pressable>
      <Txt size={18} weight="bold" numberOfLines={1} style={{ flex: 1 }}>{dest?.name}</Txt>
    </Row>
  );

  if (loading) {
    return (
      <Panel>
        {header}
        <Row style={{ paddingVertical: 24, justifyContent: "center" }}>
          <ActivityIndicator color={theme.primary} />
          <Txt muted>{t.preview.loading}</Txt>
        </Row>
      </Panel>
    );
  }
  if (error || !result) {
    const msg = (t.preview.errors as Record<string, string>)[error ?? "generic"] ?? t.preview.errors.generic;
    return (
      <Panel>
        {header}
        <Row style={{ paddingVertical: 12 }}>
          <Icon name="alert-circle-outline" color={theme.danger} />
          <Txt style={{ flex: 1 }}>{msg}</Txt>
        </Row>
        {error !== "outside_service_area" && error !== "too_close" && <Btn kind="secondary" label={t.common.retry} icon="refresh" onPress={onRetry} />}
      </Panel>
    );
  }

  const route = result.routes[selectedIdx];
  const reports = result.reports.filter((r) => route.reportIdsOnRoute.includes(r.id));
  const now = Date.now();

  return (
    <Panel>
      {header}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {result.routes.map((r, i) => (
          <Pressable
            key={r.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: i === selectedIdx }}
            onPress={() => setState((st) => ({ preview: { ...st.preview, selectedIdx: i } }))}
            style={[s.card, { borderColor: i === selectedIdx ? theme.primary : theme.border, backgroundColor: i === selectedIdx ? theme.surfaceAlt : theme.surface }]}
          >
            <Txt size={22} weight="bold" style={{ color: i === selectedIdx ? theme.primary : theme.text }}>{fmtDuration(r.durationS, fmtCtx)}</Txt>
            <Txt size={14} muted>{fmtDistance(r.distanceM, fmtCtx)} · {fmt(t.nav.arrivalAt, { time: fmtClock(new Date(now + r.durationS * 1000), fmtCtx) })}</Txt>
            <Txt size={13} muted numberOfLines={1}>{i === 0 ? t.preview.fastest : t.preview.alt}{r.via.length ? ` · ${fmt(t.preview.via, { via: r.via.join("، ") })}` : ""}</Txt>
          </Pressable>
        ))}
      </ScrollView>

      {/* Honest ETA labeling: say exactly what the time is based on. */}
      <Row gap={6} style={{ marginTop: 8 }}>
        <Icon name={route.trafficExtraS ? "car-clock" : "information-outline"} size={16} color={route.trafficExtraS ? theme.warn : theme.textMuted} />
        <Txt size={13} muted style={{ flex: 1 }}>
          {route.trafficExtraS
            ? fmt(t.preview.withTraffic, { t: fmtDuration(route.trafficExtraS, fmtCtx) })
            : config?.sharedTraffic ? t.preview.noTrafficData : t.preview.noTraffic}
        </Txt>
      </Row>
      {route.avoidedClosureIds && route.avoidedClosureIds.length > 0 && (
        <Chip icon="shield-check" text={t.preview.officialAvoided} color={theme.ok} textColor="#fff" />
      )}
      {result.avoidance.requested && !result.avoidance.honoured && <Txt size={13} style={{ color: theme.warn }}>{t.preview.avoidFailed}</Txt>}

      {reports.length > 0 && (
        <View style={{ marginTop: 8, gap: 6 }}>
          <Txt size={14} weight="semibold">{fmt(t.preview.reportsOnRoute, { n: fmtNumber(reports.length, fmtCtx) })}</Txt>
          {reports.slice(0, 3).map((r) => {
            const avoiding = avoidReportIds.includes(r.id);
            return (
              <Row key={r.id} style={[s.rep, { borderColor: theme.border }]}>
                <View style={[s.dot, { backgroundColor: REPORT_STYLE[r.category].color }]}>
                  <Icon name={REPORT_STYLE[r.category].icon as any} size={16} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt size={14} weight="semibold">{t.reports.categories[r.category]}</Txt>
                  <Txt size={12} muted>{r.verified ? t.reports.official : `${t.reports.community} · ${fmt(t.reports.confidence, { p: fmtNumber(Math.round(r.confidence * 100), fmtCtx) })}`}</Txt>
                </View>
                {r.treatment === "advise" && (
                  <Btn kind={avoiding ? "primary" : "secondary"} label={avoiding ? t.preview.avoided : t.preview.avoid} onPress={() => onToggleAvoid(r.id)} style={{ minHeight: 44, paddingHorizontal: 12 }} />
                )}
              </Row>
            );
          })}
        </View>
      )}

      <Row style={{ marginTop: 12 }}>
        <Btn label={t.preview.start} icon="navigation-variant" onPress={onStart} disabled={!canStart} style={{ flex: 2 }} />
        <Btn kind="secondary" label={t.preview.demo} icon="play-circle-outline" onPress={onDemo} disabled={!canStart} style={{ flex: 1 }} accessibilityHint={t.preview.demoHint} />
      </Row>
    </Panel>
  );
}

const s = StyleSheet.create({
  card: { minWidth: 160, padding: 12, borderRadius: 16, borderWidth: 2 },
  rep: { padding: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});
