import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

/** true = online, false = offline, null = not known yet. Captive portals count as offline. */
export function useConnectivity(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(
    () =>
      NetInfo.addEventListener((s) => {
        setOnline(s.isConnected === false ? false : s.isInternetReachable === false ? false : s.isConnected ?? null);
      }),
    [],
  );
  return online;
}
