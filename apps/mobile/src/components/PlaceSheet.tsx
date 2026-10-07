import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { haversine, type LngLat } from "@darbna/core";
import { useUi } from "../context";
import { fmt, fmtDistance } from "../i18n";
import { saveSaved } from "../storage";
import { getState, setState, useStore } from "../store";
import type { Place } from "../types";
import { Btn, Icon, Panel, Row, Txt } from "./ui";

export function PlaceSheet({ place, userCoord, lookingUp, onDirections, onClose }: {
  place: Place; userCoord: LngLat | null; lookingUp: boolean; onDirections(): void; onClose(): void;
}) {
  const { theme, t, fmtCtx } = useUi();
  const saved = useStore((s) => s.saved);
  const isFav = saved.favorites.some((f) => f.id === place.id);

  function update(patch: Partial<typeof saved>) {
    const next = { ...getState().saved, ...patch };
    setState({ saved: next });
    void saveSaved(next);
  }

  return (
    <Panel>
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Txt size={21} weight="bold" numberOfLines={2}>{lookingUp ? t.place.lookingUp : place.name}</Txt>
          <Txt muted numberOfLines={2}>
            {[(t.kinds as Record<string, string>)[place.kind] ?? t.kinds.place, place.secondary].filter(Boolean).join(" · ")}
          </Txt>
          {userCoord && <Txt size={14} muted>{fmt(t.place.distanceFromYou, { d: fmtDistance(haversine(userCoord, place.coord), fmtCtx) })}</Txt>}
          {place.quality === "seed_unverified" && (
            <Row gap={4} style={{ marginTop: 4 }}>
              <Icon name="information-outline" size={16} color={theme.warn} />
              <Txt size={13} style={{ color: theme.warn }}>{t.search.approx}</Txt>
            </Row>
          )}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t.common.close} onPress={onClose} hitSlop={12} style={s.close}>
          <Icon name="close" size={24} color={theme.textMuted} />
        </Pressable>
      </Row>
      <Btn label={t.place.directions} icon="directions" onPress={onDirections} style={{ marginTop: 14 }} />
      <Row style={{ marginTop: 10 }}>
        <Btn
          kind="secondary"
          icon={isFav ? "star" : "star-outline"}
          label={isFav ? t.place.saved : t.place.save}
          onPress={() => update({ favorites: isFav ? saved.favorites.filter((f) => f.id !== place.id) : [place, ...saved.favorites].slice(0, 30) })}
          style={{ flex: 1 }}
        />
        <Btn kind="secondary" icon="home-outline" label={t.saved.home} onPress={() => update({ home: { ...place, id: `home:${place.id}` } })} style={{ flex: 1 }} accessibilityHint={t.place.setHome} />
        <Btn kind="secondary" icon="briefcase-outline" label={t.saved.work} onPress={() => update({ work: { ...place, id: `work:${place.id}` } })} style={{ flex: 1 }} accessibilityHint={t.place.setWork} />
      </Row>
    </Panel>
  );
}

const s = StyleSheet.create({ close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" } });
