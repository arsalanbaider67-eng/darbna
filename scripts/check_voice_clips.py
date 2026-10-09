"""Whisper-transcribes apps/mobile/assets/voice/<lang>/*.mp3 and compares with phrases.json.
Reports a similarity score per clip as GitHub annotations (worst first)."""
import json, re, difflib
from faster_whisper import WhisperModel

cfg = json.load(open("assets/voice/phrases.json"))
model = WhisperModel("small", device="cpu", compute_type="int8")

AR_NUM = {"خمسين": "50", "مية": "100", "ميتين": "200"}
def norm(s, lang):
    s = s.lower()
    s = re.sub(r"[ً-ْـ]", "", s)          # Arabic diacritics / tatweel
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي").replace("ة", "ه")
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(s.split())

rows = []
for lang, phrases in cfg["phrases"].items():
    for key, text in phrases.items():
        segs, _ = model.transcribe(f"assets/voice/{lang}/{key}.mp3", language=lang, beam_size=5, vad_filter=False)
        heard = " ".join(s.text for s in segs).strip()
        score = difflib.SequenceMatcher(None, norm(text, lang), norm(heard, lang)).ratio()
        rows.append((score, lang, key, text, heard))

rows.sort()
bad = [r for r in rows if r[0] < 0.5]
print(f"::notice title=voice check::{len(rows)} clips, {len(bad)} below 0.5 similarity; average {sum(r[0] for r in rows)/len(rows):.2f}")
for score, lang, key, text, heard in rows[:25]:
    print(f"::notice title={lang}/{key} {score:.2f}::expected «{text}» heard «{heard}»")
