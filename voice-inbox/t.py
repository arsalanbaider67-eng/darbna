from faster_whisper import WhisperModel
import glob
m = WhisperModel("medium", device="cpu", compute_type="int8")
for f in sorted(glob.glob("voice-inbox/*.mp3")):
    segs, _ = m.transcribe(f, language="ar", beam_size=5)
    print(f"::notice title={f}::" + " ".join(s.text for s in segs).strip())
