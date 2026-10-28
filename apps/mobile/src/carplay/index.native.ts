/**
 * CarPlay is only in builds made with DARBNA_CARPLAY=1 / EXPO_PUBLIC_CARPLAY=1 (Apple must grant the
 * CarPlay entitlement first; plugins/withCarPlay.js). Otherwise the native module isn't linked and
 * this does nothing.
 */
const ENABLED = process.env.EXPO_PUBLIC_CARPLAY === "1";

export function startCarPlay(): void {
  if (!ENABLED) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./carplayApp").startCarPlayApp();
  } catch (e) {
    console.warn("CarPlay unavailable", e);
  }
}
