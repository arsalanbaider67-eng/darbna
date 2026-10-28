// search/search.ts
// Typed API for CPSearchTemplate operations.
// See: docs/carplay-api-surface.md §6 — Search Template
import ExpoCarPlay from '../ExpoCarPlayModule';
export async function createSearchTemplate() {
    return ExpoCarPlay.createSearchTemplate();
}
export async function updateSearchResults(requestId, results) {
    await ExpoCarPlay.updateSearchResults(requestId, results);
}
export function addSearchTextListener(listener) {
    return ExpoCarPlay.addListener('onSearchTextUpdated', listener);
}
export function addSearchResultSelectedListener(listener) {
    return ExpoCarPlay.addListener('onSearchResultSelected', listener);
}
export function addSearchButtonPressedListener(listener) {
    return ExpoCarPlay.addListener('onSearchButtonPressed', listener);
}
//# sourceMappingURL=search.js.map