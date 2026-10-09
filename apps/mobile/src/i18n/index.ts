import { localizeDigits, roundDistance, splitDuration, type DigitStyle, type RouteStep } from "@darbna/core";
import { ar, type Strings } from "./ar";
import { ckb } from "./ckb";
import { en } from "./en";

export type Lang = "ar" | "ckb" | "en";
export const LANGS: { code: Lang; label: string; rtl: boolean }[] = [
  { code: "ar", label: "العربية", rtl: true },
  { code: "ckb", label: "کوردی (سۆرانی)", rtl: true },
  { code: "en", label: "English", rtl: false },
];

const TABLE: Record<Lang, Strings> = { ar, ckb, en };
export const strings = (lang: Lang): Strings => TABLE[lang];
export const isRTL = (lang: Lang) => lang !== "en";

export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));
}

export interface FormatCtx {
  lang: Lang;
  digits: DigitStyle;
}

const d = (ctx: FormatCtx, s: string) => localizeDigits(s, ctx.lang === "en" ? "western" : ctx.digits);

export function fmtDistance(m: number, ctx: FormatCtx, spoken = false): string {
  const t = strings(ctx.lang).units;
  const r = roundDistance(m);
  // Speech engines read Western digits reliably in every language.
  const v = spoken ? String(r.value) : d(ctx, String(r.value));
  return fmt(r.unit === "km" ? (spoken ? t.kmSpoken : t.km) : spoken ? t.mSpoken : t.m, { v });
}

export function fmtDuration(s: number, ctx: FormatCtx): string {
  const t = strings(ctx.lang).units;
  const { h, m } = splitDuration(s);
  return h ? d(ctx, fmt(t.hr, { h, m })) : d(ctx, fmt(t.min, { v: m }));
}

export function fmtClock(date: Date, ctx: FormatCtx): string {
  const s = `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  return d(ctx, s);
}

export function fmtNumber(n: number, ctx: FormatCtx): string {
  return d(ctx, String(n));
}

/** Text for a maneuver. `distanceM` null → "now" phrasing. */
export function instructionText(step: RouteStep, distanceM: number | null, ctx: FormatCtx, spoken = false): string {
  const s = strings(ctx.lang);
  const mv = s.maneuver;
  let action: string;
  if (step.kind === "roundabout") {
    action = step.roundaboutExit && step.roundaboutExit <= s.ordinals.length
      ? fmt(mv.roundabout, { n: s.ordinals[step.roundaboutExit - 1] })
      : mv.roundabout_plain;
  } else {
    action = mv[step.kind];
  }
  // Spoken prompts skip street names (they stay on screen).
  if (!spoken && step.streetName && step.kind !== "arrive" && step.kind !== "roundabout") {
    action = fmt(mv.onto, { action, street: step.streetName });
  }
  if (distanceM === null || step.kind === "arrive" && distanceM < 50) return action;
  return fmt(mv.inDistance, { d: fmtDistance(distanceM, ctx, spoken), action });
}
