// SearchRecords.swift
// Records for CPSearchTemplate inputs.

import ExpoModulesCore

struct SearchResultItem: Record {
    // `.required` — empty-string text is indistinguishable from a valid
    // result row. See BarButtonConfig.id comment in SharedRecords.swift.
    @Field(.required) var text: String
    @Field var detailText: String?
}
