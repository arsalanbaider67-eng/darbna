import { useEffect } from "react";

/**
 * "Share → دربنا" from any app (Google Maps, Apple Maps, WhatsApp, Safari…): the share extension
 * opens Darbna with what was shared (a link, or text with a link in it) and this hands it on once.
 * Only in builds made with the share extension (EXPO_PUBLIC_SHARE_EXTENSION=1); otherwise the
 * native module isn't even loaded.
 */
const ENABLED = process.env.EXPO_PUBLIC_SHARE_EXTENSION === "1";

function useShared(onShare: (text: string) => void): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useShareIntent } = require("expo-share-intent") as typeof import("expo-share-intent");
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  useEffect(() => {
    if (!hasShareIntent) return;
    const text = [shareIntent.text, shareIntent.webUrl, shareIntent.meta?.title].filter(Boolean).join("\n");
    resetShareIntent();
    if (text.trim()) onShare(text);
  }, [hasShareIntent]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const useIncomingShare: (onShare: (text: string) => void) => void = ENABLED ? useShared : () => {};
