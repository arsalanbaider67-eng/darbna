// TemplateStore.swift
// Per-scene registry mapping JS string IDs to native CPTemplate instances.
//
// Lifecycle: one store per SceneSession, constructed in
// CarPlaySceneDelegate.didConnect and released with the session on
// didDisconnect. Templates therefore live exactly as long as the scene that
// created them, and a lookup can only ever see templates from the scene the
// caller just observed. That is what lets ExpoCarPlayModule report a
// disconnect that races a template call as CarPlayNotConnectedException,
// never as TemplateNotFoundException — the two facts come from one
// SceneSession snapshot instead of a global store and a global session that
// are torn down separately.
//
// A typical session has at most a few dozen templates, so per-template
// removal is unnecessary; dropping the store with the session is the only
// cleanup.

import CarPlay
import Foundation

final class TemplateStore {
    private var templates: [String: CPTemplate] = [:]

    /// Every access today runs on expo-modules-core's serial AsyncFunction
    /// queue, so the lock is not load-bearing yet. It stays because that is
    /// an implicit property of the callers, not of this type: one
    /// `.runOnQueue(.main)` on a template function would otherwise turn
    /// a dictionary read against a concurrent write into a Swift data race
    /// (crash, not a missed lookup). Same reasoning as SceneSession.current.
    private let lock = NSLock()

    func store(_ template: CPTemplate) -> String {
        let id = UUID().uuidString
        lock.lock()
        defer { lock.unlock() }
        templates[id] = template
        return id
    }

    func get(_ id: String) -> CPTemplate? {
        lock.lock()
        defer { lock.unlock() }
        return templates[id]
    }
}
