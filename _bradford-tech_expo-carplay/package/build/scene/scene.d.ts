import type { EventSubscription } from 'expo-modules-core';
export declare function isConnected(): boolean;
export declare function addConnectListener(listener: () => void): EventSubscription;
export declare function addDisconnectListener(listener: () => void): EventSubscription;
export declare function setRootTemplate(templateId: string): Promise<void>;
export declare function pushTemplate(templateId: string): Promise<void>;
export declare function popTemplate(): Promise<void>;
//# sourceMappingURL=scene.d.ts.map