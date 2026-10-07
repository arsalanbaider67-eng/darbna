/**
 * Search normalization for Iraqi place names.
 *
 * Two independent keys are produced for every name and every query:
 *  - `arabicKey`: Arabic-script text with spelling variants folded together
 *    (hamza/alef forms, ta marbuta, alef maqsura, Persian/Kurdish letter forms,
 *    diacritics, tatweel, Eastern digits, and the definite article).
 *  - `latinKey`: a consonant skeleton of a Latin transliteration so that
 *    "Kadhimiya", "Kazimiyah" and "Al-Kadhimiyah" meet at the same key.
 *
 * Both are deliberately lossy: they are for *recall*. Ranking then uses
 * trigram similarity on the less-lossy forms (see server/src/search).
 */

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

const ARABIC_FOLD: Record<string, string> = {
  "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ٲ": "ا", "ٳ": "ا",
  "ى": "ي", "ی": "ي", "ێ": "ي", "ئ": "ي",
  "ة": "ه", "ە": "ه", "ھ": "ه",
  "ؤ": "و", "ۆ": "و", "ۇ": "و",
  "ک": "ك", "گ": "ك", "ڪ": "ك",
  "ڕ": "ر", "ڵ": "ل",
  "پ": "ب", "چ": "ج", "ژ": "ز", "ڤ": "ف",
  "ء": "",
};

const DIGITS: Record<string, string> = {};
"٠١٢٣٤٥٦٧٨٩".split("").forEach((d, i) => (DIGITS[d] = String(i)));
"۰۱۲۳۴۵۶۷۸۹".split("").forEach((d, i) => (DIGITS[d] = String(i)));

export function hasArabicScript(s: string): boolean {
  return /[؀-ۿݐ-ݿ]/.test(s);
}

export function foldDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] ?? d);
}

/** Light normalization for display-safe comparison (keeps the article). */
export function normalizeArabic(input: string): string {
  let s = foldDigits(input.normalize("NFC")).replace(TASHKEEL, "").replace(TATWEEL, "");
  s = s.replace(/[؀-ۿ]/g, (c) => (c in ARABIC_FOLD ? ARABIC_FOLD[c] : c));
  return s.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Recall key: also drops the definite article "ال" and leading "و"/"ب" + article. */
export function arabicKey(input: string): string {
  return normalizeArabic(input)
    .split(" ")
    .map((w) => w.replace(/^(?:وال|بال|فال|كال|لل|ال)(?=..)/, ""))
    .filter(Boolean)
    .join(" ");
}

const LATIN_ARTICLE = /\b(?:al|el|ad|ar|as|at|az|an|ash|adh|il)[-\s'’]+(?=\w)/g;

/** Consonant skeleton for one Latin word. */
function skeletonWord(w: string): string {
  if (!w) return "";
  let s = w
    .replace(/ph/g, "f")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/dh/g, "z") // ذ/ظ are often romanized as both "dh" and "z" in Iraq
    .replace(/th/g, "t")
    .replace(/sh/g, "x")
    .replace(/ch/g, "j")
    .replace(/q/g, "k")
    .replace(/c/g, "k")
    .replace(/g/g, "k")
    .replace(/v/g, "f")
    .replace(/h$/g, ""); // Basrah → Basra, Najafah...
  if (s.length > 1 && s.endsWith("h")) s = s.slice(0, -1);
  const first = /[aeiou]/.test(s[0]) ? "a" : s[0];
  const rest = s.slice(1).replace(/[aeiouyw'h]/g, "");
  return (first + rest).replace(/(.)\1+/g, "$1");
}

export function latinKey(input: string): string {
  const s = foldDigits(input)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ʿʾ`´]/g, "")
    .replace(LATIN_ARTICLE, "")
    .replace(/[^a-z0-9\s]+/g, " ");
  return s.split(/\s+/).filter(Boolean).map(skeletonWord).filter(Boolean).join(" ");
}

export interface SearchKeys {
  raw: string;
  arabic: string | null;
  latin: string | null;
}

export function searchKeys(input: string): SearchKeys {
  const raw = input.trim();
  const ar = hasArabicScript(raw) ? arabicKey(raw) : null;
  const lat = /[a-zA-Z]/.test(raw) ? latinKey(raw) : null;
  return { raw, arabic: ar || null, latin: lat || null };
}
