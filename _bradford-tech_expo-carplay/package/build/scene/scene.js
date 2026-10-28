// scene/scene.ts
// Typed API for CarPlay connection lifecycle.
// Connection state is read from native on demand — no JS-side cache.
// See: docs/carplay-api-surface.md §1 — Scene Lifecycle & Interface Controller
import ExpoCarPlay from '../ExpoCarPlayModule';
// Delegates to the native scene registry rather than caching in JS. A JS
// latch fed by onConnect/onDisconnect misses any connect that fires before
// this module loads (CarPlay-initiated cold launch — the emit is
// fire-and-forget with no buffering); querying native on every call makes
// that class of staleness impossible. Events remain the reactivity channel
// (useCarPlay, consumer listeners).
export function isConnected() {
    return ExpoCarPlay.isCarPlayConnected();
}
export function addConnectListener(listener) {
    return ExpoCarPlay.addListener('onConnect', listener);
}
export function addDisconnectListener(listener) {
    return ExpoCarPlay.addListener('onDisconnect', listener);
}
export async function setRootTemplate(templateId) {
    await ExpoCarPlay.setRootTemplate(templateId);
}
export async function pushTemplate(templateId) {
    await ExpoCarPlay.pushTemplate(templateId);
}
export async function popTemplate() {
    await ExpoCarPlay.popTemplate();
}
//# sourceMappingURL=scene.js.map