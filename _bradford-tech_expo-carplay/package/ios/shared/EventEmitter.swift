// EventEmitter.swift
// Cross-cutting utility for sending events from native handlers to JS.
// All handlers call EventEmitter rather than coupling directly to the module instance.

import ExpoModulesCore

final class CarPlayEventEmitter {
    static let shared = CarPlayEventEmitter()

    private weak var module: Module?

    private init() {}

    func setModule(_ module: Module) {
        self.module = module
    }

    func emit(_ eventName: String, _ body: [String: Any] = [:]) {
        module?.sendEvent(eventName, body)
    }
}
