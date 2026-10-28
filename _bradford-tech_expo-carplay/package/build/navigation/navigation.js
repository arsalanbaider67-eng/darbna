// navigation/navigation.ts
// Typed API for CPNavigationSession lifecycle.
// See: docs/carplay-api-surface.md §3 — Navigation Session & Route Guidance
import ExpoCarPlay from '../ExpoCarPlayModule';
let activeSessionId = null;
ExpoCarPlay.addListener('onDisconnect', () => {
    activeSessionId = null;
});
export async function startNavigation(trip) {
    const sessionId = await ExpoCarPlay.startNavigation(trip);
    activeSessionId = sessionId;
    return sessionId;
}
export async function stopNavigation() {
    await ExpoCarPlay.stopNavigation();
    activeSessionId = null;
}
export async function updateManeuvers(maneuvers) {
    await ExpoCarPlay.updateManeuvers(maneuvers);
}
export async function updateTravelEstimates(estimates, maneuverIndex) {
    await ExpoCarPlay.updateTravelEstimates(estimates, maneuverIndex);
}
export function getActiveSessionId() {
    return activeSessionId;
}
/** CarPlay shows up to 12 trip previews; additional entries are ignored. */
export async function showTripPreviews(trips) {
    await ExpoCarPlay.showTripPreviews(trips);
}
export async function hideTripPreviews() {
    await ExpoCarPlay.hideTripPreviews();
}
export function addTripPreviewSelectedListener(listener) {
    return ExpoCarPlay.addListener('onTripPreviewSelected', listener);
}
export function addTripStartedListener(listener) {
    return ExpoCarPlay.addListener('onTripStarted', listener);
}
//# sourceMappingURL=navigation.js.map