/**
 * Browser compass, so the arrow points the way the phone faces even when standing still
 * (GPS only knows the direction while moving). iPhone Safari asks permission once, and only
 * from inside a tap — call enableCompass() synchronously from a button press.
 */
let heading: number | null = null;
let at = 0;
let listening = false;

function onOrient(e: DeviceOrientationEvent & { webkitCompassHeading?: number }) {
  let h: number | null = null;
  if (typeof e.webkitCompassHeading === "number" && !Number.isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading; // iPhone
  else if ((e as any).absolute && typeof e.alpha === "number") h = (360 - e.alpha) % 360; // Android Chrome
  if (h == null) return;
  // Correct for the screen being turned sideways.
  const angle = (screen.orientation?.angle ?? (window as any).orientation ?? 0) as number;
  heading = (h + angle + 360) % 360;
  at = Date.now();
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("deviceorientationabsolute" as any, onOrient as any, true);
  window.addEventListener("deviceorientation", onOrient as any, true);
}

export function enableCompass(): void {
  if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return;
  const D = DeviceOrientationEvent as any;
  if (typeof D.requestPermission === "function") {
    D.requestPermission().then((r: string) => r === "granted" && listen()).catch(() => {});
  } else listen();
}

/** Latest compass heading (0 = north), or null if none in the last 3 s. */
export function compassHeading(): number | null {
  return heading != null && Date.now() - at < 3000 ? heading : null;
}
