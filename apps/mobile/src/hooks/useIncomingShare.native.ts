import { useEffect } from "react";
import { useShareIntent } from "expo-share-intent";

/**
 * "Share → دربنا" from any app (Google Maps, Apple Maps, WhatsApp, Safari…): the share extension
 * opens Darbna with what was shared (a link, or text with a link in it) and this hands it on once.
 */
export function useIncomingShare(onShare: (text: string) => void): void {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  useEffect(() => {
    if (!hasShareIntent) return;
    const text = [shareIntent.text, shareIntent.webUrl, shareIntent.meta?.title].filter(Boolean).join("\n");
    resetShareIntent();
    if (text.trim()) onShare(text);
  }, [hasShareIntent]); // eslint-disable-line react-hooks/exhaustive-deps
}
