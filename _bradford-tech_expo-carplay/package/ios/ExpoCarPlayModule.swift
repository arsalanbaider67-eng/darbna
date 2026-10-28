// ExpoCarPlayModule.swift
// Expo Module definition — the sole entry point for the JS bridge.
// Contains only Function/AsyncFunction/Events DSL declarations.
// Every function delegates to a feature handler; no business logic lives here.
// See: docs/carplay-api-surface.md for the complete API surface.

import ExpoModulesCore

public class ExpoCarPlayModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoCarPlay")

        OnCreate {
            CarPlayEventEmitter.shared.setModule(self)
        }

        Events(
            "onConnect",
            "onDisconnect",
            "onSearchTextUpdated",
            "onSearchResultSelected",
            "onSearchButtonPressed",
            "onBarButtonPressed",
            "onMapButtonPressed",
            "onTripPreviewSelected",
            "onTripStarted"
        )

        // Synchronous by design: the JS side calls this at module load to seed
        // its connection latch, recovering scenes whose onConnect emit was
        // lost to the cold-launch race (fired before JS attached listeners).
        Function("isCarPlayConnected") { () -> Bool in
            SceneSession.current != nil
        }

        AsyncFunction("createMapTemplate") { (config: MapTemplateConfig?) throws -> String in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            return session.mapHandler.create(config: config)
        }

        AsyncFunction("updateMapTemplateButtons") { (config: MapTemplateButtonsConfig) throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.mapHandler.updateButtons(config: config)
        }

        // Template-stack functions: scene guard first, then
        // `session.template(_:)` — see SceneSession for why that order matters.
        // CPInterfaceController is main-actor-only, so the call itself hops
        // to main.
        AsyncFunction("setRootTemplate") { (templateId: String) throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            let template = try session.template(templateId)
            let interfaceController = session.interfaceController
            DispatchQueue.main.async {
                interfaceController.setRootTemplate(template, animated: true, completion: nil)
            }
        }

        AsyncFunction("startFollowingUser") { () throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.mapHandler.startFollowingUser()
        }

        AsyncFunction("stopFollowingUser") { () throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.mapHandler.stopFollowingUser()
        }

        AsyncFunction("setFollowMode") { (mode: String) throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.mapHandler.setFollowMode(mode)
        }

        AsyncFunction("setCameraGeometry") { (geometry: CameraGeometryConfig) throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.mapHandler.setCameraGeometry(geometry)
        }

        AsyncFunction("setCarPlayRoute") { (segments: [RouteSegment], edgePadding: EdgePadding?) throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.mapHandler.setRoute(segments: segments, edgePadding: edgePadding)
        }

        AsyncFunction("clearCarPlayRoute") { () throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.mapHandler.clearRoute()
        }

        AsyncFunction("startNavigation") { (tripConfig: TripConfig) async throws -> String in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            guard let sessionId = await session.navigationHandler.startNavigation(tripConfig: tripConfig) else {
                throw NoMapTemplateException()
            }
            return sessionId
        }

        AsyncFunction("stopNavigation") { () throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.navigationHandler.stopNavigation()
        }

        AsyncFunction("showTripPreviews") { (trips: [TripConfig]) throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.navigationHandler.showTripPreviews(tripConfigs: trips)
        }

        AsyncFunction("hideTripPreviews") { () throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.navigationHandler.hideTripPreviews()
        }

        AsyncFunction("updateManeuvers") { (maneuvers: [ManeuverConfig]) throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.navigationHandler.updateManeuvers(configs: maneuvers)
        }

        AsyncFunction("updateTravelEstimates") { (estimates: TravelEstimates, maneuverIndex: Int?) throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.navigationHandler.updateTravelEstimates(estimates: estimates, maneuverIndex: maneuverIndex)
        }

        AsyncFunction("createSearchTemplate") { () throws -> String in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            return session.searchHandler.create()
        }

        AsyncFunction("updateSearchResults") { (requestId: String, items: [SearchResultItem]) throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            session.searchHandler.updateResults(requestId: requestId, items: items)
        }

        AsyncFunction("pushTemplate") { (templateId: String) throws in
            guard let session = SceneSession.current else {
                throw CarPlayNotConnectedException()
            }
            let template = try session.template(templateId)
            let interfaceController = session.interfaceController
            DispatchQueue.main.async {
                interfaceController.pushTemplate(template, animated: true, completion: nil)
            }
        }

        AsyncFunction("popTemplate") { () in
            // popTemplate keeps its silent no-op behavior — it's idempotent
            // and conceptually safe to call on a disconnected scene. Unlike
            // handler-touching methods, the interface controller is the only
            // dependency, and "no controller → no-op" matches today's shape.
            guard let interfaceController = SceneSession.current?.interfaceController else {
                return
            }
            DispatchQueue.main.async {
                // Silent no-op if stack has only the root template
                if interfaceController.templates.count > 1 {
                    interfaceController.popTemplate(animated: true, completion: nil)
                }
            }
        }
    }
}
