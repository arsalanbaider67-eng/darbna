"""Replace one word inside recorded Arabic clips with the owner's own take of it (same voice),
keeping the rest of each sentence. Word positions come from Whisper word timestamps."""
import json, os, re, subprocess, traceback
from faster_whisper import WhisperModel

V = "apps/mobile/assets/voice/ar"
TAKES = {"lwf": "voice-inbox/a1.mp3", "flk": "voice-inbox/a2.mp3"}
# key -> (which take, letters of the prefix glued to the word that must be kept from the old audio)
JOBS = {
    "mv_right": ("lwf", ""), "mv_left": ("lwf", ""), "mv_sharp_right": ("lwf", ""), "mv_sharp_left": ("lwf", ""),
    "mv_roundabout_plain": ("flk", "ال"), "mv_roundabout_exit": ("flk", "ال"),
    **{f"mv_roundabout_{i}": ("flk", "بال") for i in range(1, 7)},
}
MATCH = {"lwf": re.compile(r"ل[وُ]?ف|love|lof", re.I), "flk": re.compile(r"فلك|فلق|فلج")}
m = WhisperModel("small", device="cpu", compute_type="int8")

def ff(*a): subprocess.run(["ffmpeg", "-v", "error", "-y", *a], check=True)
def dur(f): return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))
def strip_ar(s): return re.sub(r"[ً-ْـ]", "", s)

# trimmed takes (no leading/trailing silence)
for k, f in TAKES.items():
    ff("-i", f, "-af", "silenceremove=start_periods=1:start_threshold=-42dB,areverse,silenceremove=start_periods=1:start_threshold=-42dB,areverse",
       "-ar", "44100", "-ac", "1", f"/tmp/take_{k}.wav")

report = []
for key, (take, prefix) in JOBS.items():
    try:
        src = f"{V}/{key}.mp3"
        ff("-i", src, "-ar", "44100", "-ac", "1", "/tmp/src.wav")
        segs, _ = m.transcribe("/tmp/src.wav", language="ar", word_timestamps=True, beam_size=5)
        words = [w for s in segs for w in s.words]
        hit = next((w for w in words if MATCH[take].search(strip_ar(w.word))), None)
        if not hit:
            report.append(f"{key}: word not found in «{' '.join(w.word for w in words)}» — left as is"); continue
        start, end = hit.start, hit.end
        if prefix:
            letters = len(strip_ar(hit.word).strip(" ،,."))
            start = start + (end - start) * len(prefix) / max(letters, len(prefix) + 1)
        # pieces: before | new word | after, joined with short crossfades
        ff("-i", "/tmp/src.wav", "-t", f"{start:.3f}", "/tmp/p1.wav")
        ff("-i", "/tmp/src.wav", "-ss", f"{end:.3f}", "/tmp/p3.wav")
        ff("-i", "/tmp/p1.wav", "-i", f"/tmp/take_{take}.wav", "-i", "/tmp/p3.wav", "-filter_complex",
           "[0][1]acrossfade=d=0.015:c1=tri:c2=tri[a];[a][2]acrossfade=d=0.015:c1=tri:c2=tri,loudnorm=I=-17:TP=-1.5:LRA=11",
           "-ar", "44100", "-ac", "1", "-b:a", "64k", src)
        segs2, _ = m.transcribe(src, language="ar", beam_size=5)
        report.append(f"{key}: replaced {start:.2f}-{end:.2f}s; now heard «{' '.join(s.text for s in segs2).strip()}»")
    except Exception:
        report.append(f"{key}: ERROR " + traceback.format_exc()[-300:].replace("\n", " "))
for r in report: print("::notice title=splice::" + r)
