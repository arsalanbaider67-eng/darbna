import type { EventSubscription } from 'expo-modules-core';
import type { ManeuverConfig, TravelEstimates, TripConfig } from './navigation.types';
export declare function startNavigation(trip: TripConfig): Promise<string>;
export declare function stopNavigation(): Promise<void>;
export declare function updateManeuvers(maneuvers: ManeuverConfig[]): Promise<void>;
export declare function updateTravelEstimates(estimates: TravelEstimates, maneuverIndex?: number): Promise<void>;
export declare function getActiveSessionId(): string | null;
/** CarPlay shows up to 12 trip previews; additional entries are ignored. */
export declare function showTripPreviews(trips: TripConfig[]): Promise<void>;
export declare function hideTripPreviews(): Promise<void>;
export declare function addTripPreviewSelectedListener(listener: (event: {
    tripIndex: number;
    routeIndex: number;
}) => void): EventSubscription;
export declare function addTripStartedListener(listener: (event: {
    tripIndex: number;
    routeIndex: number;
}) => void): EventSubscription;
//# sourceMappingURL=navigation.d.ts.map