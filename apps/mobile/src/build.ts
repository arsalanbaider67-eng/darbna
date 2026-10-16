import Constants from "expo-constants";
export const IS_PREVIEW = Constants.expoConfig?.extra?.buildVariant === "preview";
export const APP_SCHEME = IS_PREVIEW ? "darbna-preview" : "darbna";
export const STORAGE_PREFIX = IS_PREVIEW ? "darbna-preview:" : "darbna:";
