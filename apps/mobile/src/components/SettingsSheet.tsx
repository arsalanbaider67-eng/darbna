import Constants from "expo-constants";
import React, { useEffect, useState } from "react";
import { I18nManager, Linking, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { api } from "../api";
import { confirmDialog } from "../dialog";
import { useUi } from "../context";
import { openPage } from "../openPage";
import { fmt, isRTL, LANGS, type Lang } from "../i18n";
import { chooseVoice, resetVoiceCache } from "../nav/voice";
import { hasRecordedVoice, primeVoice, stopSpeaking } from "../nav/prompt";
import { playClips } from "../nav/clipPlayer";
import { VOICE_CLIPS } from "../nav/voiceClips";
import { deleteUserData } from "../privacyControls";
import { clearOffline, offlineSummary, type OfflineResult, type OfflineSummary } from "../offline";
import { saveSettings, wipeLocalData, type Settings } from "../storage";
import { PointsCard } from "./Extras";
import { PrizeSection } from "./Prizes";
import { contactEmail, contactPhone, contactWhatsApp, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_WHATSAPP } from "../support";
import { getState, setState, toast, useStore } from "../store";
import { ensureDirection } from "../rtl";
import { TOUCH } from "../theme";
import { Btn, Icon, Panel, Row, Txt } from "./ui";

export function SettingsSheet({ onClose, onDownloadArea }: { onClose(): void; onDownloadArea?: (onProgress: (pct: number) => void) => Promise<OfflineResult> }) {
  const { theme, t } = useUi();
  const settings = useStore((s) => s.settings);
  const config = useStore((s) => s.config);
  const [deleting, setDeleting] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [offline, setOffline] = useState<OfflineSummary | null>(null);
  const [dlPct, setDlPct] = useState<number | null>(null);

  useEffect(() => { void offlineSummary().then(setOffline); }, []);

  async function download() {
    if (!onDownloadArea || dlPct !== null) return;
    setDlPct(0);
    const r = await onDownloadArea((p) => setDlPct(p)).catch(() => "failed" as const);
    setDlPct(null);
    if (r === "ok") toast(t.settings.downloadDone, "ok");
    else if (r === "too_big") toast(t.settings.offlineZoomIn, "error");
    else toast(t.settings.downloadFailed, "error");
    setOffline(await offlineSummary());
  }

  async function removeOffline() {
    await clearOffline();
    setOffline(await offlineSummary());
  }

  useEffect(() => {
    chooseVoice(settings.lang).then((v) => {
      const name = LANGS.find((l) => l.code === v.lang)?.label ?? v.lang;
      // The recorded voices (Arabic, English) don't depend on what's installed on the phone.
      setVoiceNote(v.fallback && !(settings.lang !== "ckb" && hasRecordedVoice(settings.lang)) ? fmt(t.settings.voiceUnavailable, { lang: name }) : null);
    });
  }, [settings.lang, t]);

  function update(patch: Partial<Settings>) {
    const next = { ...getState().settings, ...patch, ...(patch.shareTraffic !== undefined ? { trafficConsentVersion: 1 } : {}) };
    setState({ settings: next });
    void saveSettings(next);
  }

  async function changeLang(lang: Lang) {
    resetVoiceCache();
    update({ lang });
    if (isRTL(lang) !== I18nManager.isRTL) {
      toast(t.settings.restartNeeded);
      setTimeout(() => void ensureDirection(isRTL(lang)), 600);
    }
  }

  function deleteData() {
    void confirmDialog(t.settings.deleteData, t.settings.deleteConfirm, t.settings.deleteData, t.common.cancel, true).then(async (yes) => {
      if (!yes) return;
      if (deleting) return;
      setDeleting(true);
      try {
        await deleteUserData({
          stop: () => { stopSpeaking(); setState({ trip: null, share: null }); },
          removeRemote: () => api.deleteMe(),
          wipeLocal: wipeLocalData,
          finish: () => { setState({ saved: { favorites: [] }, recents: [], trip: null, reports: {}, points: null, parked: null, stops: [], mode: "browse" }); toast(t.settings.deleted, "ok"); },
        });
      } catch { toast(t.settings.deleteFailed, "error"); }
      finally { setDeleting(false); }
    });
  }

  async function testVoice() {
    const clips = VOICE_CLIPS[settings.lang === "en" ? "en" : "ar"];
    if (!clips?.d_200m || !clips?.mv_right) return toast(t.journey.voiceMissing, "error");
    primeVoice(settings.lang);
    const ok = await playClips([clips.d_200m, clips.mv_right], true).catch(() => false);
    toast(ok ? t.journey.voicePlaying : t.journey.voiceMissing, ok ? "info" : "error");
  }
  const openInfo = (url: string) => void openPage(url).catch(() => toast(t.common.retry, "error"));

  const Seg = <T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange(v: T): void }) => (
    <Row gap={6} style={{ flexWrap: "wrap" }}>
      {options.map((o) => (
        <Pressable
          key={o.v}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === o.v }}
          onPress={() => onChange(o.v)}
          style={[s.seg, { borderColor: value === o.v ? theme.primary : theme.border, backgroundColor: value === o.v ? theme.primary : theme.surface }]}
        >
          <Txt weight="semibold" style={{ color: value === o.v ? theme.onPrimary : theme.text }}>{o.label}</Txt>
        </Pressable>
      ))}
    </Row>
  );

  return (
    <Panel style={{ maxHeight: "88%" }}>
      <Row style={{ marginBottom: 8 }}>
        <Txt size={20} weight="bold" style={{ flex: 1 }}>{t.settings.title}</Txt>
        <Pressable accessibilityLabel={t.common.close} onPress={onClose} hitSlop={12}><Icon name="close" /></Pressable>
      </Row>
      <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 8 }}>
        <View style={{ gap: 6 }}>
          <Txt weight="semibold">{t.settings.language}</Txt>
          <Seg value={settings.lang} options={LANGS.map((l) => ({ v: l.code, label: l.label }))} onChange={changeLang} />
        </View>
        <PointsCard />
        <PrizeSection />
        <Btn kind="secondary" icon="alarm-light-outline" label={t.x.sos.title} onPress={() => setState({ sheet: "sos" })} style={{ borderColor: theme.danger }} />
        <Btn kind="secondary" icon="satellite-variant" label={t.x.sat.open} onPress={() => setState({ sheet: "satellites" })} />
        <Row>
          <View style={{ flex: 1 }}>
            <Txt weight="semibold">{t.x.speed.alerts}</Txt>
            <Txt size={13} muted>{t.x.speed.alertsHint}</Txt>
          </View>
          <Switch value={settings.speedAlerts !== false} onValueChange={(v) => update({ speedAlerts: v })} accessibilityLabel={t.x.speed.alerts} />
        </Row>
        <Row>
          <View style={{ flex: 1 }}>
            <Txt weight="semibold">{t.settings.voice}</Txt>
            {voiceNote && <Txt size={13} style={{ color: theme.warn }}>{voiceNote}</Txt>}
          </View>
          <Switch value={settings.voice} onValueChange={(v) => update({ voice: v })} accessibilityLabel={t.settings.voice} />
        </Row>
        {config?.sharedTraffic && (
          <Row>
            <View style={{ flex: 1 }}>
              <Txt weight="semibold">{t.settings.shareTraffic}</Txt>
              <Txt size={13} muted>{t.settings.shareTrafficHint}</Txt>
            </View>
            <Switch value={settings.shareTraffic !== false} onValueChange={(v) => update({ shareTraffic: v })} accessibilityLabel={t.settings.shareTraffic} />
          </Row>
        )}
        {settings.lang !== "en" && (
          <View style={{ gap: 6 }}>
            <Txt weight="semibold">{t.settings.digits}</Txt>
            <Seg value={settings.digits} options={[{ v: "western", label: t.settings.digitsWestern }, { v: "arabic", label: t.settings.digitsArabic }]} onChange={(v) => update({ digits: v })} />
          </View>
        )}
        <View style={{ gap: 6 }}>
          <Txt weight="semibold">{t.settings.offlineTitle}</Txt>
          <Txt size={13} muted>{t.settings.offlineHint}</Txt>
          {offline && offline.areas > 0 && (
            <Txt size={13}>{fmt(t.settings.offlineSaved, { n: String(offline.areas), mb: (offline.bytes / 1e6).toFixed(0) })}</Txt>
          )}
          <Btn
            kind="secondary"
            icon="download-outline"
            label={dlPct !== null ? fmt(t.settings.downloading, { p: String(dlPct) }) : t.settings.downloadArea}
            onPress={download}
            disabled={!onDownloadArea || dlPct !== null}
          />
          {offline && offline.areas > 0 && dlPct === null && (
            <Btn kind="ghost" icon="trash-can-outline" label={t.settings.offlineClear} onPress={removeOffline} />
          )}
        </View>
        <View style={[s.box, { backgroundColor: theme.surfaceAlt }]}>
          <Txt weight="semibold">{t.settings.capabilities}</Txt>
          <Txt size={14}>{t.settings.capOfflineNav}</Txt>
          <Txt size={14}>{t.settings.capOfflineSaved}</Txt>
          <Txt size={14}>{t.settings.capOfflineMapsOn}</Txt>
          <Txt size={14} muted>{t.settings.capOfflineRouting}</Txt>
          {config?.sharedTraffic
            ? <Txt size={14}>{t.settings.capTrafficLive}</Txt>
            : <Txt size={14} muted>{t.settings.capTraffic}</Txt>}
        </View>
        <View style={{ gap: 4 }}>
          <Txt weight="semibold">{t.settings.privacy}</Txt>
          <Txt size={14} muted>{t.settings.privacyBody}</Txt>
          <Btn kind="ghost" icon="shield-check" label={t.settings.privacyLink} onPress={() => openInfo("https://help.darbna.com/privacy")} />
          <Btn kind="ghost" icon="help-circle-outline" label={t.settings.supportLink} onPress={() => openInfo("https://help.darbna.com/support")} />
          <Txt weight="semibold" style={{ marginTop: 6 }}>{t.settings.contactSupport}</Txt>
          <Row gap={8} style={{ flexWrap: "wrap" }}>
            {!!SUPPORT_WHATSAPP && <Btn kind="secondary" icon="whatsapp" label={t.x.prize.whatsapp} onPress={() => void contactWhatsApp(t.settings.supportHello).catch(() => toast(t.common.retry, "error"))} />}
            {!!SUPPORT_PHONE && <Btn kind="secondary" icon="phone" label={t.x.prize.call} onPress={() => void contactPhone().catch(() => toast(t.common.retry, "error"))} />}
            <Btn kind="secondary" icon="email-outline" label={SUPPORT_EMAIL} onPress={() => void contactEmail("Darbna", t.settings.supportHello).catch(() => toast(t.common.retry, "error"))} />
          </Row>
          <Btn kind="secondary" icon="volume-high" label={t.journey.voiceTest} onPress={() => void testVoice()} />
          <Btn kind="danger" icon="delete-outline" label={t.settings.deleteData} onPress={deleteData} disabled={deleting} style={{ marginTop: 8 }} />
        </View>
        <Txt size={13} muted>
          {t.settings.version} {Constants.expoConfig?.version ?? "1.0.0"}
        </Txt>
      </ScrollView>
    </Panel>
  );
}

const s = StyleSheet.create({
  seg: { minHeight: TOUCH - 8, paddingHorizontal: 16, borderRadius: 14, borderWidth: 2, justifyContent: "center" },
  box: { padding: 12, borderRadius: 14, gap: 4 },
});
