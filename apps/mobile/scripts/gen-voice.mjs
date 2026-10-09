// Records Darbna's guidance prompts with the chosen voices (assets/voice/phrases.json):
//   Arabic: Azure "ar-IQ-RanaNeural" (needs AZURE_SPEECH_KEY + AZURE_SPEECH_REGION)
//   English: ElevenLabs "Aaden" (needs ELEVENLABS_API_KEY; optional ELEVENLABS_VOICE_ID)
// Writes assets/voice/<lang>/<key>.mp3 and src/nav/voiceClips.ts. Only phrases whose text changed
// (or that are missing) are recorded again. Run by .github/workflows/voices.yml.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "assets/voice/phrases.json"), "utf8"));
const manifestPath = path.join(root, "assets/voice/manifest.json");
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

let elevenVoiceId = null;
async function elevenVoice(name) {
  if (elevenVoiceId) return elevenVoiceId;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY secret is missing");
  if (process.env.ELEVENLABS_VOICE_ID) return (elevenVoiceId = process.env.ELEVENLABS_VOICE_ID);
  const h = { "xi-api-key": key };
  // 1) Already in the account's voices?
  const mine = await (await fetch("https://api.elevenlabs.io/v1/voices", { headers: h })).json();
  const own = (mine.voices ?? []).find((v) => v.name?.toLowerCase().startsWith(name.toLowerCase()));
  if (own) return (elevenVoiceId = own.voice_id);
  // 2) Find it in the public Voice Library and add it to the account.
  const shared = await (await fetch(`https://api.elevenlabs.io/v1/shared-voices?search=${encodeURIComponent(name)}&page_size=30`, { headers: h })).json();
  const pick = (shared.voices ?? []).find((v) => v.name?.toLowerCase().startsWith(name.toLowerCase()));
  if (!pick) throw new Error(`voice "${name}" not found in your ElevenLabs voices or the Voice Library`);
  const added = await fetch(`https://api.elevenlabs.io/v1/voices/add/${pick.public_owner_id}/${pick.voice_id}`, {
    method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ new_name: pick.name }),
  });
  const j = await added.json().catch(() => ({}));
  if (!added.ok) throw new Error(`could not add "${pick.name}" to your voices: ${JSON.stringify(j).slice(0, 200)}`);
  note("elevenlabs", `using "${pick.name}" (${j.voice_id ?? pick.voice_id})`);
  return (elevenVoiceId = j.voice_id ?? pick.voice_id);
}

async function eleven(text, name) {
  const id = await elevenVoice(name);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.6, similarity_boost: 0.75 } }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

const done = {};
for (const [lang, phrases] of Object.entries(cfg.phrases)) {
  const v = cfg.voices[lang];
  const dir = path.join(root, "assets/voice", lang);
  fs.mkdirSync(dir, { recursive: true });
  let made = 0, kept = 0;
  try {
    for (const [key, text] of Object.entries(phrases)) {
      const file = path.join(dir, `${key}.mp3`);
      const sig = hash(`${v.provider}|${v.voice}|${text}`);
      if (fs.existsSync(file) && manifest[`${lang}/${key}`] === sig) { kept++; continue; }
      const audio = v.provider === "azure" ? await azure(text, v.voice) : await eleven(text, v.voice);
      fs.writeFileSync(file, audio);
      manifest[`${lang}/${key}`] = sig;
      made++;
      await sleep(v.provider === "elevenlabs" ? 400 : 120);
    }
    done[lang] = Object.keys(phrases);
    note(`voice ${lang}`, `${v.voice}: ${made} recorded, ${kept} unchanged`);
  } catch (e) {
    fail(`voice ${lang}`, `${v.voice}: ${e.message} (recorded ${made} before stopping)`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
}

// The app only uses a language's recordings when every clip exists.
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
