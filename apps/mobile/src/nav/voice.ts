import * as Speech from "expo-speech";
import type { Lang } from "../i18n";

const PREFIX: Record<Lang, string[]> = { ar: ["ar"], ckb: ["ckb", "ku"], en: ["en"] };

export interface VoiceChoice {
  /** Language the prompts will actually be spoken in. */
  lang: Lang;
  voiceId?: string;
  bcp47: string;
  fallback: boolean;
}

let cache: Partial<Record<Lang, VoiceChoice>> = {};

/**
 * Pick an installed TTS voice. Sorani voices are rare on phones; when none exists we
 * fall back to Arabic (then English) and tell the user in Settings — we never feed
 * Kurdish text to an Arabic voice.
 */
export async function chooseVoice(lang: Lang): Promise<VoiceChoice> {
  if (cache[lang]) return cache[lang]!;
  const voices = await Speech.getAvailableVoicesAsync().catch(() => []);
  const find = (l: Lang) => {
    const v = voices.filter((x) => PREFIX[l].some((p) => x.language.toLowerCase().startsWith(p)));
    // Prefer an Iraqi / Gulf Arabic voice when present, then any enhanced voice.
    return v.find((x) => /ar[-_]iq/i.test(x.language)) ?? v.find((x) => x.quality === Speech.VoiceQuality.Enhanced) ?? v[0];
  };
  const order: Lang[] = lang === "ckb" ? ["ckb", "ar", "en"] : lang === "ar" ? ["ar", "en"] : ["en"];
  for (const l of order) {
    const v = find(l);
    if (v) return (cache[lang] = { lang: l, voiceId: v.identifier, bcp47: v.language, fallback: l !== lang });
  }
  // No voice list (common on some Android builds): let the engine use its default for the language.
  return (cache[lang] = { lang, bcp47: lang === "ckb" ? "ckb" : lang === "ar" ? "ar" : "en-US", fallback: false });
}

export function resetVoiceCache(): void {
  cache = {};
}

export async function speak(text: string, choice: VoiceChoice, urgent = false): Promise<void> {
  if (urgent) await Speech.stop();
  Speech.speak(text, { language: choice.bcp47, voice: choice.voiceId, rate: 1.0, pitch: 1.0 });
}

export function stopSpeaking(): void {
  void Speech.stop();
}

/** Web only (see voice.web.ts); native apps can always speak. */
export function primeVoice(): void {}
