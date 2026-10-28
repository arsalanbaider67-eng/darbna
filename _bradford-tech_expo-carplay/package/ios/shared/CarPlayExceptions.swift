// CarPlayExceptions.swift
// Cross-cutting exception classes thrown by multiple template-stack
// call sites (setRootTemplate, pushTemplate, and later features).
// Feature-local exceptions, if they emerge, live alongside their handler.

import ExpoModulesCore

final class TemplateNotFoundException: GenericException<String>, @unchecked Sendable {
    override var reason: String {
        "Template not found: \(param)"
    }
}

final class CarPlayNotConnectedException: Exception, @unchecked Sendable {
    override var reason: String {
        "CarPlay is not connected"
    }
}

/// Temporary. Exists only for the Phase B → D bridge: today, "no map template"
/// means rootTemplate isn't a CPMapTemplate. After Phase D adds an explicit
/// mapTemplateId parameter, this collapses into TemplateNotFoundException
/// (wrong id) + a new TemplateTypeMismatchException (id resolves to non-map).
/// Consumers should not pin to ERR_NO_MAP_TEMPLATE.
final class NoMapTemplateException: Exception, @unchecked Sendable {
    override var reason: String {
        "No CPMapTemplate at root — startNavigation requires the map template to be the root."
    }
}
