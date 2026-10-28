export type Coordinate = {
    latitude: number;
    longitude: number;
};
export type BarButtonStyle = 'none' | 'rounded';
export type BarButtonConfig = {
    id: string;
    title?: string;
    systemImage?: string;
    style?: BarButtonStyle;
    enabled?: boolean;
};
/**
 * Image reference for new image-input fields (Maneuver.symbolImage, future
 * List/Grid item images). One of `systemName` (SF Symbol) or `uri` (file path).
 *
 * Existing string-shaped image fields (BarButtonConfig.systemImage,
 * MapButtonConfig.systemImage) are deliberately not migrated to ImageRef;
 * that's a separate breaking-change decision.
 */
export type ImageRef = {
    systemName: string;
} | {
    uri: string;
};
//# sourceMappingURL=shared.types.d.ts.map