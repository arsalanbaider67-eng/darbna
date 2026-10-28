// scene/useCarPlay.ts
// React hook for CarPlay connection state.
// Returns: { connected: boolean }.
// Subscribes to onConnect/onDisconnect events from the native module.
// See: docs/carplay-api-surface.md §1
import { useEffect, useState } from 'react';
import { addConnectListener, addDisconnectListener, isConnected, } from './scene';
export function useCarPlay() {
    const [connected, setConnected] = useState(isConnected());
    useEffect(() => {
        const connectSub = addConnectListener(() => setConnected(true));
        const disconnectSub = addDisconnectListener(() => setConnected(false));
        // Reconcile with the live native state in case it changed between render
        // and effect — isConnected() queries native directly (see the connection
        // state note in docs/carplay-api-surface.md §1).
        setConnected(isConnected());
        return () => {
            connectSub.remove();
            disconnectSub.remove();
        };
    }, []);
    return { connected };
}
//# sourceMappingURL=useCarPlay.js.map