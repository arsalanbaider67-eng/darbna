# @bradford-tech/expo-carplay

Expo module for integrating Apple CarPlay into React Native apps. Provides typed APIs for map templates, turn-by-turn navigation, maneuvers, travel estimates, and more — with an Expo config plugin for automatic iOS setup.

> **Note:** This module is in active development. The core navigation flow is working (map, routes, maneuvers, travel estimates). Additional template types are planned. See the [API Surface](#api-surface) tables below for current status.

## Install

```sh
npm install @bradford-tech/expo-carplay
```

Requires Node 20+, Expo SDK 55+, and iOS 15.0+.

## Quick Start

```typescript
import {
  addBarButtonPressedListener,
  addConnectListener,
  addTripStartedListener,
  createMapTemplate,
  createSearchTemplate,
  pushTemplate,
  setCarPlayRoute,
  setRootTemplate,
  showTripPreviews,
  startFollowingUser,
  startNavigation,
  updateManeuvers,
  updateTravelEstimates,
  useCarPlay,
} from "@bradford-tech/expo-carplay";
import { useEffect } from "react";

const trip = {
  origin: { latitude: 37.335, longitude: -122.009 },
  destination: { latitude: 37.345, longitude: -122.002 },
  routeChoices: [
    {
      summaryVariants: ["Via Infinite Loop", "Fastest route"],
      additionalInformationVariants: ["0.5 mi — 2 min"],
    },
  ],
};

export default function App() {
  const { connected } = useCarPlay();

  useEffect(() => {
    const connectSub = addConnectListener(async () => {
      const templateId = await createMapTemplate({
        leadingNavigationBarButtons: [
          { id: "search", systemImage: "magnifyingglass" },
        ],
      });
      await setRootTemplate(templateId);
    });

    const barButtonSub = addBarButtonPressedListener(async ({ id }) => {
      if (id === "search") {
        const searchId = await createSearchTemplate();
        await pushTemplate(searchId);
      }
    });

    // When user taps "Go" on a trip preview
    const tripStartedSub = addTripStartedListener(async () => {
      await startFollowingUser();
      await startNavigation(trip);
      await updateManeuvers([
        {
          instructionVariants: ["Head northeast on Infinite Loop"],
          symbolImage: { systemName: "arrow.up" },
          distanceRemaining: 800,
          timeRemaining: 120,
        },
      ]);
      await updateTravelEstimates({ distanceRemaining: 800, timeRemaining: 120 }, 0);
    });

    return () => {
      connectSub.remove();
      barButtonSub.remove();
      tripStartedSub.remove();
    };
  }, []);

  const handleStartNavigation = async () => {
    if (!connected) return;

    // 1. Draw the route on the map
    await setCarPlayRoute([
      {
        coordinates: [
          { latitude: 37.335, longitude: -122.009 },
          { latitude: 37.339, longitude: -122.005 },
        ],
        color: "systemTeal",
      },
    ]);

    // 2. Show trip preview — user taps "Go" to start navigation
    await showTripPreviews([trip]);
  };
}
```

## Expo Config Plugin

The module includes an Expo config plugin that automatically configures your iOS project:

- Adds the CarPlay scene manifest to `Info.plist`
- Adds CarPlay entitlements
- Bridges the phone scene delegate for multi-scene support

No manual Xcode configuration needed — just install and run `npx expo prebuild`.

### Background location (recommended)

The CarPlay map's follow camera is driven by a native `CLLocationManager`. In
the normal CarPlay case the phone is locked or pocketed, so unless the host
app declares the `location` background mode, iOS may suspend location updates
and freeze the camera:

```js
// app.json / app.config.js
"ios": { "infoPlist": { "UIBackgroundModes": ["location"] } }
```

The module only enables background location updates when this mode is present
(setting the flag without it is a fatal iOS error). Without it, a one-time
warning is logged and the camera follows only while the phone is unlocked.

## API Surface

The module wraps Apple's CarPlay framework (iOS 12.0 – 26.4) for use from JavaScript/TypeScript. The tables below show every feature area and its implementation status.

**Status:** ● Implemented · ○ Not yet implemented

### Implementation Summary

| Category | Status | Notes |
| --- | --- | --- |
| Expo Config Plugin | ● | Info.plist scene manifest, CarPlay entitlements, phone scene delegate bridge |
| Privacy Manifest | ● | `PrivacyInfo.xcprivacy` declares precise location for app functionality |
| Web stub | ● | All methods resolve to safe defaults with a one-time warning so web bundles can import the package |
| Scene Lifecycle | ● | Connect/disconnect events, interface controller & window references |
| Interface Controller | Partial | `setRootTemplate`, `pushTemplate`, `popTemplate`; present/dismiss not yet exposed |
| Map Template | ● | Creation with button config, map delegate, MKMapView with location tracking, route polylines |
| Navigation Session | ● | Start/stop, trip previews, maneuver updates, travel estimate updates |
| Maneuvers | Partial | `instructionVariants`, `symbolImage` (SF Symbols), `initialTravelEstimates` |
| Trip & Route Choice | ● | Origin/destination, route choice summary variants |
| Travel Estimates | ● | Distance remaining, time remaining |
| List Template | ○ | Not started |
| Grid Template | ○ | Not started |
| Search Template | ● | Create, search text events, result selection, request ID pattern |
| Tab Bar Template | ○ | Not started |
| Information Template | ○ | Not started |
| Voice Control Template | ○ | Not started |
| Alerts & Action Sheets | ○ | Not started |
| Session Configuration | ○ | Not started |
| Contact Template | ○ | Not started |
| Point of Interest | ○ | Not started |
| Now Playing | ○ | Not started |
| Dashboard & Instrument Cluster | ○ | Not started |
| Multitouch (iOS 26+) | ○ | Not started |

### React Hooks

| Hook | Description | Status |
| --- | --- | --- |
| `useCarPlay()` | Returns `{ connected: boolean }` — reactive CarPlay connection state | ● |

### Scene Lifecycle & Interface Controller

| API | Kind | Status |
| --- | --- | --- |
| `addConnectListener(listener)` | Native→JS | ● |
| `addDisconnectListener(listener)` | Native→JS | ● |
| `isConnected()` | JS→Native (sync query) | ● |
| `setRootTemplate(templateId)` | JS→Native | ● |
| `pushTemplate(templateId)` | JS→Native | ● |
| `popTemplate()` | JS→Native | ● |
| `popToRootTemplate(animated:)` | JS→Native | ○ |
| `presentTemplate(_:animated:)` | JS→Native | ○ |
| `dismissTemplate(animated:)` | JS→Native | ○ |
| Interface controller delegate events | Native→JS | ○ |
| Content style observation | Native→JS | ○ |

### Map Template

| API | Kind | Status |
| --- | --- | --- |
| `createMapTemplate(config?)` | JS→Native | ● |
| `startFollowingUser()` | JS→Native | ● |
| `stopFollowingUser()` | JS→Native | ● |
| `setFollowMode(mode)` | JS→Native | ● |
| `setCameraGeometry(geometry)` | JS→Native | ● |
| `setCarPlayRoute(segments)` | JS→Native | ● |
| `clearCarPlayRoute()` | JS→Native | ● |
| Map delegate (panning events) | Native→JS | ○ |
| Map buttons (`MapButtonConfig[]`) | Config | ● |
| Navigation bar buttons (`BarButtonConfig[]`) | Config | ● |
| `updateMapTemplateButtons(config)` | JS→Native | ● |
| `addBarButtonPressedListener(listener)` | Native→JS | ● |
| `addMapButtonPressedListener(listener)` | Native→JS | ● |
| `showPanningInterface(animated:)` | JS→Native | ○ |
| `dismissPanningInterface(animated:)` | JS→Native | ○ |

### Navigation Session

| API | Kind | Status |
| --- | --- | --- |
| `startNavigation(trip)` | JS→Native | ● |
| `stopNavigation()` | JS→Native | ● |
| `updateManeuvers(maneuvers)` | JS→Native | ● |
| `updateTravelEstimates(estimates, maneuverIndex?)` | JS→Native | ● |
| `getActiveSessionId()` | JS | ● |
| `showTripPreviews(trips)` | JS→Native | ● |
| `hideTripPreviews()` | JS→Native | ● |
| `addTripPreviewSelectedListener(listener)` | Native→JS | ● |
| `addTripStartedListener(listener)` | Native→JS | ● |
| `showRouteChoicesPreview(for:textConfiguration:)` | JS→Native | ○ |
| `cancelTrip()` | JS→Native | ○ |
| `pauseTrip(for:description:)` | JS→Native | ○ |
| `resumeTrip(updatedRouteInformation:)` | JS→Native | ○ |
| Map template navigation delegate events | Native→JS | ○ |

### Trip & Route Choice

| API | Kind | Status |
| --- | --- | --- |
| `CPTrip` (origin, destination, routeChoices) | Config | ● |
| `CPRouteChoice` (summaryVariants, additionalInformationVariants) | Config | ● |
| `CPTravelEstimates` (distanceRemaining, timeRemaining) | Config | ● |
| `CPTripPreviewTextConfiguration` | Config | ○ |
| `CPRouteInformation` (iOS 17.4+) | Config | ○ |
| `CPRouteSegment` (iOS 26.4+) | Config | ○ |
| `CPNavigationWaypoint` (iOS 26.4+) | Config | ○ |

### Maneuvers

| API | Kind | Status |
| --- | --- | --- |
| `instructionVariants` | Config | ● |
| `symbolImage` (SF Symbols) | Config | ● |
| `initialTravelEstimates` | Config | ● |
| `attributedInstructionVariants` | Config | ○ |
| `symbolSet` (CPImageSet) | Config | ○ |
| `junctionImage` | Config | ○ |
| `dashboardSymbolImage` / `dashboardInstructionVariants` | Config | ○ |
| `notificationSymbolImage` / `notificationInstructionVariants` | Config | ○ |
| `maneuverType` (54 cases) | Config | ○ |
| `maneuverState` | Config | ○ |
| `junctionType` / `trafficSide` | Config | ○ |
| `linkedLaneGuidance` | Config | ○ |
| Lane guidance (`CPLaneGuidance`, `CPLane`) | Config | ○ |

### Navigation Alerts

| API | Kind | Status |
| --- | --- | --- |
| `CPNavigationAlert` (title, subtitle, image, actions, duration) | Config | ○ |
| `present(navigationAlert:animated:)` | JS→Native | ○ |
| `dismissNavigationAlert(animated:)` | JS→Native | ○ |
| Navigation alert delegate events | Native→JS | ○ |

### Search Template

| API | Kind | Status |
| --- | --- | --- |
| `createSearchTemplate()` | JS→Native | ● |
| `updateSearchResults(requestId, items)` | JS→Native | ● |
| `addSearchTextListener(listener)` | Native→JS | ● |
| `addSearchResultSelectedListener(listener)` | Native→JS | ● |
| `addSearchButtonPressedListener(listener)` | Native→JS | ● |

### List Template

| API | Kind | Status |
| --- | --- | --- |
| `CPListTemplate` creation (title, sections) | JS→Native | ○ |
| `CPListSection` (items, header) | Config | ○ |
| `CPListItem` (text, detailText, image, handler) | Config | ○ |
| `CPListImageRowItem` (text, images) | Config | ○ |
| `updateSections(_:)` | JS→Native | ○ |
| List item selection delegate | Native→JS | ○ |
| Assistant cell configuration | Config | ○ |

### Grid Template

| API | Kind | Status |
| --- | --- | --- |
| `CPGridTemplate` creation (title, gridButtons) | JS→Native | ○ |
| `CPGridButton` (titleVariants, image, handler) | Config | ○ |
| `updateGridButtons(_:)` | JS→Native | ○ |

### Tab Bar Template

| API | Kind | Status |
| --- | --- | --- |
| `CPTabBarTemplate` creation (templates) | JS→Native | ○ |
| `updateTemplates(_:)` | JS→Native | ○ |
| Tab selection delegate | Native→JS | ○ |

### Information Template

| API | Kind | Status |
| --- | --- | --- |
| `CPInformationTemplate` creation (title, layout, items, actions) | JS→Native | ○ |
| `CPInformationItem` (title, detail) | Config | ○ |
| `CPTextButton` (title, textStyle, handler) | Config | ○ |

### Alert & Action Sheet Templates

| API | Kind | Status |
| --- | --- | --- |
| `CPAlertTemplate` (titleVariants, actions) | JS→Native | ○ |
| `CPActionSheetTemplate` (title, message, actions) | JS→Native | ○ |
| `CPAlertAction` (title, style, handler) | Config | ○ |

### Voice Control Template

| API | Kind | Status |
| --- | --- | --- |
| `CPVoiceControlTemplate` (voiceControlStates) | JS→Native | ○ |
| `CPVoiceControlState` (identifier, titleVariants, image) | Config | ○ |
| `activateVoiceControlState(withIdentifier:)` | JS→Native | ○ |

### Contact Template

| API | Kind | Status |
| --- | --- | --- |
| `CPContactTemplate` / `CPContact` | JS→Native | ○ |
| Contact action buttons (call, directions, message) | Config | ○ |

### Point of Interest Template

| API | Kind | Status |
| --- | --- | --- |
| `CPPointOfInterestTemplate` (title, pointsOfInterest) | JS→Native | ○ |
| `CPPointOfInterest` (location, title, subtitle, pinImage) | Config | ○ |
| Point of interest delegate events | Native→JS | ○ |

### Now Playing Template

| API | Kind | Status |
| --- | --- | --- |
| `CPNowPlayingTemplate.shared` | Config | ○ |
| Now playing buttons (rate, shuffle, repeat, etc.) | Config | ○ |
| Now playing observer events | Native→JS | ○ |
| Sports mode (iOS 18.4+) | Config | ○ |

### Session Configuration

| API | Kind | Status |
| --- | --- | --- |
| `CPSessionConfiguration` (delegate) | Config | ○ |
| Content style change events | Native→JS | ○ |
| Limited user interface change events | Native→JS | ○ |

### Dashboard & Instrument Cluster

| API | Kind | Status |
| --- | --- | --- |
| `CPTemplateApplicationDashboardScene` | Config | ○ |
| `CPDashboardController` / `CPDashboardButton` | Config | ○ |
| `CPTemplateApplicationInstrumentClusterScene` | Config | ○ |
| `CPInstrumentClusterController` | Config | ○ |

### Multitouch (iOS 26+)

| API | Kind | Status |
| --- | --- | --- |
| Zoom gestures (pinch, double-tap) | Native→JS | ○ |
| Rotation gestures | Native→JS | ○ |
| Pitch gestures | Native→JS | ○ |

## How It Works

The module has three layers:

1. **TypeScript API** (`src/`) — Typed functions and React hooks that consumers import from `@bradford-tech/expo-carplay`.
2. **Swift native module** (`ios/`) — Bridges to Apple's CarPlay framework using Expo modules core. Handles `CPTemplateApplicationSceneDelegate`, `CPMapTemplate`, `CPNavigationSession`, `MKMapView`, and the event pipeline back to JS.
3. **Expo config plugin** (`plugin/`) — Automatically configures `Info.plist` with the CarPlay scene manifest and adds the required entitlements at prebuild time.

The native layer manages the CarPlay map using `MKMapView` with native location tracking. Route polylines are rendered as colored `MKPolyline` overlays. Navigation sessions use `CPTrip`, `CPManeuver`, and `CPTravelEstimates` from the CarPlay framework.

## Types

All types are exported from the package:

```typescript
import type {
  BarButtonConfig,
  Coordinate,
  MapButtonConfig,
  MapTemplateConfig,
  ManeuverConfig,
  RouteSegment,
  SearchResultItem,
  TravelEstimates,
  TripConfig,
} from "@bradford-tech/expo-carplay";
```

## Contributing

```sh
git clone https://github.com/bradford-tech/expo-carplay.git
cd expo-carplay
npm install

# Build the TypeScript library
npm run build

# Build the Expo config plugin
npm run build:plugin

# Format, lint, type-check
npm run fix

# Run the example app
npm run dev

# Open the iOS project in Xcode
npm run open:ios
```

## License

MIT
