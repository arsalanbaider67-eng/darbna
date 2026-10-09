import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { freshness, REPORT_CATEGORIES, type LocationFix, type ReportCategory } from "@darbna/core";
import { api, ApiError } from "../api";
import { useUi } from "../context";
import { fmt, fmtClock, fmtNumber } from "../i18n";
import { loadQueue, saveQueue } from "../storage";
import { mergeReports, removeReport, toast, useStore } from "../store";
import { REPORT_STYLE, TOUCH } from "../theme";
import { refreshPoints } from "./Extras";
import { Btn, Chip, Icon, Panel, Row, Txt } from "./ui";

const STOPPED_MPS = 2; // ~7 km/h

/** Quick reporting: one tap per category, only when stopped (or for passengers). */
export function ReportSheet({ fix, online, onClose }: { fix: LocationFix | null; online: boolean | null; onClose(): void }) {
  const { theme, t } = useUi();
  const [passenger, setPassenger] = useState(false);
  const [busy, setBusy] = useState<ReportCategory | null>(null);
  const moving = (fix?.speedMps ?? 0) > STOPPED_MPS;
  const allowed = !!fix && (!moving || passenger);

  async function send(category: ReportCategory) {
    if (!fix) return;
    const heading = fix.headingDeg != null && fix.headingDeg >= 0 ? fix.headingDeg : undefined;
    setBusy(category);
    try {
      if (online === false) throw new ApiError("offline");
      const r = await api.createReport(category, fix.coord, heading);
      mergeReports([r.report]);
      toast(r.duplicate ? t.reports.merged : t.reports.sent, "ok");
      onClose();
      // Points for helping: show what this report earned.
      void refreshPoints().then((n) => { if (n && n > 0) toast(`${r.duplicate ? t.reports.merged : t.reports.sent} ${fmt(t.x.points.earned, { n })}`, "ok"); });
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork) {
        const q = await loadQueue();
        await saveQueue([...q, { category, coord: fix.coord, heading, queuedAt: Date.now() }]);
        toast(t.reports.failedQueued, "info");
        onClose();
      } else if (e instanceof ApiError && e.code === "rate_limited") toast(t.reports.rateLimited, "error");
      else toast(t.common.retry, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel>
      <Row style={{ marginBottom: 8 }}>
        <Txt size={20} weight="bold" style={{ flex: 1 }}>{t.reports.title}</Txt>
        <Pressable accessibilityLabel={t.common.close} onPress={onClose} hitSlop={12}><Icon name="close" /></Pressable>
      </Row>
      {moving && (
        <Row style={[s.warn, { backgroundColor: theme.surfaceAlt }]}>
          <Icon name="steering" color={theme.warn} />
          <Txt size={14} style={{ flex: 1 }}>{t.reports.onlyWhenStopped}</Txt>
          <Txt size={14} weight="semibold">{t.reports.imPassenger}</Txt>
          <Switch value={passenger} onValueChange={setPassenger} accessibilityLabel={t.reports.imPassenger} />
        </Row>
      )}
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={s.grid}>
        {REPORT_CATEGORIES.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={t.reports.categories[c]}
            accessibilityState={{ disabled: !allowed }}
            disabled={!allowed || busy !== null}
            onPress={() => send(c)}
            style={({ pressed }) => [s.cell, { backgroundColor: theme.surfaceAlt, borderColor: theme.border, opacity: !allowed ? 0.4 : pressed || busy === c ? 0.7 : 1 }]}
          >
            <View style={[s.circle, { backgroundColor: REPORT_STYLE[c].color }]}>
              <Icon name={REPORT_STYLE[c].icon as any} size={26} color="#fff" />
            </View>
            <Txt size={14} weight="semibold" numberOfLines={2} style={{ textAlign: "center" }}>{t.reports.categories[c]}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </Panel>
  );
}

/** Details for a report on the map: freshness, confidence, source, and the community vote buttons. */
export function ReportDetails({ id, onClose }: { id: string; onClose(): void }) {
  const { theme, t, fmtCtx } = useUi();
  const r = useStore((s) => s.reports[id]);
  const social = useStore((s) => !!s.config?.social);
  const [busy, setBusy] = useState(false);
  if (!r) return null;
  const f = freshness(new Date(r.createdAt));
  const fresh = fmt(t.reports.freshness[f.bucket], {
    n: fmtNumber(f.bucket === "minutes" ? f.minutes : f.bucket === "hours" ? Math.floor(f.minutes / 60) : Math.floor(f.minutes / 1440), fmtCtx),
  });

  async function thank() {
    setBusy(true);
    try {
      const res = await api.thank(r.id);
      mergeReports([res.report]);
      toast(t.x.thanks.done, "ok");
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      toast(code === "already_thanked" ? t.x.thanks.already : code === "own_report" ? t.reports.own : t.common.retry, "error");
    } finally {
      setBusy(false);
    }
  }

  async function vote(v: "confirm" | "gone" | "flag") {
    setBusy(true);
    try {
      const res = await api.vote(r.id, v);
      // After "not there"/flag, hide it for this user right away; the server decides for everyone.
      if (v === "confirm") mergeReports([res.report]);
      else removeReport(r.id);
      toast(t.reports.voted, "ok");
      onClose();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      toast(code === "already_voted" ? t.reports.alreadyVoted : code === "own_report" ? t.reports.own : code === "rate_limited" ? t.reports.rateLimited : t.common.retry, "error");
      if (code === "report_not_active") { removeReport(r.id); onClose(); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <Row>
        <View style={[s.circleSm, { backgroundColor: REPORT_STYLE[r.category].color }]}>
          <Icon name={REPORT_STYLE[r.category].icon as any} size={22} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={19} weight="bold">{t.reports.categories[r.category]}</Txt>
          <Txt size={14} muted>{fresh} · {fmt(t.reports.expires, { time: fmtClock(new Date(r.expiresAt), fmtCtx) })}</Txt>
        </View>
        <Pressable accessibilityLabel={t.common.close} onPress={onClose} hitSlop={12}><Icon name="close" /></Pressable>
      </Row>
      <Row style={{ marginTop: 8, flexWrap: "wrap" }}>
        {r.verified
          ? <Chip icon="shield-check" text={t.reports.official} color={theme.ok} textColor="#fff" />
          : <Chip icon="account-group" text={t.reports.community} color={theme.surfaceAlt} textColor={theme.text} />}
        {!r.verified && <Chip text={fmt(t.reports.confidence, { p: fmtNumber(Math.round(r.confidence * 100), fmtCtx) })} color={theme.surfaceAlt} textColor={theme.text} />}
        {r.confirms > 0 && <Chip text={fmt(t.reports.confirms, { n: fmtNumber(r.confirms, fmtCtx) })} color={theme.surfaceAlt} textColor={theme.text} />}
        {(r.thanks ?? 0) > 0 && <Chip icon="thumb-up" text={fmt(t.x.thanks.count, { n: fmtNumber(r.thanks ?? 0, fmtCtx) })} color={theme.surfaceAlt} textColor={theme.primary} />}
        {r.isSample && <Chip icon="flask-outline" text={t.reports.sample} color={theme.accent} textColor={theme.onAccent} />}
      </Row>
      {r.officialRef && <Txt size={13} muted style={{ marginTop: 6 }}>{r.officialRef}</Txt>}
      {!r.verified && (
        <>
          <Row style={{ marginTop: 12 }}>
            <Btn label={t.reports.stillThere} icon="thumb-up-outline" onPress={() => vote("confirm")} loading={busy} style={{ flex: 1 }} />
            <Btn kind="secondary" label={t.reports.notThere} icon="close-circle-outline" onPress={() => vote("gone")} disabled={busy} style={{ flex: 1 }} />
          </Row>
          {social && !r.isSample && (
            <Btn kind="ghost" icon="thumb-up-outline" label={t.x.thanks.button} onPress={() => void thank()} disabled={busy} style={{ marginTop: 6, borderColor: theme.border }} />
          )}
          <Pressable onPress={() => vote("flag")} disabled={busy} style={{ minHeight: TOUCH - 12, justifyContent: "center", alignItems: "center" }}>
            <Txt size={13} style={{ color: theme.danger }}>{t.reports.flag}</Txt>
          </Pressable>
        </>
      )}
    </Panel>
  );
}

/** Send queued reports when back online; drop ones older than 15 minutes (stale reports mislead). */
export async function flushReportQueue(): Promise<void> {
  const q = await loadQueue();
  if (!q.length) return;
  const keep: typeof q = [];
  for (const r of q) {
    if (Date.now() - r.queuedAt > 15 * 60_000) continue;
    try {
      const res = await api.createReport(r.category, r.coord, r.heading);
      mergeReports([res.report]);
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork) keep.push(r);
    }
  }
  await saveQueue(keep);
}

const s = StyleSheet.create({
  warn: { padding: 10, borderRadius: 12, marginBottom: 8, flexWrap: "wrap" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" },
  cell: { width: "31%", minHeight: 96, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", gap: 6, padding: 8 },
  circle: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  circleSm: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
