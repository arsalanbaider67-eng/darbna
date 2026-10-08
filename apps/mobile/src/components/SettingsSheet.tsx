import React, { useEffect, useState } from "react";
import { I18nManager, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { api } from "../api";
import { confirmDialog } from "../dialog";
import { useUi } from "../context";
import { fmt, isRTL, LANGS, type Lang } from "../i18n";
import { chooseVoice, resetVoiceCache } from "../nav/voice";
import { saveSettings, wipeLocalData, type Settings } from "../storage";
import { getState, setState, toast, useStore } from "../store";
import { ensureDirection } from "../rtl";
import { TOUCH } from "../theme";
import { Btn, Icon, Panel, Row, Txt } from "./ui";

export function SettingsSheet({ onClose }: { onClose(): void }) {
  const { theme, t } = useUi();
  const settings = useStore((s) => s.settings);
  const config = useStore((s) => s.config);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  useEffect(() => {
    chooseVoice(settings.lang).then((v) => {
      const name = LANGS.find((l) => l.code === v.lang)?.label ?? v.lang;
      setVoiceNote(v.fallback ? fmt(t.settings.voiceUnavailable, { lang: name }) : null);
    });
  }, [settings.lang, t]);

  function update(patch: Partial<Settings>) {
    const next = { ...getState().settings, ...patch };
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
      await api.deleteMe().catch(() => {}); // best-effort; local wipe happens regardless
      await wipeLocalData();
      setState({ saved: { favorites: [] }, recents: [], trip: null });
      toast(t.settings.deleted, "ok");
    });
  }

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
        <View style={{ gap: 6 }}>
          <Txt weight="semibold">{t.settings.theme}</Txt>
          <Seg value={settings.theme} options={[{ v: "auto", label: t.settings.themeAuto }, { v: "day", label: t.settings.themeDay }, { v: "night", label: t.settings.themeNight }]} onChange={(v) => update({ theme: v })} />
        </View>
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
        <View style={[s.box, { backgroundColor: theme.surfaceAlt }]}>
          <Txt weight="semibold">{t.settings.capabilities}</Txt>
          <Txt size={14}>{t.settings.capOfflineNav}</Txt>
          <Txt size={14}>{t.settings.capOfflineSaved}</Txt>
          <Txt size={14} muted>{t.settings.capOfflineMaps}</Txt>
          <Txt size={14} muted>{t.settings.capOfflineRouting}</Txt>
          {config?.sharedTraffic
            ? <Txt size={14}>{t.settings.capTrafficLive}</Txt>
            : <Txt size={14} muted>{t.settings.capTraffic}</Txt>}
        </View>
        <View style={{ gap: 4 }}>
          <Txt weight="semibold">{t.settings.privacy}</Txt>
          <Txt size={14} muted>{t.settings.privacyBody}</Txt>
          <Btn kind="danger" icon="delete-outline" label={t.settings.deleteData} onPress={deleteData} style={{ marginTop: 8 }} />
        </View>
        <Txt size={13} muted>
          {t.settings.version} 0.1.0
        </Txt>
      </ScrollView>
    </Panel>
  );
}

const s = StyleSheet.create({
  seg: { minHeight: TOUCH - 8, paddingHorizontal: 16, borderRadius: 14, borderWidth: 2, justifyContent: "center" },
  box: { padding: 12, borderRadius: 14, gap: 4 },
});
