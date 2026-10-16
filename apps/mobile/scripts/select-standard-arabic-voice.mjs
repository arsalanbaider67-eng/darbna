import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve one male voice explicitly labelled Modern Standard Arabic. Never silently
// reuse the earlier Iraqi voice, or choose another regional dialect.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "assets/voice/standard-arabic-review.json");
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY secret is missing");
const headers = { "xi-api-key": key };
const query = new URLSearchParams({ language: "ar", gender: "male", accent: "modern standard", page_size: "100", include_custom_rates: "false" });
const response = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${query}`, { headers });
if (!response.ok) throw new Error(`Standard Arabic voice lookup failed (${response.status})`);
const data = await response.json();
const standard = value => /modern[ _-]*standard|fusha|فصحى/i.test(value || "");
const eligible = (data.voices || []).filter(v =>
  v.gender?.toLowerCase() === "male" && v.voice_id !== "9FHjCdVXgA4tYxIYHTcZ" &&
  (v.rate == null || v.rate <= 1) &&
  ((v.language === "ar" && standard(v.accent)) ||
    v.verified_languages?.some(l => l.language === "ar" && standard(l.accent)))
).sort((a, b) => (b.cloned_by_count || 0) - (a.cloned_by_count || 0) || a.voice_id.localeCompare(b.voice_id));
const selected = eligible[0];
if (!selected) throw new Error("No standard-rate male Modern Standard Arabic voice matched. No regional voice was substituted.");
const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
cfg.voices.ar.voice = selected.name;
cfg.voices.ar.voiceId = selected.voice_id;
cfg.review.selectedVoice = {
  name: selected.name, voiceId: selected.voice_id, language: selected.language,
  accent: selected.accent, gender: selected.gender, rate: selected.rate ?? 1,
};
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log(`Selected standard Arabic male voice: ${selected.name} (${selected.voice_id}); accent: ${selected.accent}`);
