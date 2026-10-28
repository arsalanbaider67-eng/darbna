// MapRecords.swift
// Records for CPMapTemplate inputs (create, button updates, route segments).

import ExpoModulesCore

struct MapTemplateConfig: Record {
    @Field var leadingNavigationBarButtons: [BarButtonConfig] = []
    @Field var trailingNavigationBarButtons: [BarButtonConfig] = []
    @Field var mapButtons: [MapButtonConfig] = []
    @Field var automaticallyHidesNavigationBar: Bool = true
    @Field var hidesButtonsWithNavigationBar: Bool = true
    /// Hex color (e.g., "#30B0C7") for the turn-by-turn guidance bar
    /// background. When nil, CarPlay uses the system default (red).
    @Field var guidanceBackgroundColor: String?
}

struct MapTemplateButtonsConfig: Record {
    // Optional arrays: nil = leave that group alone; empty = clear that group.
    @Field var leadingNavigationBarButtons: [BarButtonConfig]?
    @Field var trailingNavigationBarButtons: [BarButtonConfig]?
    @Field var mapButtons: [MapButtonConfig]?
}

struct MapButtonConfig: Record {
    // `.required` — see BarButtonConfig.id comment in SharedRecords.swift.
    @Field(.required) var id: String
    @Field var systemImage: String?
    @Field var title: String?
    @Field var backgroundColor: String?
    @Field var enabled: Bool = true
    @Field var hidden: Bool = false
}

/// Camera geometry overrides, so framing can be tuned without a native build.
///
/// A negative value means "unset — keep the native default", and that is also
/// what an omitted field arrives as. Zero cannot be the sentinel: it is a
/// legal pitch, and the one the browse modes use.
struct CameraGeometryConfig: Record {
    @Field var browseDistance: Double = -1
    @Field var browsePitch: Double = -1
    @Field var navigationDistance: Double = -1
    @Field var navigationPitch: Double = -1
}

struct RouteSegment: Record {
    @Field var coordinates: [Coordinate]
    @Field var color: String
}

struct EdgePadding: Record {
    @Field var top: Double = 40
    @Field var left: Double = 40
    @Field var bottom: Double = 40
    @Field var right: Double = 40
}
