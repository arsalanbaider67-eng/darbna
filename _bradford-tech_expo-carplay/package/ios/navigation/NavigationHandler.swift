// NavigationHandler.swift
// Manages CPNavigationSession lifecycle — start, stop, update maneuvers and estimates.
// Stores references to the active session and trip for estimate updates.
// Init-injected per Phase D1's DI rework (no more *.shared).
// See: docs/carplay-api-surface.md §3 — Navigation Session & Route Guidance
//      docs/superpowers/specs/2026-05-16-di-rework-design.md

import CarPlay

final class NavigationHandler {
    private let interfaceController: CPInterfaceController

    private var currentSession: CPNavigationSession?
    private var currentTrip: CPTrip?
    private(set) var previewedTrips: [CPTrip] = []

    init(interfaceController: CPInterfaceController) {
        self.interfaceController = interfaceController
    }

    // MARK: - Session Lifecycle

    /// Threading convention for this file: `await MainActor.run` when the call
    /// needs to return a value to the awaiting AsyncFunction (as here);
    /// `DispatchQueue.main.async` for fire-and-forget updates. Every
    /// `CPInterfaceController` / `CPMapTemplate` access, including the
    /// `findMapTemplate()` guard, happens inside that main-thread hop.
    func startNavigation(tripConfig: TripConfig) async -> String? {
        // Records validated the input; trip construction is now infallible.
        let trip = TripBuilder.build(from: tripConfig)

        return await MainActor.run { () -> String? in
            guard let mapTemplate = findMapTemplate() else { return nil }

            // End any existing session first — CPMapTemplate throws
            // clientTripAlreadyStartedException if a trip is already active.
            currentSession?.finishTrip()
            currentSession = nil
            currentTrip = nil

            let session = mapTemplate.startNavigationSession(for: trip)
            session.pauseTrip(for: .loading, description: "Loading route...")
            self.currentSession = session
            self.currentTrip = trip
            return UUID().uuidString
        }
    }

    func stopNavigation() {
        DispatchQueue.main.async { [self] in
            currentSession?.finishTrip()
            currentSession = nil
            currentTrip = nil
        }
    }

    // MARK: - Trip Previews

    func showTripPreviews(tripConfigs: [TripConfig]) {
        // TripBuilder.build is now infallible — `map` instead of `compactMap`.
        let trips = tripConfigs.map { TripBuilder.build(from: $0) }
        guard !trips.isEmpty else { return }

        DispatchQueue.main.async { [self] in
            guard let mapTemplate = findMapTemplate() else { return }

            // Written on main so it matches where tripIndex(for:) reads it:
            // CPMapTemplateDelegate callbacks arrive on the main thread.
            previewedTrips = trips
            mapTemplate.showTripPreviews(trips, textConfiguration: nil)
        }
    }

    func hideTripPreviews() {
        DispatchQueue.main.async { [self] in
            guard let mapTemplate = findMapTemplate() else { return }

            previewedTrips = []
            mapTemplate.hideTripPreviews()
        }
    }

    func tripIndex(for trip: CPTrip) -> Int? {
        previewedTrips.firstIndex(where: { $0 === trip })
    }

    // MARK: - Maneuver Updates

    func updateManeuvers(configs: [ManeuverConfig]) {
        let maneuvers = ManeuverBuilder.buildArray(from: configs)
        DispatchQueue.main.async { [self] in
            currentSession?.upcomingManeuvers = maneuvers
        }
    }

    // MARK: - Travel Estimate Updates

    func updateTravelEstimates(estimates: TravelEstimates, maneuverIndex: Int?) {
        let cpEstimates = CPTravelEstimates(
            distanceRemaining: UnitConversion.localizedDistance(meters: estimates.distanceRemaining),
            timeRemaining: estimates.timeRemaining
        )

        DispatchQueue.main.async { [self] in
            // Update per-maneuver estimate if index provided
            if let idx = maneuverIndex,
               let session = currentSession,
               idx < session.upcomingManeuvers.count {
                let maneuver = session.upcomingManeuvers[idx]
                session.updateEstimates(cpEstimates, for: maneuver)
            }

            // Always update trip-level estimate
            if let trip = currentTrip, let mapTemplate = findMapTemplate() {
                mapTemplate.updateEstimates(cpEstimates, for: trip)
            }
        }
    }

    // MARK: - Helpers

    /// Main thread only: `CPInterfaceController` is `CARPLAY_TEMPLATE_UI_ACTOR`, so callers must already be on main.
    private func findMapTemplate() -> CPMapTemplate? {
        interfaceController.rootTemplate as? CPMapTemplate
    }
}
