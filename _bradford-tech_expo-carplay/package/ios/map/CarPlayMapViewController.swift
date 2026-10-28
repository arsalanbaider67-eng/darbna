// CarPlayMapViewController.swift
// UIViewController containing an MKMapView for the CarPlay window's base view.
// Manages navigation camera (pitch=60, route-derived heading, adaptive smoothing)
// and route polyline display. Ported from react-native-maps patch.
//
// Location tracking is native — CLLocationManager drives the camera directly
// from didUpdateLocations, bypassing the JS bridge for smooth ~1Hz updates.
// JS only calls startFollowingUser/stopFollowingUser and setRoute/clearRoute.
//
// See: docs/carplay-api-surface.md §2 — Map Template (base view)

import CoreLocation
import MapKit
import os.log
import UIKit

// MARK: - Route Projection Math

private func bearing(from start: CLLocationCoordinate2D, to end: CLLocationCoordinate2D) -> CLLocationDirection {
    let dLon = (end.longitude - start.longitude) * .pi / 180.0
    let lat1 = start.latitude * .pi / 180.0
    let lat2 = end.latitude * .pi / 180.0
    let y = sin(dLon) * cos(lat2)
    let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
    let b = atan2(y, x) * 180.0 / .pi
    return b.truncatingRemainder(dividingBy: 360.0) + (b < 0 ? 360.0 : 0)
}

private func projectPointOntoSegment(_ point: MKMapPoint, _ segStart: MKMapPoint, _ segEnd: MKMapPoint) -> MKMapPoint {
    let dx = segEnd.x - segStart.x
    let dy = segEnd.y - segStart.y
    let lengthSq = dx * dx + dy * dy
    if lengthSq == 0 {
        return segStart
    }
    let t = max(0, min(1, ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSq))
    return MKMapPoint(x: segStart.x + t * dx, y: segStart.y + t * dy)
}

private struct SnapResult {
    var projectedPoint: MKMapPoint
    var perpDistance: Double
    var segmentIndex: Int
}

private func findClosestSegment(
    userPoint: MKMapPoint,
    polyline: UnsafePointer<MKMapPoint>,
    pointCount: Int,
    fromIndex: Int,
    toIndex: Int
) -> SnapResult {
    var best = SnapResult(projectedPoint: userPoint, perpDistance: .greatestFiniteMagnitude, segmentIndex: -1)
    let from = max(0, fromIndex)
    let to = min(toIndex, pointCount - 2)
    guard from <= to else { return best }

    for i in from ... to {
        let projected = projectPointOntoSegment(userPoint, polyline[i], polyline[i + 1])
        let dist = projected.distance(to: userPoint)
        if dist < best.perpDistance {
            best.perpDistance = dist
            best.projectedPoint = projected
            best.segmentIndex = i
        }
    }
    return best
}

// MARK: - Constants

private let kSnapOffThreshold: CLLocationDistance = 15.0
private let kSnapOnThreshold: CLLocationDistance = 8.0
private let kWindowRadius = 10

// Route-active camera: tilted, close-in, oriented to the current route segment.
private let kRouteCameraPitch: CGFloat = 60
private let kRouteCameraDistance: CLLocationDistance = 500

// Idle camera (no active route): flat, north-up, zoomed out enough to show
// nearby streets without the navigation-style tilt.
private let kIdleCameraPitch: CGFloat = 0
private let kIdleCameraDistance: CLLocationDistance = 600

/// Camera follow mode for the CarPlay map.
///
/// The four modes differ in camera geometry and heading source, not in how
/// they animate: every mode is applied through a single writer so the camera
/// and the user cursor always move together.
enum FollowMode: String {
    case off
    case browseNorthUp
    case browseHeadingUp
    case navigation
}

/// User-position marker owned by this controller rather than by MapKit.
/// MapKit owns `MKUserLocation.coordinate` and will not let us animate it, so
/// keeping the marker in lockstep with the camera requires our own annotation.
final class UserCursorAnnotation: MKPointAnnotation {
    var heading: CLLocationDirection = 0
    var isArrow: Bool = false
}

// MARK: - CarPlayMapViewController

class CarPlayMapViewController: UIViewController, MKMapViewDelegate, CLLocationManagerDelegate {
    private let mapView = MKMapView()
    private let locationManager = CLLocationManager()

    // Route state
    private var routeMapPoints: UnsafeMutablePointer<MKMapPoint>?
    private var routePointCount: Int = 0
    private var routeActive: Bool = false
    private var lastMatchedIndex: Int = 0
    private var routeOverlays: [MKPolyline] = []
    private var overlayColors: [MKPolyline: UIColor] = [:]
    private var routeAnnotations: [MKPointAnnotation] = []

    /// Camera state
    private var isFollowing: Bool = false
    private var followMode: FollowMode = .off
    /// When true, the next didUpdate userLocation callback centers the map.
    private var needsInitialCenter: Bool = false

    private let cursor = UserCursorAnnotation()
    private var cursorAdded = false
    /// Last position we animated the camera/cursor toward. Used by the
    /// stationary deadband and by heading-only writes, which must not
    /// re-target position.
    private var displayedCoordinate: CLLocationCoordinate2D?
    /// Heading we last animated toward. Read instead of `mapView.camera.heading`,
    /// which returns the model (target) value mid-animation, not what is on
    /// screen — smoothing against it compounds error.
    private var currentHeading: CLLocationDirection = 0
    /// Whether the last camera write used browse geometry. The first browse
    /// write after anything else establishes the zoom; later ones inherit it.
    private var wasBrowsing = false

    #if DEBUG
        /// Speed from the most recent location update, for the [CarPlayCam]
        /// diagnostic only. Kept out of `applyFollowCamera`'s signature so a
        /// debug concern does not shape the camera writer's interface.
        private var lastReportedSpeed: CLLocationSpeed = -1
    #endif

    /// Camera geometry set from JS. The negative-means-unset sentinel is
    /// decoded once, in `setCameraGeometry`, so nil here simply means "no
    /// override" and every read below is a plain fallback to the native
    /// default. No call site has to know the wire convention.
    private var browseDistanceOverride: CLLocationDistance?
    private var browsePitchOverride: CGFloat?
    private var navigationDistanceOverride: CLLocationDistance?
    private var navigationPitchOverride: CGFloat?

    private var browseDistance: CLLocationDistance {
        browseDistanceOverride ?? kIdleCameraDistance
    }

    private var browsePitch: CGFloat {
        browsePitchOverride ?? kIdleCameraPitch
    }

    private var navigationDistance: CLLocationDistance {
        navigationDistanceOverride ?? kRouteCameraDistance
    }

    private var navigationPitch: CGFloat {
        navigationPitchOverride ?? kRouteCameraPitch
    }

    /// The mode the camera actually applies.
    ///
    /// An active route means navigation geometry AND route-derived heading,
    /// whatever mode was requested — `startFollowingUser()` maps onto
    /// `browseNorthUp`, so a consumer on the legacy entry point with a route
    /// set would otherwise get the tilted, close-in camera locked to north.
    /// Camera geometry and heading must key off the same value or they
    /// disagree.
    private var effectiveMode: FollowMode {
        guard followMode != .off else { return .off }
        return routeActive ? .navigation : followMode
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Force light mode on the CarPlay map regardless of the vehicle's
        // day/night trait. Apple HIG generally prefers respecting the car's
        // trait collection; consumers that opt in accept the tradeoff.
        // Set on both the view controller (propagates to UIKit subviews) and
        // the MKMapView directly (MapKit observes traits independently and
        // would otherwise still switch tiles to night style).
        overrideUserInterfaceStyle = .light
        mapView.overrideUserInterfaceStyle = .light
        mapView.showsUserLocation = true
        mapView.delegate = self
        view.addSubview(mapView)

        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.activityType = .automotiveNavigation
        // iOS auto-pause (default true) ends updates entirely for a
        // when-in-use app until relaunch — and with .automotiveNavigation it
        // is likely at low-speed-vehicle speeds or while stopped, freezing
        // the camera mid-trip.
        locationManager.pausesLocationUpdatesAutomatically = false
        // The normal CarPlay case has the phone locked/pocketed; without this
        // flag the manager's updates can be suspended even though the app
        // declares the background mode. Guarded because setting it without
        // UIBackgroundModes:location in the host app's Info.plist is a fatal
        // error that terminates the app — this is a library, and not every
        // consumer declares that mode.
        let backgroundModes =
            Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        if backgroundModes.contains("location") {
            locationManager.allowsBackgroundLocationUpdates = true
        } else {
            // Skipping silently would degrade to "camera freezes when the
            // phone locks" with nothing pointing at the cause.
            Self.warnOnce(
                flag: &Self.didWarnMissingBackgroundMode,
                message: "UIBackgroundModes does not include 'location' — CarPlay camera "
                    + "updates will suspend when the phone locks. Add the 'location' "
                    + "background mode to the host app's Info.plist to enable background updates."
            )
        }
    }

    // MARK: - One-time diagnostics

    private static var didWarnMissingBackgroundMode = false
    private static var didWarnAuthorizationDenied = false

    private static func warnOnce(flag: inout Bool, message: String) {
        guard !flag else { return }
        flag = true
        os_log(.error, "expo-carplay: %{public}@", message)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        mapView.frame = view.bounds
    }

    deinit {
        if let pts = routeMapPoints {
            pts.deallocate()
            routeMapPoints = nil
        }
    }

    // MARK: - Public API

    func startFollowingUser() {
        DispatchQueue.main.async { [self] in
            isFollowing = true
            // Legacy entry point: the flat, north-up idle camera is what this
            // method has always produced with no route, so it maps onto
            // browseNorthUp. Kept in step with `followMode` because the camera
            // now reads the mode. With a route set, `effectiveMode` overrides
            // this to navigation, so route-oriented following still works for
            // consumers that never call setFollowMode.
            if followMode == .off {
                followMode = .browseNorthUp
            }
            locationManager.requestWhenInUseAuthorization()
            locationManager.startUpdatingLocation()

            // Center the map on the user when no route is active.
            // userTrackingMode = .follow doesn't reliably center the CarPlay
            // map, so we drive the camera explicitly — either immediately from
            // the already-known userLocation, or on the next
            // mapView(_:didUpdate:) callback.
            if !routeActive {
                if let location = mapView.userLocation.location {
                    _centerOnUserLocation(location.coordinate)
                } else {
                    needsInitialCenter = true
                }
            }
        }
    }

    func stopFollowingUser() {
        DispatchQueue.main.async { [self] in
            isFollowing = false
            followMode = .off
            needsInitialCenter = false
            locationManager.stopUpdatingLocation()
        }
    }

    func setFollowMode(_ rawMode: String) {
        DispatchQueue.main.async { [self] in
            let mode = FollowMode(rawValue: rawMode) ?? .off
            // Skip only when the mode AND the follow state already agree.
            // startFollowingUser/stopFollowingUser mutate isFollowing without
            // touching followMode, so a mode-only guard would let
            // stop-then-set-the-same-mode early-return and leave following
            // permanently dead.
            let alreadyApplied = mode == followMode && isFollowing == (mode != .off)
            guard !alreadyApplied else { return }
            followMode = mode

            if mode == .off {
                isFollowing = false
                needsInitialCenter = false
                locationManager.stopUpdatingLocation()
                return
            }

            isFollowing = true
            locationManager.requestWhenInUseAuthorization()
            locationManager.startUpdatingLocation()

            // Guarded exactly as startFollowingUser guards it: during an
            // active route the per-fix camera update is already driving, and
            // an immediate recenter at the last known heading would jerk the
            // map before the next fix supplied the route-derived one.
            if !routeActive {
                if let location = mapView.userLocation.location {
                    _centerOnUserLocation(location.coordinate)
                } else {
                    needsInitialCenter = true
                }
            }
        }
    }

    /// Override camera geometry from JS, so framing can be tuned without a
    /// native build.
    ///
    /// Each call replaces the whole geometry rather than patching it: a
    /// negative field means "use the native default", and an omitted field
    /// arrives as negative. Zero is not a sentinel — it is a legal pitch, and
    /// the one the browse modes use.
    ///
    /// Applies on the next camera write; this does not move the camera itself.
    func setCameraGeometry(_ geometry: CameraGeometryConfig) {
        DispatchQueue.main.async { [self] in
            browseDistanceOverride = geometry.browseDistance >= 0 ? geometry.browseDistance : nil
            browsePitchOverride = geometry.browsePitch >= 0 ? CGFloat(geometry.browsePitch) : nil
            navigationDistanceOverride = geometry.navigationDistance >= 0
                ? geometry.navigationDistance
                : nil
            navigationPitchOverride = geometry.navigationPitch >= 0
                ? CGFloat(geometry.navigationPitch)
                : nil
        }
    }

    func setRoute(segments: [RouteSegment], edgePadding: EdgePadding? = nil) {
        DispatchQueue.main.async { [self] in
            _setRouteOnMain(segments: segments, edgePadding: edgePadding)
        }
    }

    func clearRoute() {
        DispatchQueue.main.async { [self] in
            _clearRouteOnMain()
        }
    }

    private func _centerOnUserLocation(_ coordinate: CLLocationCoordinate2D) {
        needsInitialCenter = false
        applyFollowCamera(
            coordinate: coordinate,
            heading: currentHeading,
            cursorHeading: cursor.heading,
            duration: 0.3
        )
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard isFollowing, let location = locations.last else { return }
        _updateCamera(
            coordinate: location.coordinate,
            course: location.course,
            accuracy: location.horizontalAccuracy,
            speed: location.speed
        )
    }

    func locationManager(_: CLLocationManager, didFailWithError error: Error) {
        // Location errors are routine in the simulator; denial is the one
        // worth surfacing — with background updates handled above, it is the
        // likeliest remaining cause of a camera that never follows.
        if (error as? CLError)?.code == .denied {
            Self.warnOnce(
                flag: &Self.didWarnAuthorizationDenied,
                message: "location authorization denied — the CarPlay camera cannot follow "
                    + "the user until the host app is granted location access."
            )
        }
    }

    // MARK: - Camera Update (called from native CLLocationManager, always on main thread)

    private static let kFollowAnimationDuration: TimeInterval = 1.0
    private static let kHeadingGateDegrees: Double = 2.0
    /// Deadband floor. The threshold is half the reported horizontal accuracy
    /// but never less than this, so a fix claiming implausibly good accuracy
    /// — or a negative one, meaning invalid — cannot disable the deadband.
    private static let kMinDeadbandMeters: CLLocationDistance = 5.0
    /// At or above this speed the vehicle is moving, so the deadband does not
    /// apply. A negative speed means CoreLocation has none; that compares
    /// below the threshold, which deliberately treats an unknown speed as
    /// parked — an unusable speed usually accompanies a poor-quality fix,
    /// which is exactly when jitter rejection matters most.
    ///
    /// Must stay strictly positive. Tuning it to zero would leave an invalid
    /// -1 speed comparing as *moving*, silently inverting that intent, and
    /// neither the compiler nor a test would say so.
    private static let kStationarySpeedMps: CLLocationSpeed = 0.5

    /// Adaptive heading smoothing: larger course changes are applied more
    /// aggressively, small ones eased, and sub-gate jitter ignored entirely.
    private func smoothedHeading(towards target: CLLocationDirection) -> CLLocationDirection {
        guard target >= 0 else { return currentHeading }
        var delta = target - currentHeading
        if delta > 180 {
            delta -= 360
        }
        if delta < -180 {
            delta += 360
        }
        guard abs(delta) > Self.kHeadingGateDegrees else { return currentHeading }

        let factor = if abs(delta) > 45.0 {
            1.0
        } else if abs(delta) > 20.0 {
            0.7
        } else if abs(delta) > 8.0 {
            0.5
        } else {
            0.3
        }
        var heading = currentHeading + delta * factor
        if heading < 0 {
            heading += 360
        }
        if heading >= 360 {
            heading -= 360
        }
        return heading
    }

    /// Heading of the route segment the user is currently snapped to, or
    /// `course` when there is no route or the user has strayed off it.
    private func routeDerivedHeading(
        at coord: CLLocationCoordinate2D,
        fallback course: CLLocationDirection
    ) -> CLLocationDirection {
        guard let polyline = routeMapPoints, routePointCount > 1 else { return course }
        let userPoint = MKMapPoint(coord)
        let snapResult = findClosestSegment(
            userPoint: userPoint,
            polyline: polyline,
            pointCount: routePointCount,
            fromIndex: lastMatchedIndex - kWindowRadius,
            toIndex: lastMatchedIndex + kWindowRadius
        )
        guard snapResult.segmentIndex >= 0,
              snapResult.perpDistance < kSnapOffThreshold,
              snapResult.segmentIndex < routePointCount - 1
        else { return course }
        lastMatchedIndex = snapResult.segmentIndex
        return bearing(
            from: polyline[snapResult.segmentIndex].coordinate,
            to: polyline[snapResult.segmentIndex + 1].coordinate
        )
    }

    /// THE INVARIANT: camera and cursor are mutated inside one animation
    /// block, always. This method holds the file's only assignment to
    /// `mapView.camera` — a camera that animates while the marker moves on
    /// MapKit's own schedule is what makes the position appear to rubber-band.
    ///
    /// `heading` orients the camera; `cursorHeading` orients the marker. The
    /// two differ whenever the map is not heading-up: north-up pins the camera
    /// at 0 while the marker still has to point where the vehicle is going.
    private func applyFollowCamera(
        coordinate: CLLocationCoordinate2D,
        heading: CLLocationDirection,
        cursorHeading: CLLocationDirection,
        duration: TimeInterval
    ) {
        let browsing = effectiveMode != .navigation
        // Browse keeps whatever zoom the user pinched to, but only once there
        // is one worth keeping: the first browse write after any other state
        // establishes the altitude rather than inheriting whatever the map
        // happened to be showing.
        let seeded = browsing && !wasBrowsing
        let distance: CLLocationDistance = if !browsing {
            navigationDistance
        } else if wasBrowsing {
            mapView.camera.centerCoordinateDistance
        } else {
            browseDistance
        }
        let pitch: CGFloat = browsing ? browsePitch : navigationPitch
        wasBrowsing = browsing

        #if DEBUG
            // Which branch set the altitude, and what it actually applied.
            // `seeded` is only meaningful for the browse modes: navigation
            // always takes the fixed route distance, so it reports NO.
            //
            // `speed` is the value the deadband gated on, in m/s, and is the
            // only visible evidence of which branch that took: a moving fix
            // must still move the camera. A negative reading means
            // CoreLocation reported no speed — including on a write that did
            // not come from a location update at all, such as the initial
            // centre.
            os_log(
                "expo-carplay: [CarPlayCam] mode=%{public}@ dist=%{public}.0f seeded=%{public}@ speed=%{public}.1f",
                effectiveMode.rawValue,
                distance,
                seeded ? "YES" : "NO",
                lastReportedSpeed
            )
        #endif

        let camera = MKMapCamera(
            lookingAtCenter: coordinate,
            fromDistance: distance,
            pitch: pitch,
            heading: heading
        )

        if !cursorAdded {
            cursor.coordinate = coordinate
            mapView.addAnnotation(cursor)
            cursorAdded = true
        }

        displayedCoordinate = coordinate
        currentHeading = heading
        cursor.heading = cursorHeading

        // Shortest way round, so a course crossing north turns the marker a
        // couple of degrees instead of spinning it the long way.
        var rotationDegrees = cursorHeading - heading
        if rotationDegrees > 180 {
            rotationDegrees -= 360
        }
        if rotationDegrees < -180 {
            rotationDegrees += 360
        }
        let rotation = rotationDegrees * .pi / 180.0

        UIView.animate(
            withDuration: duration,
            delay: 0,
            options: [.curveLinear, .beginFromCurrentState, .allowUserInteraction],
            animations: { [self] in
                mapView.camera = camera
                cursor.coordinate = coordinate
                if let cursorView = mapView.view(for: cursor) {
                    cursorView.transform = CGAffineTransformMakeRotation(rotation)
                }
            }
        )
    }

    private func _updateCamera(
        coordinate coord: CLLocationCoordinate2D,
        course: CLLocationDirection,
        accuracy: CLLocationAccuracy,
        speed: CLLocationSpeed
    ) {
        let mode = effectiveMode
        guard mode != .off else { return }

        #if DEBUG
            lastReportedSpeed = speed
        #endif

        // Stationary deadband: GPS noise while parked would make the map
        // wander and micro-reverse.
        //
        // Speed gates it, and that gate is load-bearing rather than a
        // belt-and-braces check on the distance test. Distance alone cannot
        // tell noise from slow travel: at 1 Hz fixes the 5 m floor also
        // suppresses anything under ~11 mph, and a poor fix raising the
        // threshold to 10 m pushes that to ~22 mph — above this vehicle
        // class's whole range. The camera would then advance in steps
        // instead of gliding, which is the opposite of what the single
        // animated writer exists to achieve. Speed states the actual
        // intent: only hold still when genuinely parked.
        //
        // Heading is deliberately NOT deadbanded — in browseHeadingUp the map
        // must still rotate while stopped.
        //
        // Position is measured against the last coordinate we applied rather
        // than the last one reported, so sub-threshold movement accumulates
        // until it crosses and is never silently discarded.
        var targetCoordinate = coord
        if speed < Self.kStationarySpeedMps, let displayed = displayedCoordinate {
            let threshold = max(Self.kMinDeadbandMeters, accuracy / 2.0)
            let moved = CLLocation(latitude: displayed.latitude, longitude: displayed.longitude)
                .distance(from: CLLocation(latitude: coord.latitude, longitude: coord.longitude))
            if moved < threshold {
                targetCoordinate = displayed
            }
        }

        var targetHeading: CLLocationDirection = 0
        switch mode {
        case .off:
            return
        case .browseNorthUp:
            targetHeading = 0
        case .browseHeadingUp:
            // GPS course only — never the compass. During CarPlay use the
            // phone is typically pocketed or in a cupholder, so magnetometer
            // heading describes the phone's orientation, not the vehicle's.
            targetHeading = course >= 0 ? smoothedHeading(towards: course) : currentHeading
        case .navigation:
            targetHeading = smoothedHeading(
                towards: routeDerivedHeading(at: targetCoordinate, fallback: course)
            )
        }

        applyFollowCamera(
            coordinate: targetCoordinate,
            heading: targetHeading,
            // The marker points where the vehicle is going in every mode —
            // only the camera's own heading varies by mode. A negative course
            // means CoreLocation has none, so hold the last one.
            cursorHeading: course >= 0 ? course : cursor.heading,
            duration: Self.kFollowAnimationDuration
        )
    }

    // MARK: - Route Management

    private func _setRouteOnMain(segments: [RouteSegment], edgePadding: EdgePadding? = nil) {
        _clearRouteOnMain()

        // Resolve nil to defaults at the boundary — handler logic uses a real Record.
        let edgePadding = edgePadding ?? EdgePadding()

        // Collect all coordinates across all segments for route projection math
        var allCoordinates: [CLLocationCoordinate2D] = []

        for segment in segments {
            guard segment.coordinates.count >= 2 else { continue }

            let color = ColorConverter.color(from: segment.color)

            var segCoordinates = segment.coordinates.map { coord in
                CLLocationCoordinate2D(latitude: coord.latitude, longitude: coord.longitude)
            }

            let polyline = MKPolyline(coordinates: &segCoordinates, count: segCoordinates.count)
            routeOverlays.append(polyline)
            overlayColors[polyline] = color
            mapView.addOverlay(polyline)

            allCoordinates.append(contentsOf: segCoordinates)
        }

        guard allCoordinates.count >= 2 else { return }

        // Build flat MKMapPoint array for camera heading projection
        routePointCount = allCoordinates.count
        routeMapPoints = .allocate(capacity: routePointCount)
        for (i, coord) in allCoordinates.enumerated() {
            routeMapPoints![i] = MKMapPoint(coord)
        }

        // Activate route-derived heading
        routeActive = true
        lastMatchedIndex = 0

        // Zoom to fit the route polyline. Padding is configurable from JS —
        // callers can adjust for UI overlays (e.g., route choice panel).
        if !routeOverlays.isEmpty {
            let rect = routeOverlays.reduce(MKMapRect.null) { $0.union($1.boundingMapRect) }
            let padding = UIEdgeInsets(
                top: edgePadding.top,
                left: edgePadding.left,
                bottom: edgePadding.bottom,
                right: edgePadding.right
            )
            mapView.setVisibleMapRect(rect, edgePadding: padding, animated: true)
        }

        // Add start/end pins and hide the user location dot during preview
        let startPin = MKPointAnnotation()
        startPin.coordinate = allCoordinates.first!
        startPin.title = "Start"
        let endPin = MKPointAnnotation()
        endPin.coordinate = allCoordinates.last!
        endPin.title = "End"
        routeAnnotations = [startPin, endPin]
        mapView.addAnnotations(routeAnnotations)
        mapView.showsUserLocation = false
    }

    private func _clearRouteOnMain() {
        for overlay in routeOverlays {
            mapView.removeOverlay(overlay)
        }
        routeOverlays.removeAll()
        overlayColors.removeAll()
        mapView.removeAnnotations(routeAnnotations)
        routeAnnotations.removeAll()
        mapView.showsUserLocation = true
        if let pts = routeMapPoints {
            pts.deallocate()
            routeMapPoints = nil
        }
        routePointCount = 0
        routeActive = false
        lastMatchedIndex = 0
    }

    // MARK: - MKMapViewDelegate

    func mapView(_: MKMapView, didUpdate userLocation: MKUserLocation) {
        guard needsInitialCenter, let location = userLocation.location else { return }
        _centerOnUserLocation(location.coordinate)
    }

    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        if annotation is MKUserLocation {
            // Our cursor is active — hide MapKit's dot so only one marker shows.
            let hidden = MKAnnotationView(annotation: annotation, reuseIdentifier: "hiddenUserLocation")
            hidden.frame = .zero
            hidden.isHidden = true
            hidden.alpha = 0
            return hidden
        }

        if let cursorAnnotation = annotation as? UserCursorAnnotation {
            // FALLBACK SITE — this one expression is the whole decision.
            // `MKUserLocationView` is public SDK API (iOS 14+), but Apple does
            // not document whether it draws the system dot when bound to an
            // annotation that is not `MKUserLocation`. If it renders empty —
            // the map slides correctly but no marker is visible anywhere —
            // swap the `??` operand below for an `MKAnnotationView` whose
            // `image` is a 22 pt blue circle with a 3 pt white ring and a soft
            // shadow. Nothing else in this file changes: the cursor is
            // positioned and rotated through `applyFollowCamera`, which only
            // needs *some* view back from here.
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: "userCursor")
                ?? MKUserLocationView(annotation: cursorAnnotation, reuseIdentifier: "userCursor")
            view.annotation = cursorAnnotation
            return view
        }

        guard let pointAnnotation = annotation as? MKPointAnnotation else { return nil }

        if pointAnnotation.title == "Start" {
            let view = MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "start")
            view.markerTintColor = .systemGreen
            view.glyphImage = UIImage(systemName: "figure.wave")
            view.displayPriority = .required
            return view
        }

        if pointAnnotation.title == "End" {
            let view = MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "end")
            view.markerTintColor = .systemRed
            view.glyphImage = UIImage(systemName: "mappin")
            view.displayPriority = .required
            return view
        }

        return nil
    }

    func mapView(_: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        if let polyline = overlay as? MKPolyline {
            let renderer = MKPolylineRenderer(polyline: polyline)
            renderer.strokeColor = overlayColors[polyline] ?? .systemBlue
            renderer.lineWidth = 5
            return renderer
        }
        return MKOverlayRenderer(overlay: overlay)
    }
}
