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
