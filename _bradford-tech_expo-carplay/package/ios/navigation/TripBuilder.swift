// TripBuilder.swift
// Constructs CPTrip and CPRouteChoice from a typed TripConfig Record.
// See: docs/carplay-api-surface.md §3 — CPTrip, CPRouteChoice

import CarPlay
import MapKit

enum TripBuilder {
    static func build(from config: TripConfig) -> CPTrip {
        let originItem = mapItem(for: config.origin, fallbackName: "Current Location")
        let destItem = mapItem(for: config.destination, fallbackName: "Destination")

        let routeChoices = config.routeChoices.map { choice -> CPRouteChoice in
            let additionalInfo = choice.additionalInformationVariants
            return CPRouteChoice(
                summaryVariants: choice.summaryVariants,
                additionalInformationVariants: additionalInfo,
                // Derived: selection summary falls back to the main summary
                // when no additional info is provided. Not a Record field
                // since it's a function of the other two arrays.
                selectionSummaryVariants: additionalInfo.isEmpty ? choice.summaryVariants : additionalInfo
            )
        }

        return CPTrip(origin: originItem, destination: destItem, routeChoices: routeChoices)
    }

    /// Per-role name defaults stay in the converter because they're role-specific
    /// (origin gets "Current Location", destination gets "Destination") and can't
    /// be expressed as a single `TripPlace` Record default.
    private static func mapItem(for place: TripPlace, fallbackName: String) -> MKMapItem {
        let coord = CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
        let item = MKMapItem(placemark: MKPlacemark(coordinate: coord))
        item.name = place.name ?? fallbackName
        return item
    }
}
