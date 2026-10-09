/**
 * Plays recorded guidance clips in the browser with the Web Audio API: clips are decoded once and
 * scheduled back to back, so a prompt sounds like one sentence. iPhone Safari only allows sound
 * after a tap: unlockClips() is called from the Start button (via primeVoice).
 */
let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let playing: AudioBufferSourceNode[] = [];

function context(): AudioContext | null {
  if (ctx) return ctx;
  const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

export function unlockClips(): void {
  const c = context();
  if (!c) return;
  try {
    void c.resume();
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050); // a silent blip unlocks audio on iOS
    src.connect(c.destination);
    src.start(0);
  } catch {}
}

function uriOf(mod: any): string | null {
  if (typeof mod === "string") return mod;
  if (mod && typeof mod.uri === "string") return mod.uri;
  if (mod && typeof mod.default === "string") return mod.default;
  return null;
}

function load(mod: any): Promise<AudioBuffer | null> {
  const uri = uriOf(mod);
  const c = context();
  if (!uri || !c) return Promise.resolve(null);
  let p = buffers.get(uri);
  if (!p) {
    p = fetch(uri)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => new Promise<AudioBuffer>((res, rej) => c.decodeAudioData(b, res, rej)))
      .catch(() => { buffers.delete(uri); return null; });
    buffers.set(uri, p);
  }
  return p;
}

/** Fetch and decode clips ahead of time (e.g. when a trip starts) so the first prompt isn't late. */
export function preloadClips(mods: any[]): void {
  mods.forEach((m) => void load(m));
}

export function stopClips(): void {
  for (const s of playing) { try { s.stop(); } catch {} }
  playing = [];
}

/** Plays the clips in order. Resolves false if any clip couldn't be loaded (caller falls back to TTS). */
export async function playClips(mods: any[], urgent: boolean): Promise<boolean> {
  const c = context();
  if (!c) return false;
  const bufs = await Promise.all(mods.map(load));
  if (bufs.some((b) => !b)) return false;
  if (urgent) stopClips();
  if (c.state === "suspended") { try { await c.resume(); } catch {} }
  // Queue after anything still playing.
  let t = Math.max(c.currentTime + 0.02, ...playing.map((s: any) => s.__end ?? 0));
  for (const b of bufs as AudioBuffer[]) {
    const src = c.createBufferSource();
    src.buffer = b;
    src.connect(c.destination);
    src.start(t);
    (src as any).__end = t + b.duration;
    src.onended = () => { playing = playing.filter((x) => x !== src); };
    playing.push(src);
    t += b.duration + 0.06; // short natural pause between parts
  }
  return true;
}
