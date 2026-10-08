import { useEffect, useState } from "react";

/**
 * Browser version: trusts navigator.onLine and the online/offline events.
 * (NetInfo's web "is the internet reachable" probe calls a Google URL that Safari blocks,
 * which made a connected iPhone look offline.)
 */
export function useConnectivity(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(typeof navigator === "undefined" ? null : navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
