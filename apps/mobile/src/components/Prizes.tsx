/**
 * Prizes: every 10 levels a driver wins a prize. The app never says what it is — only that they
 * won and how to contact support with their claim code (supabase/prizes.sql). The owner checks the
 * code and delivers the prize (phone top-up, voucher, free oil change, cash …).
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { api } from "../api";
import { useUi } from "../context";
import { fmt, fmtNumber } from "../i18n";
import { getState, setState, toast, useStore } from "../store";
import { openPage } from "../openPage";
import { contactEmail, contactPhone, contactWhatsApp, SUPPORT_PHONE, SUPPORT_WHATSAPP } from "../support";
import type { PrizeWin } from "../types";
import { Btn, Icon, Panel, Row, Txt } from "./ui";

const SEEN_KEY = "darbna:prizesSeen";
/** Official rules (apps/mobile/public/prize-rules.html, 3 languages). */
export const PRIZE_RULES_URL = "https://help.darbna.com/prize-rules";
/** Winners have 7 days to contact support (prize rules §6). */
const CLAIM_DAYS = 7;
const claimDeadline = (w: PrizeWin) => new Date(new Date(w.at).getTime() + CLAIM_DAYS * 86_400_000);
const isExpired = (w: PrizeWin) => w.status === "won" && claimDeadline(w).getTime() < Date.now();

function RulesNote() {
  const { theme, t } = useUi();
  return (
    <View style={{ gap: 2 }}>
      <Txt size={12} muted>{t.x.prize.rules}</Txt>
      <Pressable accessibilityRole="link" onPress={() => void openPage(PRIZE_RULES_URL).catch(() => toast(t.common.retry, "error"))} hitSlop={8}>
        <Txt size={13} weight="semibold" style={{ color: theme.accent }}>{t.x.prize.rulesLink}</Txt>
      </Pressable>
    </View>
  );
}

/** Refresh prizes; a newly won one (not seen on this phone yet) pops up. */
export async function checkPrizes(): Promise<void> {
  if (!getState().config?.social) return;
  try {
    const p = await api.prizes();
    setState({ prizes: p });
    const raw = await AsyncStorage.getItem(SEEN_KEY).catch(() => null);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    const fresh = p.wins.find((w) => w.status === "won" && !isExpired(w) && !seen.includes(w.code));
    if (fresh && getState().mode !== "navigating") setState({ prizePopup: fresh });
  } catch {
    // offline or database not updated yet: try again later
  }
}

async function markSeen(code: string) {
  const raw = await AsyncStorage.getItem(SEEN_KEY).catch(() => null);
  const seen: string[] = raw ? JSON.parse(raw) : [];
  if (!seen.includes(code)) await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen, code].slice(-50))).catch(() => {});
}

/** Contact buttons + code for one prize. */
function ClaimBox({ win }: { win: PrizeWin }) {
  const { theme, t } = useUi();
  const L = t.x.prize;
  const msg = fmt(L.msg, { code: win.code });
  const by = claimDeadline(win);
  return (
    <View style={{ gap: 8 }}>
      <Txt size={14}>{L.contact}</Txt>
      <Txt size={13} weight="semibold" style={{ color: theme.accent }}>{fmt(L.claimBy, { date: `${by.getDate()}/${by.getMonth() + 1}/${by.getFullYear()}` })}</Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${L.copy} ${win.code}`}
        onPress={() => { void Clipboard.setStringAsync(win.code).then(() => toast(L.copied, "ok")); }}
        style={[s.code, { borderColor: theme.accent, backgroundColor: theme.surface }]}
      >
        <Txt size={22} weight="bold" style={{ color: theme.accent, letterSpacing: 2, writingDirection: "ltr" }}>{win.code}</Txt>
        <Icon name="content-copy" size={20} color={theme.accent} />
      </Pressable>
      <Row gap={8} style={{ flexWrap: "wrap" }}>
        {!!SUPPORT_WHATSAPP && <Btn kind="primary" icon="whatsapp" label={L.whatsapp} onPress={() => void contactWhatsApp(msg).catch(() => toast(t.common.retry, "error"))} />}
        {!!SUPPORT_PHONE && <Btn kind="secondary" icon="phone" label={L.call} onPress={() => void contactPhone().catch(() => toast(t.common.retry, "error"))} />}
        <Btn kind="secondary" icon="email-outline" label={L.email} onPress={() => void contactEmail(fmt(L.subject, { code: win.code }), msg).catch(() => toast(t.common.retry, "error"))} />
      </Row>
    </View>
  );
}

/** In Settings, under your points: progress to the next prize and every prize won. */
export function PrizeSection() {
  const { theme, t, fmtCtx } = useUi();
  const L = t.x.prize;
  const social = useStore((s) => !!s.config?.social);
  const prizes = useStore((s) => s.prizes);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (social) void checkPrizes(); }, [social]);
  if (!social) return null;
  const level = prizes?.level ?? 1;
  const next = prizes?.nextMilestone ?? 10;
  const from = next - 10;
  const progress = Math.max(0, Math.min(1, (level - from) / 10));
  return (
    <View style={[s.box, { borderColor: theme.accent, backgroundColor: theme.surfaceAlt }]}>
      <Row>
        <Icon name="gift-outline" color={theme.accent} size={28} />
        <View style={{ flex: 1 }}>
          <Txt size={16} weight="bold">{L.title}</Txt>
          <Txt size={13} muted>{L.every10}</Txt>
        </View>
      </Row>
      <View style={[s.bar, { backgroundColor: theme.border }]}>
        <View style={{ width: `${Math.round(progress * 100)}%`, height: "100%", backgroundColor: theme.accent, borderRadius: 3 }} />
      </View>
      <Txt size={13}>{fmt(L.progress, { lvl: fmtNumber(level, fmtCtx), next: fmtNumber(next, fmtCtx) })}</Txt>
      {[...(prizes?.wins ?? [])].reverse().map((w) => (
        <View key={w.code} style={[s.win, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <Pressable accessibilityRole="button" onPress={() => setOpen(open === w.code ? null : w.code)}>
            <Row>
              <Icon name="gift" color={theme.accent} />
              <Txt weight="semibold" style={{ flex: 1 }}>{fmt(L.wonLevel, { n: fmtNumber(w.milestone, fmtCtx) })}</Txt>
              <Txt size={13} style={{ color: w.status === "delivered" ? theme.ok : w.status === "rejected" ? theme.danger : theme.accent }}>
                {w.status === "delivered" ? L.delivered : w.status === "rejected" ? L.rejected : isExpired(w) ? L.expired : L.won}
              </Txt>
            </Row>
          </Pressable>
          {(open === w.code || (w.status === "won" && !isExpired(w))) && w.status !== "delivered" && !isExpired(w) && <ClaimBox win={w} />}
        </View>
      ))}
      <RulesNote />
    </View>
  );
}

/** "Congratulations! You won a prize" — shown once per prize. */
export function PrizePopup() {
  const { theme, t, fmtCtx } = useUi();
  const L = t.x.prize;
  const win = useStore((s) => s.prizePopup);
  const mode = useStore((s) => s.mode);
  if (!win || mode === "navigating") return null;
  const close = () => { void markSeen(win.code); setState({ prizePopup: null }); };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable accessibilityLabel={t.common.close} style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.45)" }]} onPress={close} />
      <Panel>
        <Row style={{ marginBottom: 4 }}>
          <Icon name="gift" color={theme.accent} size={34} />
          <Txt size={22} weight="bold" style={{ flex: 1 }}>{L.congrats} {L.won}</Txt>
          <Pressable accessibilityRole="button" accessibilityLabel={t.common.close} onPress={close} hitSlop={12}><Icon name="close" /></Pressable>
        </Row>
        <Txt size={15} style={{ marginBottom: 8 }}>{fmt(L.popupBody, { n: fmtNumber(win.milestone, fmtCtx) })}</Txt>
        <ClaimBox win={win} />
        <View style={{ marginTop: 8 }}><RulesNote /></View>
        <Btn kind="ghost" label={L.later} onPress={close} style={{ marginTop: 6 }} />
      </Panel>
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 1.5, borderRadius: 16, padding: 12, gap: 8 },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
  win: { borderWidth: 1, borderRadius: 14, padding: 10, gap: 8 },
  code: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 2, borderStyle: "dashed", borderRadius: 14, paddingVertical: 10 },
});
