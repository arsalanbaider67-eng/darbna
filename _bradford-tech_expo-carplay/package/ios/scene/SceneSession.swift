// SceneSession.swift
// Holds references to the active scene's CPInterfaceController, CPWindow,
// CarPlayMapViewController, the scene's TemplateStore, and the three
// feature handlers.
//
// `static var current` is the access point for ExpoCarPlayModule's
// AsyncFunctions — an honest "the one connected scene at a time"
// accessor. When multi-scene support (Dashboard, Cluster) lands later,
// it becomes additive: SceneSession.dashboard: SceneSession? etc.
//
// Lifecycle: CarPlaySceneDelegate constructs this in didConnect and sets
// SceneSession.current = nil in didDisconnect. The latter deallocates
// the handlers + view controller, which is what fixes the
// state-leak-across-disconnect bug that motivated D1.
//
// See: docs/superpowers/specs/2026-05-16-di-rework-design.md

import CarPlay

final class SceneSession {
    let interfaceController: CPInterfaceController
    let window: CPWindow
    let mapViewController: CarPlayMapViewController
    /// Templates created during this scene. Owned here, not module-wide, so
    /// a template lookup and the scene guard that precedes it read the same
    /// snapshot — see TemplateStore.swift.
    let templateStore: TemplateStore
    let mapHandler: MapTemplateHandler
    let navigationHandler: NavigationHandler
    let searchHandler: SearchTemplateHandler

    // Written on the main thread (scene delegate connect/disconnect), read
    // from the JS thread (sync isCarPlayConnected) and the AsyncFunction
    // background queue. The lock makes those cross-thread accesses
    // well-defined rather than a benign-in-practice pointer race — and keeps
    // this compiling once strict concurrency checking lands.
    private static let currentLock = NSLock()
    private static var _current: SceneSession?
    static var current: SceneSession? {
        get {
            currentLock.lock()
            defer { currentLock.unlock() }
            return _current
        }
        set {
            currentLock.lock()
            defer { currentLock.unlock() }
            _current = newValue
        }
    }

    init(
        interfaceController: CPInterfaceController,
        window: CPWindow,
        mapViewController: CarPlayMapViewController,
        templateStore: TemplateStore,
        mapHandler: MapTemplateHandler,
        navigationHandler: NavigationHandler,
        searchHandler: SearchTemplateHandler
    ) {
        self.interfaceController = interfaceController
        self.window = window
        self.mapViewController = mapViewController
        self.templateStore = templateStore
        self.mapHandler = mapHandler
        self.navigationHandler = navigationHandler
        self.searchHandler = searchHandler
    }

    /// Resolves a JS template id against this scene's store.
    ///
    /// Callers obtain `self` from `SceneSession.current` and then call this,
    /// so the scene guard and the template lookup read one snapshot. That is
    /// what keeps the two exceptions honest: a disconnect racing the call is
    /// `CarPlayNotConnectedException` (no session), and
    /// `TemplateNotFoundException` is reserved for an id this scene never
    /// issued — including ids minted by an earlier scene.
    func template(_ id: String) throws -> CPTemplate {
        guard let template = templateStore.get(id) else {
            throw TemplateNotFoundException(id)
        }
        return template
    }
}
