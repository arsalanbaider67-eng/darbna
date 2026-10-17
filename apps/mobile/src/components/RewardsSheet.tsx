import React, { useEffect, useRef, useState } from "react";
import { Linking, ScrollView, Switch, TextInput, View } from "react-native";
import { normalizeRewardContact, rewardMilestones, PLANNED_REWARD_ODDS, type RewardContactMethod } from "@darbna/core";
import { useUi } from "../context";
import { fmt, fmtNumber } from "../i18n";
import { ApiError } from "../apiError";
import { claimReward, drawReward, getRewards, type RewardDraw, type RewardsView } from "../rewards";
import { useStore } from "../store";
import { Btn, Panel, Row, Txt } from "./ui";

const METHODS: RewardContactMethod[] = ["email", "whatsapp", "phone", "telegram"];
export function RewardsSheet({ onClose }: { onClose(): void }) {
  const { theme, t, fmtCtx } = useUi();
  const lang = useStore(s => s.settings.lang);
  const driving = useStore(s => s.mode === "navigating");
  const [data, setData] = useState<RewardsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RewardDraw | null>(null);
  const [drawConsent, setDrawConsent] = useState(false);
  const [method, setMethod] = useState<RewardContactMethod>("email");
  const [contact, setContact] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const currentRequest = useRef(0);
  const text = (value: Record<string,string>) => value[lang] ?? value.ar ?? value.en ?? "";
  async function load() {
    const request = ++currentRequest.current;
    setLoading(true); setNotice(null);
    try { const view = await getRewards(); if (request === currentRequest.current) setData(view); }
    catch { if (request === currentRequest.current) setNotice(t.rewards.unavailable); }
    finally { if (request === currentRequest.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { currentRequest.current++; }; }, []);
  const progress = rewardMilestones(data?.points ?? 0);
  const rulesReady = !!data && ["ar","en","ckb"].every(l => (data.terms[l]?.length ?? 0) >= 30);
  async function submit() {
    if (!selected || !data || lock.current || driving || !consent) return;
    const normalized = normalizeRewardContact(method, contact);
    if (!normalized) return setNotice(t.rewards.badContact);
    lock.current = true; setBusy(true); setNotice(null);
    try {
      await claimReward(selected, method, normalized);
      setContact(""); setConsent(false); setSelected(null);
      await load(); setNotice(t.rewards.submitted);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setNotice(code === "already_claimed" ? t.rewards.alreadyClaimed : code === "bad_contact" ? t.rewards.badContact
        : ["offer_changed","terms_changed","offer_unavailable","program_closed","not_eligible"].includes(code) ? t.rewards.changed : t.rewards.retryClaim);
    } finally { lock.current = false; setBusy(false); }
  }
  async function draw(milestone: number) {
    if (!data || lock.current || driving || !drawConsent) return;
    lock.current = true; setBusy(true); setNotice(null);
    try { await drawReward(milestone, data.termsVersion, data.poolRevision); await load(); setDrawConsent(false); }
    catch { setNotice(t.rewards.drawRetry); }
    finally { lock.current = false; setBusy(false); }
  }
  const unclaimedMilestones = [...new Set(data?.offers.map(o => o.milestone) ?? [])]
    .filter(m => m <= progress.level && !data?.draws.some(d => d.milestone === m)).sort((a,b) => a-b).slice(0,20);
  return <Panel style={{ maxHeight: "88%" }}>
    <Row><Txt size={21} weight="bold" style={{ flex: 1 }}>{t.rewards.title}</Txt><Btn kind="ghost" label={t.common.close} onPress={onClose} disabled={busy} /></Row>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16, paddingBottom: 12 }}>
      <Txt muted>{t.rewards.intro}</Txt>
      {driving && <Txt style={{ color: theme.warn }}>{t.rewards.parkFirst}</Txt>}
      {loading && <Txt>{t.common.loading}</Txt>}
      {notice && <Txt accessibilityLiveRegion="polite" style={{ color: theme.primary }}>{notice}</Txt>}
      {!loading && <Btn kind="ghost" label={t.common.retry} disabled={busy} onPress={() => { setSelected(null); setContact(""); setConsent(false); void load(); }} />}
      {data && <>
        <View style={{ backgroundColor: theme.surfaceAlt, padding: 14, borderRadius: 14, gap: 6 }}>
          <Txt size={23} weight="bold">{fmt(t.x.points.level, { n: fmtNumber(progress.level, fmtCtx) })}</Txt>
          <Txt>{fmt(t.rewards.progress, { points: fmtNumber(data.points, fmtCtx), level: fmtNumber(progress.next, fmtCtx) })}</Txt>
          <Txt size={13} muted>{t.rewards.earn}</Txt>
        </View>
        {(!data.enabled || !rulesReady) && <Txt>{t.rewards.closed}</Txt>}
        {data.enabled && !data.offers.length && <Txt>{t.rewards.noOffers}</Txt>}
        {data.enabled && rulesReady && <>
          <Txt weight="bold">{t.rewards.rules}</Txt><Txt>{text(data.terms)}</Txt>
          {PLANNED_REWARD_ODDS.map(o => <Txt key={o.kind}>{t.rewards.kinds[o.kind]} · {fmtNumber(o.units / 200, fmtCtx)}%</Txt>)}
          <Row><Txt style={{ flex: 1 }}>{t.rewards.drawConsent}</Txt><Switch accessibilityLabel={t.rewards.drawConsent} disabled={busy || driving} value={drawConsent} onValueChange={setDrawConsent} /></Row>
        </>}
        {unclaimedMilestones.map(m => {
          const pool = data.offers.filter(o => o.milestone === m);
          const ready = data.enabled && rulesReady && pool.length === 4 && pool.every(o => o.available > 0)
            && PLANNED_REWARD_ODDS.every(expected => pool.some(o => o.kind === expected.kind && o.weight === expected.units));
          return <View key={m} style={{ gap: 8 }}><Txt weight="bold">{fmt(t.x.points.level, { n: fmtNumber(m, fmtCtx) })}</Txt>
            {pool.map(o => <Txt key={o.id}>{text(o.title)} · {text(o.detail)}</Txt>)}
            <Btn label={t.rewards.draw} disabled={!ready || !drawConsent || busy || driving} onPress={() => void draw(m)} />
          </View>;
        })}
        {data.draws.map(d => <View key={d.id} style={{ gap: 8, borderColor: theme.border, borderWidth: 1, padding: 14, borderRadius: 14 }}>
          <Txt weight="bold">{fmt(t.x.points.level, { n: fmtNumber(d.milestone, fmtCtx) })} · {text(d.title)}</Txt><Txt>{text(d.detail)}</Txt>
          {!data.claims.some(c => c.milestone === d.milestone) && <Btn label={t.rewards.claim} disabled={busy || driving} onPress={() => { setSelected(d); setContact(""); setConsent(false); }} />}
        </View>)}
        {selected && <View style={{ gap: 12, backgroundColor: theme.surfaceAlt, padding: 14, borderRadius: 14 }}>
          <Txt weight="bold">{text(selected.title)}</Txt><Txt>{t.rewards.contactHint}</Txt>
          <Row style={{ flexWrap: "wrap" }}>{METHODS.map(m => <Btn key={m} kind={method === m ? "primary" : "secondary"} label={t.rewards.methods[m]} disabled={busy} onPress={() => { setMethod(m); setContact(""); setConsent(false); }} />)}</Row>
          <TextInput accessibilityLabel={t.rewards.methods[method]} placeholder={method === "email" ? "name@example.com" : method === "telegram" ? "@username" : "+964…"} placeholderTextColor={theme.textMuted}
            value={contact} editable={!busy && !driving} onChangeText={setContact} autoCapitalize="none" autoCorrect={false} keyboardType={method === "email" ? "email-address" : method === "phone" || method === "whatsapp" ? "phone-pad" : "default"}
            style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12, minHeight: 48, color: theme.text, writingDirection: "ltr", textAlign: "left" }} maxLength={254} />
          <Txt weight="bold">{t.rewards.rules}</Txt><Txt>{text(selected.terms)}</Txt>
          <Row><Txt style={{ flex: 1 }}>{t.rewards.consent}</Txt><Switch accessibilityLabel={t.rewards.consent} value={consent} disabled={busy || driving} onValueChange={setConsent} /></Row>
          <Btn label={t.rewards.submit} loading={busy} disabled={!consent || driving || !contact.trim()} onPress={() => void submit()} />
        </View>}
        <Txt weight="bold">{t.rewards.history}</Txt>
        {!data.claims.length && <Txt muted>{t.rewards.noClaims}</Txt>}
        {data.claims.map(c => <View key={c.id} style={{ gap: 4, paddingVertical: 8 }}><Txt weight="semibold">{fmt(t.x.points.level, { n: fmtNumber(c.milestone, fmtCtx) })} · {text(c.title)}</Txt><Txt>{t.rewards.status[c.status]}</Txt>{c.note && <Txt muted>{c.note}</Txt>}</View>)}
      </>}
      <Btn kind="ghost" label={t.rewards.support} onPress={() => void Linking.openURL("mailto:darbnaiq@gmail.com")} />
    </ScrollView>
  </Panel>;
}
