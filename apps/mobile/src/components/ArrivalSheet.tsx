import React from "react";
import { View } from "react-native";
import { useUi } from "../context";
import { fmt } from "../i18n";
import { saveSaved } from "../storage";
import { getState, setState } from "../store";
import type { Place } from "../types";
import { Btn, Icon, Panel, Row, Txt } from "./ui";

export function ArrivalSheet({ destination, onDone }: { destination: Place; onDone(): void }) {
  const { theme, t } = useUi();
  const saved = getState().saved;
  const already = saved.favorites.some((f) => f.id === destination.id) || saved.home?.coord === destination.coord;
  return (
    <Panel>
      <Row>
        <Icon name="flag-checkered" size={40} color={theme.ok} />
        <View style={{ flex: 1 }}>
          <Txt size={22} weight="bold">{t.arrive.title}</Txt>
          <Txt muted numberOfLines={2}>{fmt(t.arrive.to, { name: destination.name })}</Txt>
        </View>
      </Row>
      <Row style={{ marginTop: 14 }}>
        {!already && (
          <Btn
            kind="secondary" icon="star-outline" label={t.arrive.saveHere} style={{ flex: 1 }}
            onPress={() => {
              const next = { ...getState().saved, favorites: [destination, ...getState().saved.favorites].slice(0, 30) };
              setState({ saved: next });
              void saveSaved(next);
            }}
          />
        )}
        <Btn label={t.arrive.done} onPress={onDone} style={{ flex: 1 }} />
      </Row>
    </Panel>
  );
}
