// ExpoCarPlayModule.web.ts
// Web stub. CarPlay is iOS-only; this file lets web bundles import the package
// without crashing autolinking. Every method warns once and resolves to a safe
// default so consumers can guard with `Platform.OS === 'ios'`.
//
// The `: ExpoCarPlayModule` annotation forces this stub to stay in sync with
// the native interface — adding a method to ExpoCarPlayModule.ts fails the
// web build until the stub is updated.
let warned = false;
function warn() {
    if (!warned) {
        console.warn('@bradford-tech/expo-carplay is not supported on web');
        warned = true;
    }
}
const noopSubscription = { remove: () => { } };
const webModule = {
    addListener: (_eventName, _listener) => {
        warn();
        return noopSubscription;
    },
    isCarPlayConnected: () => {
        warn();
        return false;
    },
    createMapTemplate: (_config) => {
        warn();
        return Promise.resolve('');
    },
    updateMapTemplateButtons: (_config) => {
        warn();
        return Promise.resolve();
    },
    setRootTemplate: (_templateId) => {
        warn();
        return Promise.resolve();
    },
    pushTemplate: (_templateId) => {
        warn();
        return Promise.resolve();
    },
    popTemplate: () => {
        warn();
        return Promise.resolve();
    },
    startFollowingUser: () => {
        warn();
        return Promise.resolve();
    },
    stopFollowingUser: () => {
        warn();
        return Promise.resolve();
    },
    setFollowMode: (_mode) => {
        warn();
        return Promise.resolve();
    },
    setCameraGeometry: (_geometry) => {
        warn();
        return Promise.resolve();
    },
    setCarPlayRoute: (_segments, _edgePadding) => {
        warn();
        return Promise.resolve();
    },
    clearCarPlayRoute: () => {
        warn();
        return Promise.resolve();
    },
    startNavigation: (_tripConfig) => {
        warn();
        return Promise.resolve('');
    },
    stopNavigation: () => {
        warn();
        return Promise.resolve();
    },
    showTripPreviews: (_trips) => {
        warn();
        return Promise.resolve();
    },
    hideTripPreviews: () => {
        warn();
        return Promise.resolve();
    },
    updateManeuvers: (_maneuvers) => {
        warn();
        return Promise.resolve();
    },
    updateTravelEstimates: (_estimates, _maneuverIndex) => {
        warn();
        return Promise.resolve();
    },
    createSearchTemplate: () => {
        warn();
        return Promise.resolve('');
    },
    updateSearchResults: (_requestId, _items) => {
        warn();
        return Promise.resolve();
    },
};
export default webModule;
//# sourceMappingURL=ExpoCarPlayModule.web.js.map