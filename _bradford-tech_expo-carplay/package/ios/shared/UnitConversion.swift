// UnitConversion.swift
// Locale-aware distance conversion for CarPlay display.
// CarPlay does not auto-convert Measurement units to the user's preferred system,
// so we convert explicitly before passing to CPTravelEstimates.

import Foundation

enum UnitConversion {
    /// Converts a distance in meters to the user's preferred unit system.
    /// Non-metric locales (e.g., US) get miles; metric locales get kilometers.
    static func localizedDistance(meters: Double) -> Measurement<UnitLength> {
        let measurement = Measurement(value: meters, unit: UnitLength.meters)
        let isMetric: Bool = if #available(iOS 16, *) {
            Locale.current.measurementSystem == .metric
        } else {
            Locale.current.usesMetricSystem
        }
        return measurement.converted(to: isMetric ? .kilometers : .miles)
    }
}
