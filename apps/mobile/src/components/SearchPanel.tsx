import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { arabicKey, haversine, latinKey, parseSharedLocation, type LngLat } from "@darbna/core";
import { api, ApiError } from "../api";
import { useUi } from "../context";
import { fmtDistance } from "../i18n";
import { getState, setState, useStore } from "../store";
import { font, TOUCH } from "../theme";
import type { Place } from "../types";
import { Icon, Row, Txt, type IconName } from "./ui";

interface Props {
  online: boolean | null;
  userCoord: LngLat | null;
  onPick(place: Place): void;
  onSettings(): void;
}

const KIND_ICON: Record<string, IconName> = {
  city: "city-variant-outline", governorate: "map-outline", district: "map-outline", neighborhood: "home-group",
  landmark: "star-four-points-outline", street: "road-variant", pin: "map-marker-outline", shared: "share-variant",
};

/** Offline fallback: match saved & recent places with the same normalization as the server. */
function localMatch(q: string, places: Place[]): Place[] {
  const a = arabicKey(q), l = latinKey(q);
  return places.filter((p) => (a && arabicKey(p.name).includes(a)) || (l && latinKey(p.name).includes(l)));
}

export function SearchBar({ onFocus, onSettings }: { onFocus(): void; onSettings(): void }) {
  const { theme, t } = useUi();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.barWrap, { top: insets.top + 8 }]}>
      <Pressable
        accessibilityRole="search"
        accessibilityLabel={t.search.placeholder}
        onPress={onFocus}
        style={[s.bar, { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow }]}
      >
        <Icon name="magnify" size={26} color={theme.primary} />
        <Txt size={18} muted style={{ flex: 1 }}>{t.search.placeholder}</Txt>
        <Pressable accessibilityRole="button" accessibilityLabel={t.settings.title} onPress={onSettings} hitSlop={12} style={s.barIcon}>
          <Icon name="cog-outline" size={24} color={theme.textMuted} />
        </Pressable>
      </Pressable>
    </View>
  );
}

export function SearchPanel({ online, userCoord, onPick }: Props) {
  const { theme, t, fmtCtx } = useUi();
  const insets = useSafeAreaInsets();
  const lang = useStore((s) => s.settings.lang);
  const saved = useStore((s) => s.saved);
  const recents = useStore((s) => s.recents);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [state, setStatus] = useState<"idle" | "loading" | "error" | "offline" | "partial">("idle");
  const [pasteError, setPasteError] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults(null);
      setStatus("idle");
      return;
    }
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      if (online === false) {
        setResults(localMatch(query, [...(saved.home ? [saved.home] : []), ...(saved.work ? [saved.work] : []), ...saved.favorites, ...recents]));
        setStatus("offline");
        return;
      }
      setStatus("loading");
      try {
        const r = await api.search(query, lang, userCoord ?? undefined);
        if (id !== seq.current) return;
        setResults(r.results);
        setStatus(r.partial ? "partial" : "idle");
      } catch (e) {
        if (id !== seq.current) return;
        setStatus(e instanceof ApiError && e.isNetwork ? "offline" : "error");
        setResults(localMatch(query, [...saved.favorites, ...recents]));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, online, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  async function paste() {
    setPasteError(false);
    const text = await Clipboard.getStringAsync().catch(() => "");
    const loc = parseSharedLocation(text ?? "");
    if (!loc) return setPasteError(true);
    onPick({ id: `shared:${loc.coord.join(",")}`, name: loc.label ?? t.kinds.shared, kind: "shared", coord: loc.coord });
  }

  const quick = useMemo(() => {
    const items: { place?: Place; label: string; icon: IconName; hint?: string }[] = [
      { place: saved.home, label: t.saved.home, icon: "home", hint: saved.home ? undefined : t.saved.setHomeHint },
      { place: saved.work, label: t.saved.work, icon: "briefcase", hint: saved.work ? undefined : t.saved.setWorkHint },
    ];
    return items;
  }, [saved, t]);

  const list: { header?: string; place?: Place }[] = results
    ? results.map((p) => ({ place: p }))
    : [
        ...(saved.favorites.length ? [{ header: t.saved.favorites }, ...saved.favorites.map((p) => ({ place: p }))] : []),
        ...(recents.length ? [{ header: t.search.recent }, ...recents.map((p) => ({ place: p }))] : []),
      ];

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg, paddingTop: insets.top + 8 }]}>
      <View style={[s.inputRow, { backgroundColor: theme.surface, borderColor: theme.primary }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t.common.close} hitSlop={12} onPress={() => { Keyboard.dismiss(); setState({ mode: getState().selected ? "place" : "browse" }); }}>
          {/* Back arrow mirrors with layout direction: forward in RTL is leftwards. */}
          <Icon name={fmtCtx.lang === "en" ? "arrow-left" : "arrow-right"} size={26} />
        </Pressable>
        <TextInput
          autoFocus
          value={q}
          onChangeText={setQ}
          placeholder={t.search.placeholder}
          placeholderTextColor={theme.textMuted}
          returnKeyType="search"
          autoCorrect={false}
          style={[s.input, { color: theme.text, fontFamily: font.regular}]}
        />
        {state === "loading" ? <ActivityIndicator color={theme.primary} /> : q ? (
          <Pressable accessibilityLabel={t.search.clear} hitSlop={12} onPress={() => setQ("")}><Icon name="close-circle" size={22} color={theme.textMuted} /></Pressable>
        ) : null}
      </View>

      {!results && (
        <View style={s.quickRow}>
          {quick.map((qi) => (
            <Pressable
              key={qi.label}
              accessibilityRole="button"
              accessibilityLabel={qi.label}
              onPress={() => (qi.place ? onPick(qi.place) : setState({ mode: "browse" }))}
              style={[s.quick, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Icon name={qi.icon} size={22} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <Txt weight="semibold">{qi.label}</Txt>
                {qi.hint ? <Txt size={12} muted numberOfLines={1}>{qi.hint}</Txt> : <Txt size={12} muted numberOfLines={1}>{qi.place?.name}</Txt>}
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {!results && (
        <Pressable accessibilityRole="button" onPress={paste} style={[s.paste, { borderColor: theme.border }]}>
          <Icon name="clipboard-text-outline" size={22} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <Txt weight="semibold">{t.search.pasteLocation}</Txt>
            <Txt size={12} muted>{pasteError ? t.search.pasteFailed : t.search.pasteHint}</Txt>
          </View>
        </Pressable>
      )}

      {(state === "offline" || state === "error" || state === "partial") && (
        <Row style={[s.notice, { backgroundColor: theme.surfaceAlt }]}>
          <Icon name={state === "offline" ? "wifi-off" : "alert-circle-outline"} size={18} color={theme.warn} />
          <Txt size={14} style={{ flex: 1 }}>{state === "offline" ? t.search.offline : state === "partial" ? t.search.partial : t.search.error}</Txt>
        </Row>
      )}

      <FlatList
        keyboardShouldPersistTaps="handled"
        data={list}
        keyExtractor={(it, i) => it.place?.id ?? `h${i}`}
        ListEmptyComponent={results && state !== "loading" ? <Txt muted style={{ padding: 24, textAlign: "center" }}>{t.search.noResults}</Txt> : null}
        renderItem={({ item }) =>
          item.header ? (
            <Txt size={13} weight="semibold" muted style={s.header}>{item.header}</Txt>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => item.place && onPick(item.place)}
              style={({ pressed }) => [s.item, { borderColor: theme.border, backgroundColor: pressed ? theme.surfaceAlt : "transparent" }]}
            >
              <View style={[s.kindIcon, { backgroundColor: theme.surfaceAlt }]}>
                <Icon name={KIND_ICON[item.place!.kind] ?? "map-marker-outline"} size={22} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt weight="semibold" numberOfLines={1}>{item.place!.name}</Txt>
                <Txt size={13} muted numberOfLines={1}>
                  {[(t.kinds as Record<string, string>)[item.place!.kind] ?? t.kinds.place, item.place!.secondary].filter(Boolean).join(" · ")}
                  {item.place!.quality === "seed_unverified" ? ` · ${t.search.approx}` : ""}
                </Txt>
              </View>
              {userCoord && <Txt size={13} muted>{fmtDistance(haversine(userCoord, item.place!.coord), fmtCtx)}</Txt>}
            </Pressable>
          )
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  barWrap: { position: "absolute", left: 12, right: 12 },
  bar: {
    minHeight: TOUCH + 4, borderRadius: 18, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth, elevation: 6, shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  barIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  inputRow: { marginHorizontal: 12, minHeight: TOUCH, borderRadius: 16, borderWidth: 2, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 18, paddingVertical: 10 },
  quickRow: { flexDirection: "row", gap: 10, paddingHorizontal: 12, marginTop: 12 },
  quick: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, minHeight: TOUCH },
  paste: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 12, marginTop: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderStyle: "dashed" },
  notice: { marginHorizontal: 12, marginTop: 10, padding: 10, borderRadius: 12 },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: TOUCH + 8 },
  kindIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
