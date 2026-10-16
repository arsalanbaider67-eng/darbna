import os from "node:os";
import { execFileSync } from "node:child_process";
// Records Darbna's guidance prompts with the chosen voices (assets/voice/phrases.json):
//   Voices per language are set in phrases.json: Azure (AZURE_SPEECH_KEY + AZURE_SPEECH_REGION)
//   or ElevenLabs (ELEVENLABS_API_KEY).
// Writes assets/voice/<lang>/<key>.mp3 and src/nav/voiceClips.ts. Only phrases whose text changed
// (or that are missing) are recorded again. Run by .github/workflows/voices.yml.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(fs.readFileSync(path.resolve(root, process.env.VOICE_PHRASES_FILE || "assets/voice/phrases.json"), "utf8"));
const reviewRoot = process.env.VOICE_REVIEW_DIR ? path.resolve(root, process.env.VOICE_REVIEW_DIR) : null;
if (cfg.review && !reviewRoot) throw new Error("Candidate wording must be generated into VOICE_REVIEW_DIR, not the active voice pack.");
if (process.env.VOICE_KEYS && !reviewRoot) throw new Error("VOICE_KEYS is only supported for isolated review candidates.");
const requestedKeys = process.env.VOICE_KEYS?.split(",").map(k => k.trim()).filter(Boolean);
for (const key of requestedKeys || []) {
  if (!Object.values(cfg.phrases).some(phrases => key in phrases)) throw new Error(`Unknown voice-review phrase: ${key}`);
}
const manifestPath = path.join(reviewRoot || path.join(root, "assets/voice"), "manifest.json");
if (reviewRoot) fs.mkdirSync(reviewRoot, { recursive: true });
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
const note = (title, msg) => console.log(`::notice title=${title}::${msg}`);
const fail = (title, msg) => console.log(`::error title=${title}::${msg}`);
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function azure(text, voice) {
  const key = process.env.AZURE_SPEECH_KEY, region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) throw new Error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION secrets are missing");
  const lang = voice.split("-").slice(0, 2).join("-");
  const ssml = `<speak version="1.0" xml:lang="${lang}"><voice name="${voice}">${esc(text)}</voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "darbna-voice-gen",
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

const elevenIds = new Map();
/** Finds the voice to use: in the account already, else added from the public Voice Library. */
async function elevenVoice(name, wantedId) {
  if (elevenIds.has(name)) return elevenIds.get(name);
  const id = await findElevenVoice(name, wantedId);
  elevenIds.set(name, id);
  return id;
}

async function findElevenVoice(name, wantedId) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY secret is missing");
  // A fixed voice id (e.g. an ElevenLabs default voice) needs no lookup: works with keys that can't list voices.
  if (wantedId && /^[A-Za-z0-9]{20}$/.test(wantedId) && process.env.VOICE_ID_DIRECT !== "0") return wantedId;
  const h = { "xi-api-key": key };
  const lc = name.toLowerCase();
  // 1) Already in the account's voices (same id, or added under its name)?
  const mineRes = await fetch("https://api.elevenlabs.io/v1/voices", { headers: h });
  const mine = await mineRes.json().catch(() => ({}));
  if (!mineRes.ok) note("elevenlabs", `can't list your voices (${mineRes.status}): ${JSON.stringify(mine).slice(0, 160)}`);
  else note("elevenlabs", `your voices: ${(mine.voices ?? []).filter((v) => v.category !== "premade").map((v) => `${v.name} [${v.voice_id}]`).join(", ").slice(0, 400)}`);
  const own = (mine.voices ?? []).find((v) => v.voice_id === wantedId || v.name?.toLowerCase().startsWith(lc));
  if (own) return own.voice_id;
  // 2) Find it in the public Voice Library and add it to the account.
  const shared = await (await fetch(`https://api.elevenlabs.io/v1/shared-voices?search=${encodeURIComponent(name)}&page_size=50`, { headers: h })).json();
  const list = shared.voices ?? [];
  const pick = list.find((v) => v.voice_id === wantedId) ?? list.find((v) => v.name?.toLowerCase().startsWith(lc));
  if (pick) {
    const added = await fetch(`https://api.elevenlabs.io/v1/voices/add/${pick.public_owner_id}/${pick.voice_id}`, {
      method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ new_name: name }),
    });
    const j = await added.json().catch(() => ({}));
    if (added.ok && j.voice_id) { note("elevenlabs", `added "${pick.name}" to your voices`); return j.voice_id; }
    note("elevenlabs", `could not add "${pick.name}" automatically: ${JSON.stringify(j).slice(0, 160)}`);
  }
  // 3) Last try: use the library id directly.
  if (wantedId) return wantedId;
  throw new Error(`voice "${name}" not found — open it in the ElevenLabs Voice Library and tap "Add to my voices"`);
}

async function eleven(text, name, wantedId, v = {}) {
  const id = await elevenVoice(name, wantedId);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: v.model ?? "eleven_multilingual_v2", voice_settings: v.settings ?? { stability: 0.6, similarity_boost: 0.75 },
      ...(v.languageCode ? { language_code: v.languageCode } : {}),
      ...(v.textNormalization ? { apply_text_normalization: v.textNormalization } : {}),
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * "clean": natural speed (no time-stretching), silence trimmed, 0.15 s of lead-in so the first word
 * isn't clipped when audio starts, and every clip at the same loudness (-16 LUFS). No fades.
 */
function clean(mp3) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "v-"));
  const a = path.join(tmp, "a.mp3"), b = path.join(tmp, "b.mp3");
  fs.writeFileSync(a, mp3);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", a, "-af",
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,adelay=150:all=1,apad=pad_dur=0.12,loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ar", "44100", "-ac", "1", "-b:a", "96k", b]);
  return fs.readFileSync(b);
}

const done = {};
for (const [lang, phrases] of Object.entries(cfg.phrases)) {
  const v = cfg.voices[lang];
  const dir = reviewRoot ? path.join(reviewRoot, lang) : path.join(root, "assets/voice", lang);
  fs.mkdirSync(dir, { recursive: true });
  let made = 0, kept = 0;
  try {
    for (const [key, text] of Object.entries(phrases)) {
      if (requestedKeys && !requestedKeys.includes(key)) continue;
      const file = path.join(dir, `${key}.mp3`);
      // "take": re-record every phrase of this voice with its model/settings; "redo": only the listed phrases.
      const redo = (v.redo ?? []).includes(key);
      const sig = hash(`${v.provider}|${v.voiceId ?? v.voice}|${text}` + (v.take ? `|${v.model}|${JSON.stringify(v.settings)}|${v.post}|${v.take}` : "")
        + (reviewRoot ? `|${v.languageCode}|${v.textNormalization}` : "")
        + (redo ? `|redo|${v.model}|${JSON.stringify(v.settings)}|${v.post}|${v.redoTake}` : ""));
      if (fs.existsSync(file) && manifest[`${lang}/${key}`] === sig) { kept++; continue; }
      let audio = v.provider === "azure" ? await azure(text, v.voice) : await eleven(text, v.voice, v.voiceId, v);
      if (v.post === "clean" && (v.take || redo)) audio = clean(audio);
      fs.writeFileSync(file, audio);
      manifest[`${lang}/${key}`] = sig;
      made++;
      await sleep(v.provider === "elevenlabs" ? 400 : 120);
    }
    done[lang] = Object.keys(phrases);
    note(`voice ${lang}`, `${v.voice}: ${made} recorded, ${kept} unchanged`);
  } catch (e) {
    fail(`voice ${lang}`, `${v.voice}: ${e.message} (recorded ${made} before stopping)`);
    process.exitCode = 1;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
}

// The app only uses a language's recordings when every clip exists.
if (!reviewRoot) {
const lines = ["// GENERATED by scripts/gen-voice.mjs — do not edit. Recorded guidance prompts per language.", "/* eslint-disable */", "export const VOICE_CLIPS: Partial<Record<\"ar\" | \"en\", Record<string, any>>> = {"];
for (const lang of Object.keys(cfg.phrases)) {
  const keys = Object.keys(cfg.phrases[lang]);
  if (!keys.every((k) => fs.existsSync(path.join(root, "assets/voice", lang, `${k}.mp3`)))) continue;
  lines.push(`  ${lang}: {`);
  for (const k of keys) lines.push(`    ${JSON.stringify(k)}: require("../../assets/voice/${lang}/${k}.mp3"),`);
  lines.push("  },");
}
lines.push("};", "");
fs.writeFileSync(path.join(root, "src/nav/voiceClips.ts"), lines.join("\n"));
} else {
  fs.writeFileSync(path.join(reviewRoot, "candidate-wording.json"), JSON.stringify(cfg, null, 2));
  note("review only", "Candidate files saved separately. Active recordings and voiceClips.ts were not replaced.");
}
