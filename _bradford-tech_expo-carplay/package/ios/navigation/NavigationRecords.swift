// NavigationRecords.swift
// Records for CPTrip, CPRouteChoice, CPManeuver, CPTravelEstimates inputs.

import ExpoModulesCore

struct TripPlace: Record {
    // `.required` per the Null Island convention from SharedRecords.swift —
    // a typo'd `lattitude` would otherwise silently coerce to 0.0.
    @Field(.required) var latitude: Double
    @Field(.required) var longitude: Double
    @Field var name: String?
}

struct RouteChoice: Record {
    @Field(.required) var summaryVariants: [String]
    /// `[String] = []` (not `[String]?`) per the Map pilot's array convention:
    /// optional arrays are only used when the converter needs to distinguish
    /// "leave alone" from "clear" (MapTemplateButtonsConfig). Here, absent and
    /// empty are equivalent.
    @Field var additionalInformationVariants: [String] = []
}

struct TripConfig: Record {
    // `.required` on nested Record fields closes the outer-omission gap.
    // Without it, omitting `origin` entirely would construct a default
    // TripPlace(latitude: 0, longitude: 0), skipping inner `.required`.
    @Field(.required) var origin: TripPlace
    @Field(.required) var destination: TripPlace
    @Field(.required) var routeChoices: [RouteChoice]
}

struct ManeuverConfig: Record {
    @Field(.required) var instructionVariants: [String]
    @Field var symbolImage: ImageRef?
    @Field var distanceRemaining: Double?
    @Field var timeRemaining: Double?
}

struct TravelEstimates: Record {
    @Field(.required) var distanceRemaining: Double
    @Field(.required) var timeRemaining: Double
}
