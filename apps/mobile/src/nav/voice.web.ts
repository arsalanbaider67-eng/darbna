/**
 * Browser voice guidance, using speechSynthesis directly. (expo-speech's web version waits
 * for a "voices changed" event that some browsers never send, which silently blocked every
 * prompt.) Same exports as voice.ts.
 */
import type { Lang } from "../i18n";
import type { VoiceChoice } from "./voice";

export type { VoiceChoice } from "./voice";

const PREFIX: Record<Lang, string[]> = { ar: ["ar"], ckb: ["ckb", "ku"], en: ["en"] };
const synth = (): SpeechSynthesis | null => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

let cache: Partial<Record<Lang, VoiceChoice>> = {};

/** The voice list, waiting at most `ms` for browsers (Safari, Chrome) that load it lazily. */
function voices(ms = 1200): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
  const now = s.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); s.removeEventListener?.("voiceschanged", done); resolve(s.getVoices()); };
    const timer = setTimeout(done, ms);
    s.addEventListener?.("voiceschanged", done);
  });
}

export async function chooseVoice(lang: Lang): Promise<VoiceChoice> {
  if (cache[lang]) return cache[lang]!;
  const list = await voices();
  const find = (l: Lang) => {
    const v = list.filter((x) => PREFIX[l].some((p) => x.lang.toLowerCase().startsWith(p)));
    return v.find((x) => /ar[-_]iq/i.test(x.lang)) ?? v.find((x) => x.localService) ?? v[0];
  };
  const order: Lang[] = lang === "ckb" ? ["ckb", "ar", "en"] : lang === "ar" ? ["ar", "en"] : ["en"];
  for (const l of order) {
    const v = find(l);
    if (v) return (cache[lang] = { lang: l, voiceId: v.voiceURI, bcp47: v.lang, fallback: l !== lang });
  }
  // No list yet: let the browser pick by language, and look again next time.
  const fb: Lang = lang === "ckb" ? "ar" : lang;
  return { lang: fb, bcp47: fb === "ar" ? "ar-SA" : "en-US", fallback: fb !== lang };
}

export function resetVoiceCache(): void {
  cache = {};
}

export async function speak(text: string, choice: VoiceChoice, urgent = false): Promise<void> {
  const s = synth();
  if (!s) return;
  if (urgent) s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = choice.bcp47;
  if (choice.voiceId) {
    const v = s.getVoices().find((x) => x.voiceURI === choice.voiceId);
    if (v) u.voice = v;
  }
  s.speak(u);
}

export function stopSpeaking(): void {
  synth()?.cancel();
}

/**
 * iPhone Safari only lets a page talk after it has spoken once inside a tap. Call this
 * synchronously from the Start button's press handler (before any await) so the prompts
 * that follow, spoken later from timers and GPS updates, are allowed.
 */
export function primeVoice(): void {
  const s = synth();
  if (!s) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    s.cancel();
    s.speak(u);
    s.getVoices(); // starts Safari loading its voice list
  } catch {}
}
