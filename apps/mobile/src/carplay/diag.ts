/**
 * CarPlay test diagnostics — only in the simulator check (EXPO_PUBLIC_CARPLAY_DEBUG=1), never in
 * store builds. Keeps a short event list in memory and in AsyncStorage ("darbna:carDiag") so the
 * test can read it back from the simulator, and lets the car screen show it.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export const CAR_DEBUG = process.env.EXPO_PUBLIC_CARPLAY_DEBUG === "1";
const events: string[] = [];
const subs = new Set<() => void>();

export function carLog(msg: string): void {
  if (!CAR_DEBUG) return;
  const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
  events.push(line);
  if (events.length > 60) events.shift();
  subs.forEach((f) => f());
  void AsyncStorage.setItem("darbna:carDiag", JSON.stringify(events)).catch(() => {});
}

export const carDiag = {
  events: () => events,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};
