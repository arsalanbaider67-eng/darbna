/**
 * A short two-note chime for "checkpoint / camera ahead" and "over the limit", made with Web Audio
 * (no sound file). Plays with the iPhone silent switch on once audio was unlocked by a tap
 * (clipPlayer.web.ts sets navigator.audioSession to "playback").
 */
let ctx: AudioContext | null = null;

export function chime(urgent = false): void {
  try {
    const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const c = ctx!;
    if (c.state === "suspended") void c.resume();
    const notes = urgent ? [880, 880] : [784, 1047];
    notes.forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t0 = c.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + 0.16);
    });
  } catch {}
}
