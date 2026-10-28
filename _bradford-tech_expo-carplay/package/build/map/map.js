// map/map.ts
// Typed API for CPMapTemplate and CarPlay map control.
// See: docs/carplay-api-surface.md §2 — Map Template & Map Buttons
import ExpoCarPlay from '../ExpoCarPlayModule';
export async function createMapTemplate(config) {
    return ExpoCarPlay.createMapTemplate(config ?? null);
}
export async function startFollowingUser() {
    await ExpoCarPlay.startFollowingUser();
}
export async function stopFollowingUser() {
    await ExpoCarPlay.stopFollowingUser();
}
export async function setFollowMode(mode) {
    await ExpoCarPlay.setFollowMode(mode);
}
export async function setCameraGeometry(geometry) {
    await ExpoCarPlay.setCameraGeometry(geometry);
}
export async function setCarPlayRoute(segments, edgePadding) {
    await ExpoCarPlay.setCarPlayRoute(segments, edgePadding ?? null);
}
export async function clearCarPlayRoute() {
    await ExpoCarPlay.clearCarPlayRoute();
}
export async function updateMapTemplateButtons(config) {
    await ExpoCarPlay.updateMapTemplateButtons(config);
}
export function addBarButtonPressedListener(listener) {
    return ExpoCarPlay.addListener('onBarButtonPressed', listener);
}
export function addMapButtonPressedListener(listener) {
    return ExpoCarPlay.addListener('onMapButtonPressed', listener);
}
//# sourceMappingURL=map.js.map