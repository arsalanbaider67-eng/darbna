import { type ConfigPlugin } from 'expo/config-plugins';
/**
 * CarPlay requires UIApplicationSceneManifest in Info.plist, which forces iOS
 * to adopt scene lifecycle for the entire app. Expo's AppDelegate creates its
 * window in didFinishLaunchingWithOptions using UIWindow(frame:), which isn't
 * associated with a scene — so the phone screen goes black.
 *
 * We fix this by:
 * 1. Declaring both a phone scene and CarPlay scene in Info.plist
 * 2. Writing a PhoneSceneDelegate.swift that takes AppDelegate's existing
 *    window and assigns it to the window scene
 * 3. Adding the file to the Xcode project so it gets compiled
 */
export declare const withCarPlayInfoPlist: ConfigPlugin;
