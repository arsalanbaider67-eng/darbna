import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { buildShareLink } from "@darbna/core";
import { toast } from "./store";
import type { Place } from "./types";

/**
 * Link for a place. On the web app it points back at this site (…/darbna/?to=lat,lng&name=…),
 * so it opens in Darbna on any phone; in the installed app it's a darbna:// link plus a
 * plain map link for people who don't have Darbna.
 */
export function placeLink(place: Place): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return buildShareLink(place.coord, place.name, window.location.origin + window.location.pathname);
  }
  const [lng, lat] = place.coord;
  return `${buildShareLink(place.coord, place.name)}\nhttps://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lng.toFixed(6)}#map=17/${lat.toFixed(6)}/${lng.toFixed(6)}`;
}

export async function sharePlace(place: Place, copiedText: string): Promise<void> {
  const link = placeLink(place);
  const nav = typeof navigator !== "undefined" ? (navigator as any) : null;
  if (Platform.OS === "web") {
    // iPhone/Android browsers: the system share sheet (WhatsApp, Messages…). Desktop: copy.
    if (nav?.share) {
      try { await nav.share({ title: place.name, text: place.name, url: link }); return; }
      catch (e: any) { if (e?.name === "AbortError") return; }
    }
    await Clipboard.setStringAsync(link).catch(() => {});
    toast(copiedText, "ok");
    return;
  }
  await Share.share({ message: `${place.name}\n${link}` }).catch(() => {});
}

/** The Darbna web app: shared trip links open here on any phone, no install needed. */
export const WEB_APP_URL = "https://arsalanbaider67-eng.github.io/darbna/";

export function webBase(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin + window.location.pathname;
  return WEB_APP_URL;
}

/** Live trip link for family: …/darbna/?watch=<id>. */
export const tripLink = (id: string) => `${webBase()}?watch=${encodeURIComponent(id)}`;

/** Share any text + link: the system share sheet on phones, else copy it. */
export async function shareText(text: string, url: string, copiedText: string): Promise<void> {
  const nav = typeof navigator !== "undefined" ? (navigator as any) : null;
  if (Platform.OS === "web") {
    if (nav?.share) {
      try { await nav.share({ text, url }); return; }
      catch (e: any) { if (e?.name === "AbortError") return; }
    }
    await Clipboard.setStringAsync(`${text}`).catch(() => {});
    toast(copiedText, "ok");
    return;
  }
  await Share.share({ message: text }).catch(() => {});
}
