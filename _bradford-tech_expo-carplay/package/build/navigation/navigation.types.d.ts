import type { ImageRef } from '../shared/shared.types';
export type TripPlace = {
    latitude: number;
    longitude: number;
    name?: string;
};
export type RouteChoice = {
    summaryVariants: string[];
    additionalInformationVariants?: string[];
};
export type TripConfig = {
    origin: TripPlace;
    destination: TripPlace;
    /** CarPlay supports up to 3 route choices; additional entries are ignored. */
    routeChoices: RouteChoice[];
};
export type ManeuverConfig = {
    instructionVariants: string[];
    symbolImage?: ImageRef;
    distanceRemaining?: number;
    timeRemaining?: number;
};
export type TravelEstimates = {
    distanceRemaining: number;
    timeRemaining: number;
};
//# sourceMappingURL=navigation.types.d.ts.map