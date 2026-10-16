/**
 * Speaks a guidance prompt: with the recorded guidance voice when its clips are in this
 * build. Arabic never falls back to a device-selected voice. English can use device TTS.
 * Street names are never spoken.
 */
import type { Lang } from "../i18n";
import { playClips, preloadClips, stopClips, unlockClips } from "./clipPlayer";
import { VOICE_CLIPS } from "./voiceClips";
import { chooseVoice, primeVoice as primeTts, speak, stopSpeaking as stopTts } from "./voice";
import { deliverGuidance } from "./promptDelivery";

function clipsFor(lang: Lang, keys: string[] | null): any[] | null {
  const set = lang === "ar" || lang === "en" ? VOICE_CLIPS[lang] : undefined;
  if (!set || !keys?.length) return null;
  const mods = keys.map((k) => set[k]);
  return mods.every((m) => m !== undefined) ? mods : null;
}

/** True when this build has the recorded voice for the language prompts will be spoken in. */
export function hasRecordedVoice(lang: Lang): boolean {
  return !!VOICE_CLIPS[(lang === "ckb" ? "ar" : lang) as "ar" | "en"];
}

export async function sayPrompt(lang: Lang, text: (spokenLang: Lang) => string, keys: string[] | null, urgent = false): Promise<boolean> {
  // Kurdish has no recorded voice yet: like the phone voice, fall back to Arabic.
  const recLang = lang === "ckb" ? "ar" : lang;
  const mods = clipsFor(recLang, keys);
  return deliverGuidance(recLang, !!mods, () => playClips(mods!, urgent), async () => {
    const v = await chooseVoice(lang);
    await speak(text(v.lang), v, urgent);
  });
}

/** Call synchronously from the Start tap: unlocks audio on iPhone and loads the clips. */
export function primeVoice(lang?: Lang): void {
  primeTts();
  unlockClips();
  const set = lang ? VOICE_CLIPS[(lang === "ckb" ? "ar" : lang) as "ar" | "en"] : undefined;
  if (set) preloadClips(Object.values(set));
}

export function stopSpeaking(): void {
  stopClips();
  stopTts();
}
