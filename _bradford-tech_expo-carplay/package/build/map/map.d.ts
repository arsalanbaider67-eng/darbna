import type { EventSubscription } from 'expo-modules-core';
import type { CameraGeometryConfig, EdgePadding, FollowMode, MapTemplateButtonsConfig, MapTemplateConfig, RouteSegment } from './map.types';
export declare function createMapTemplate(config?: MapTemplateConfig): Promise<string>;
export declare function startFollowingUser(): Promise<void>;
export declare function stopFollowingUser(): Promise<void>;
export declare function setFollowMode(mode: FollowMode): Promise<void>;
export declare function setCameraGeometry(geometry: CameraGeometryConfig): Promise<void>;
export declare function setCarPlayRoute(segments: RouteSegment[], edgePadding?: EdgePadding): Promise<void>;
export declare function clearCarPlayRoute(): Promise<void>;
export declare function updateMapTemplateButtons(config: MapTemplateButtonsConfig): Promise<void>;
export declare function addBarButtonPressedListener(listener: (event: {
    id: string;
}) => void): EventSubscription;
export declare function addMapButtonPressedListener(listener: (event: {
    id: string;
}) => void): EventSubscription;
//# sourceMappingURL=map.d.ts.map