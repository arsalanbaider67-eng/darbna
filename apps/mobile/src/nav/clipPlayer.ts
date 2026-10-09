/**
 * Phone app: plays recorded guidance clips one after another with expo-audio. If the audio
 * module isn't available in this build, playClips() returns false and the phone's voice is used.
 */
let audio: any = null;
try {
  audio = require("expo-audio");
} catch {
  audio = null;
}

let player: any = null;
let queue: any[] = [];
let busy = false;
let modeSet = false;

function ensure(): boolean {
  if (!audio?.createAudioPlayer) return false;
  if (!modeSet) {
    modeSet = true;
    // Speak even with the silent switch on, and lower music instead of stopping it.
    audio.setAudioModeAsync?.({ playsInSilentMode: true, interruptionMode: "duckOthers", shouldPlayInBackground: true }).catch?.(() => {});
  }
  if (!player) {
    player = audio.createAudioPlayer(null);
    player.addListener?.("playbackStatusUpdate", (st: any) => {
      if (st?.didJustFinish) next();
    });
  }
  return true;
}

function next() {
  const mod = queue.shift();
  if (mod === undefined) { busy = false; return; }
  busy = true;
  try {
    player.replace(mod);
    player.play();
  } catch {
    next();
  }
}

export function unlockClips(): void {}
export function preloadClips(_mods: any[]): void {}

export function stopClips(): void {
  queue = [];
  busy = false;
  try { player?.pause(); } catch {}
}

export async function playClips(mods: any[], urgent: boolean): Promise<boolean> {
  if (!ensure()) return false;
  if (urgent) stopClips();
  queue.push(...mods);
  if (!busy) next();
  return true;
}
