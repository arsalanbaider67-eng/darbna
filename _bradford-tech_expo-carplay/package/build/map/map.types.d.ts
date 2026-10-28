import type { BarButtonConfig, Coordinate } from '../shared/shared.types';
export type RouteSegment = {
    coordinates: Coordinate[];
    color: string;
};
export type MapButtonConfig = {
    id: string;
    /** SF Symbol name for the button icon */
    systemImage?: string;
    /** Text label — renders as a pill-shaped button (use with backgroundColor) */
    title?: string;
    /** Hex color for pill background (e.g., "#FF3B30"). Only used with title. */
    backgroundColor?: string;
    enabled?: boolean;
    hidden?: boolean;
};
export type EdgePadding = {
    top?: number;
    left?: number;
    bottom?: number;
    right?: number;
};
export type MapTemplateConfig = {
    /** CarPlay shows up to 2 leading bar buttons; additional entries are ignored. */
    leadingNavigationBarButtons?: BarButtonConfig[];
    /** CarPlay shows up to 2 trailing bar buttons; additional entries are ignored. */
    trailingNavigationBarButtons?: BarButtonConfig[];
    /** CarPlay shows up to 3 map buttons; additional entries are ignored. */
    mapButtons?: MapButtonConfig[];
    automaticallyHidesNavigationBar?: boolean;
    hidesButtonsWithNavigationBar?: boolean;
    /**
     * Hex color (e.g., "#30B0C7") for the turn-by-turn guidance bar
     * background. When omitted, CarPlay uses the system default (red).
     */
    guidanceBackgroundColor?: string;
};
export type MapTemplateButtonsConfig = {
    /** CarPlay shows up to 2 leading bar buttons; additional entries are ignored. */
    leadingNavigationBarButtons?: BarButtonConfig[];
    /** CarPlay shows up to 2 trailing bar buttons; additional entries are ignored. */
    trailingNavigationBarButtons?: BarButtonConfig[];
    /** CarPlay shows up to 3 map buttons; additional entries are ignored. */
    mapButtons?: MapButtonConfig[];
};
/**
 * Camera follow mode for the CarPlay map.
 * - `off`: camera is not written; the user has panned away.
 * - `browseNorthUp`: follows the user, north-up, flat.
 * - `browseHeadingUp`: follows the user, rotated to GPS course, flat.
 * - `navigation`: follows the user, tilted, oriented to the active route.
 */
export type FollowMode = 'off' | 'browseNorthUp' | 'browseHeadingUp' | 'navigation';
/**
 * Camera geometry for the two follow families, so framing can be tuned
 * without a native build.
 *
 * Each call replaces the whole geometry: a field you omit reverts to the
 * native default rather than keeping a value set by an earlier call. Pass all
 * four together if you are tuning more than one.
 *
 * A negative value also means "use the native default". Zero is not a
 * sentinel — it is a legal pitch, and the one browse mode uses.
 *
 * Takes effect on the next location update; it does not move the camera by
 * itself.
 */
export type CameraGeometryConfig = {
    /** Metres from the ground for `browseNorthUp` and `browseHeadingUp`. */
    browseDistance?: number;
    /** Degrees of tilt for the browse modes. 0 is flat, looking straight down. */
    browsePitch?: number;
    /** Metres from the ground while a route is active. */
    navigationDistance?: number;
    /** Degrees of tilt while a route is active. */
    navigationPitch?: number;
};
//# sourceMappingURL=map.types.d.ts.map