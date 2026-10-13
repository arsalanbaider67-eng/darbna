import glob, traceback
try:
    from faster_whisper import WhisperModel
    m = WhisperModel("small", device="cpu", compute_type="int8")
    for f in sorted(glob.glob("voice-inbox/*.mp3")):
        segs, _ = m.transcribe(f, language="ar", beam_size=5)
        print(f"::notice title={f}::" + " ".join(s.text for s in segs).strip())
except Exception:
    print("::error title=crash::" + traceback.format_exc().replace("\n", " | ")[-900:])
