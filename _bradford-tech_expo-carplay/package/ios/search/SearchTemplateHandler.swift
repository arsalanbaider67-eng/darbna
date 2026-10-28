// SearchTemplateHandler.swift
// Creates CPSearchTemplate and implements CPSearchTemplateDelegate.
// Uses request ID pattern for async search results across the JS bridge.
// See: docs/carplay-api-surface.md §6 — Search Template

import CarPlay
import Foundation

final class SearchTemplateHandler: NSObject, CPSearchTemplateDelegate {
    private let templateStore: TemplateStore
    private var pendingCompletions: [String: ([CPListItem]) -> Void] = [:]
    private var currentRequestId: String?

    init(templateStore: TemplateStore) {
        self.templateStore = templateStore
        super.init()
    }

    // MARK: - Public API

    func create() -> String {
        let template = CPSearchTemplate()
        template.delegate = self
        return templateStore.store(template)
    }

    func updateResults(requestId: String, items: [SearchResultItem]) {
        DispatchQueue.main.async { [self] in
            guard let completion = pendingCompletions.removeValue(forKey: requestId) else {
                return // Stale request — silently ignore
            }

            let listItems = items.map { item in
                CPListItem(text: item.text, detailText: item.detailText)
            }

            completion(listItems)
        }
    }

    // MARK: - CPSearchTemplateDelegate

    func searchTemplate(
        _: CPSearchTemplate,
        updatedSearchText searchText: String,
        completionHandler: @escaping ([CPListItem]) -> Void
    ) {
        // Auto-cancel previous pending request
        if let previousId = currentRequestId,
           let previousCompletion = pendingCompletions.removeValue(forKey: previousId) {
            previousCompletion([])
        }

        // Generate new request ID and store completion handler
        let requestId = UUID().uuidString
        currentRequestId = requestId
        pendingCompletions[requestId] = completionHandler

        // Emit event to JS
        CarPlayEventEmitter.shared.emit("onSearchTextUpdated", [
            "requestId": requestId,
            "searchText": searchText
        ])
    }

    func searchTemplate(
        _: CPSearchTemplate,
        selectedResult item: CPListItem,
        completionHandler: @escaping () -> Void
    ) {
        CarPlayEventEmitter.shared.emit("onSearchResultSelected", [
            "text": item.text ?? "",
            "detailText": item.detailText ?? ""
        ])

        // Call completion immediately — selection is fire-and-forget
        completionHandler()
    }

    func searchTemplateSearchButtonPressed(_: CPSearchTemplate) {
        CarPlayEventEmitter.shared.emit("onSearchButtonPressed", [:])
    }
}
