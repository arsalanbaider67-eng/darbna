import { type EventSubscription } from 'expo-modules-core';
import type { CameraGeometryConfig, EdgePadding, FollowMode, MapTemplateButtonsConfig, MapTemplateConfig, RouteSegment } from './map/map.types';
import type { ManeuverConfig, TravelEstimates, TripConfig } from './navigation/navigation.types';
import type { SearchResultItem } from './search/search.types';
export type ExpoCarPlayModule = {
    addListener<T = void>(eventName: string, listener: (event: T) => void): EventSubscription;
    /**
     * Synchronous native query for scene existence. Exists because the
     * onConnect emit is fire-and-forget: a scene that connects before JS
     * attaches listeners (CarPlay-initiated cold launch) is otherwise
     * unobservable. scene.ts delegates isConnected() to it on every call.
     */
    isCarPlayConnected(): boolean;
    createMapTemplate(config?: MapTemplateConfig | null): Promise<string>;
    updateMapTemplateButtons(config: MapTemplateButtonsConfig): Promise<void>;
    setRootTemplate(templateId: string): Promise<void>;
    pushTemplate(templateId: string): Promise<void>;
    popTemplate(): Promise<void>;
    startFollowingUser(): Promise<void>;
    stopFollowingUser(): Promise<void>;
    setFollowMode(mode: FollowMode): Promise<void>;
    setCameraGeometry(geometry: CameraGeometryConfig): Promise<void>;
    setCarPlayRoute(segments: RouteSegment[], edgePadding?: EdgePadding | null): Promise<void>;
    clearCarPlayRoute(): Promise<void>;
    startNavigation(tripConfig: TripConfig): Promise<string>;
    stopNavigation(): Promise<void>;
    /** CarPlay shows up to 12 trip previews; additional entries are ignored. */
    showTripPreviews(trips: TripConfig[]): Promise<void>;
    hideTripPreviews(): Promise<void>;
    updateManeuvers(maneuvers: ManeuverConfig[]): Promise<void>;
    updateTravelEstimates(estimates: TravelEstimates, maneuverIndex?: number): Promise<void>;
    createSearchTemplate(): Promise<string>;
    updateSearchResults(requestId: string, items: SearchResultItem[]): Promise<void>;
};
declare const _default: ExpoCarPlayModule;
export default _default;
//# sourceMappingURL=ExpoCarPlayModule.d.ts.map