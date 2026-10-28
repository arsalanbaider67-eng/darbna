// ManeuverBuilder.swift
// Constructs CPManeuver from a typed ManeuverConfig Record.
// Handles SF Symbol / URI image resolution via the shared ImageRef pattern.
// See: docs/carplay-api-surface.md §4 — Maneuvers & Lane Guidance

import CarPlay

enum ManeuverBuilder {
    static func build(from config: ManeuverConfig) -> CPManeuver {
        let maneuver = CPManeuver()
        maneuver.instructionVariants = config.instructionVariants

        // ImageRef pseudo-discriminator: prefer systemName, fall back to uri,
        // drop if neither. Same pattern as MapButtonConfig.title vs systemImage.
        if let imageRef = config.symbolImage,
           let image = resolveImage(imageRef) {
            maneuver.symbolSet = CPImageSet(
                lightContentImage: image,
                darkContentImage: image
            )
        }

        // Initial travel estimates: set if a distance is provided; time
        // defaults to 0 in that case (matches pre-pilot behavior).
        if let dist = config.distanceRemaining {
            maneuver.initialTravelEstimates = CPTravelEstimates(
                distanceRemaining: UnitConversion.localizedDistance(meters: dist),
                timeRemaining: config.timeRemaining ?? 0
            )
        }

        return maneuver
    }

    static func buildArray(from configs: [ManeuverConfig]) -> [CPManeuver] {
        configs.map { build(from: $0) }
    }

    // MARK: - Image Resolution

    private static func resolveImage(_ ref: ImageRef) -> UIImage? {
        if let systemName = ref.systemName {
            return UIImage(systemName: systemName)
        }
        if let uri = ref.uri {
            // Handle file:// URIs
            let path = uri.hasPrefix("file://") ? String(uri.dropFirst(7)) : uri
            return UIImage(contentsOfFile: path)
        }
        return nil
    }
}
