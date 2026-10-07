import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUi } from "../context";
import { font, TOUCH } from "../theme";

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export function Txt({ style, weight = "regular", muted, size = 16, ...p }: TextProps & { weight?: keyof typeof font; muted?: boolean; size?: number }) {
  const { theme } = useUi();
  return (
    <Text
      {...p}
      maxFontSizeMultiplier={1.4}
      style={[{ fontFamily: font[weight], fontSize: size, lineHeight: Math.round(size * 1.55), color: muted ? theme.textMuted : theme.text }, style]}
    />
  );
}

export function Icon({ name, size = 24, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const { theme } = useUi();
  return <MaterialCommunityIcons name={name} size={size} color={color ?? theme.text} style={style} />;
}

export function Btn({
  label, onPress, icon, kind = "primary", disabled, loading, style, accessibilityHint,
}: {
  label: string; onPress: () => void; icon?: IconName; kind?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; accessibilityHint?: string;
}) {
  const { theme } = useUi();
  const bg = { primary: theme.primary, secondary: theme.surfaceAlt, ghost: "transparent", danger: theme.danger, accent: theme.accent }[kind];
  const fg = { primary: theme.onPrimary, secondary: theme.text, ghost: theme.primary, danger: "#FFFFFF", accent: theme.onAccent }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled || !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1, borderColor: kind === "secondary" ? theme.border : "transparent" },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} color={fg} size={22} /> : null}
      <Txt weight="semibold" size={17} style={{ color: fg }}>{label}</Txt>
    </Pressable>
  );
}

export function RoundBtn({ icon, onPress, label, active, size = TOUCH }: { icon: IconName; onPress: () => void; label: string; active?: boolean; size?: number }) {
  const { theme } = useUi();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        s.round,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: active ? theme.primary : theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1, shadowColor: theme.shadow },
      ]}
    >
      <Icon name={icon} color={active ? theme.onPrimary : theme.text} size={26} />
    </Pressable>
  );
}

/** Bottom panel. Not draggable on purpose: fewer gestures to get wrong while driving. */
export function Panel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useUi();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.panel, { backgroundColor: theme.surface, paddingBottom: Math.max(insets.bottom, 12) + 4, shadowColor: theme.shadow, borderColor: theme.border }, style]}>
      <View style={[s.grabber, { backgroundColor: theme.border }]} />
      {children}
    </View>
  );
}

export function Chip({ text, color, textColor, icon }: { text: string; color: string; textColor: string; icon?: IconName }) {
  return (
    <View style={[s.chip, { backgroundColor: color }]}>
      {icon ? <Icon name={icon} size={16} color={textColor} /> : null}
      <Txt size={13} weight="semibold" style={{ color: textColor }}>{text}</Txt>
    </View>
  );
}

export function Row({ children, style, gap = 8 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

const s = StyleSheet.create({
  btn: { minHeight: TOUCH, borderRadius: 16, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 1 },
  round: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, elevation: 4, shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  panel: {
    position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingTop: 8, elevation: 12, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: -2 }, borderTopWidth: StyleSheet.hairlineWidth,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
});
