import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Fixed male Arabic news voice from ElevenLabs' public Arabic catalogue:
// https://elevenlabs.io/text-to-speech/arabic (Hamid: natural, pleasant, suited to news).
// A fixed ID needs speech-generation access only, not voice-library browsing access.
// The spoken script is Modern Standard Arabic; listening verification remains required.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "assets/voice/standard-arabic-review.json");
const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
cfg.voices.ar.voice = "Hamid";
cfg.voices.ar.voiceId = "A9ATTqUUQ6GHu0coCz8t";
cfg.review.selectedVoice = {
  name: "Hamid", voiceId: cfg.voices.ar.voiceId, language: "ar", gender: "male",
  source: "https://elevenlabs.io/text-to-speech/arabic",
  description: "Young male voice with a pleasant tone; suited to news.",
};
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log(`Selected Arabic news voice: Hamid (${cfg.voices.ar.voiceId}); standard Arabic script, natural speed 1.0`);
