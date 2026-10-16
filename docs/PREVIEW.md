# Voice update — 2026-10-17

The latest owner request supersedes the Iraqi voice work described below:
all Arabic navigation speech is now being replaced with Modern Standard Arabic.
See `VOICE-SEARCH.md` for the complete 75-prompt pack and generation workflow.

# Darbna redesign preview — 16 October 2026

This is the first working design preview on `codex/darbna-preview`. It is not a completed
reimplementation of every navigation feature. The current TestFlight app has not been changed.

## What changed

- A branded header and clearer destination search entry.
- A compact home panel with actual saved home/work/favorites and the last destination.
  Empty shortcuts open search; they do not invent destinations.
- Secondary map tools and browsing reports move into a compact tray. Recenter stays directly
  accessible; the large driving report button remains directly accessible during navigation.
- Map brightness can be day, night or follow the device, independently of the purple panels.
- Map names prefer Arabic, Sorani/Kurdish or English as selected, falling back to available names.
  Missing translations are not fabricated. Name text gets a readable outline.
- Guidance has a larger turn symbol; controls follow the measured banner height to avoid overlap.
- Settings can play the existing recorded distance/turn sample before driving. Sufyan and Daniel
  files, generation parameters and playback speed are unchanged. Sorani uses the existing Arabic
  recording fallback; a recorded Sorani voice has not been produced.
- Preview identity, scheme, localized icon labels and local storage are separate from production.
- New map expressions are checked with MapLibre's own style validator. A null-valued label
  expression initially blanked the preview; it was corrected and covered by that regression check.
- Existing type-check issues were corrected: tracking-mode enum, platform-specific offline import,
  and duplicate Iraq-bounds export. The icon generator now handles Windows paths correctly.

Existing route alternatives, walking, stops, avoid options, reports, saved places, trip sharing,
downloaded maps, parked-car location, speed alerts, SOS and GPS guidance remain in the source.
Their presence does not mean each has passed a new real-device test.

## Map recommendation

Retain MapLibre with the existing OpenFreeMap/OpenStreetMap road map for this first preview,
and retain licensed Esri imagery for satellite mode in store builds. These are separate from
the search and routing providers; changing the map's appearance does not repair missing roads,
turn restrictions or business listings. No provider has been demonstrated to be best across Iraq.

Before choosing a paid replacement, compare the same real routes and searches in Baghdad,
Erbil, Sulaymaniyah, Basra, Mosul and intercity roads. Check Arabic/Sorani names, entrances,
one-way roads, turn restrictions, GPS recovery and data usage. HERE and Mapbox are candidates
for a measured comparison, not preselected upgrades. Do not add keys or billable services without
the owner's agreement.

References:
- https://maplibre.org/maplibre-react-native/docs/components/map/
- https://openfreemap.org/
- https://developers.arcgis.com/rest/basemap-styles/arcgis-imagery-standard-webmap-get/
- https://docs.here.com/coverage/docs/here-coverage-information
- https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/

## Build and install separately

Install dependencies at the repository root using `npm install --no-audit --no-fund`.
Run core and mobile tests, then `npm run typecheck --workspace @darbna/mobile`.

For a web trial, set `DARBNA_VARIANT=preview`, `EXPO_PUBLIC_API_URL=direct` and
`EXPO_NO_METRO_WORKSPACE_ROOT=1`, generate web icons, copy
`packages/core/data/emergency-numbers.json` to `apps/mobile/public/emergency-numbers.json`,
and run `expo export --platform web --output-dir dist-preview` from `apps/mobile`.
Serve that folder using HTTP. It cannot be opened reliably as a file:// page.
The new manual `preview.yml` workflow performs these steps and uploads a downloadable artifact;
it does not replace GitHub Pages or the shared `web-preview-wip` branch.

For a side-by-side iPhone trial, the owner must first create/register the separate
`iq.darbna.app.preview` identifier and corresponding App Store Connect app, configure its signing
and TestFlight testers, then run `iOS store build` on this branch with `variant=preview`.
The existing production bundle ID and current TestFlight listing remain separate.
The workflow's sharing switch remains off by default; its documented signing requirement is
unresolved. This work has not registered a device, created an Apple app record or uploaded an IPA.

## Verified locally

- 123 core tests passed, including two map-label tests.
- 14 mobile tests passed, including three MapLibre validation checks covering all three languages
  on day/night/satellite styles; locale-key and voice-plan tests passed.
- App TypeScript check passed.
- Production and preview Expo public configurations have distinct, expected identifiers/schemes.
- The web export completed and was opened at phone size (390 × 844).
- Browser checks: live Baghdad and Erbil map rendering, night mode, Arabic RTL home screen, live airport search,
  opening the returned airport place, recorded voice sample launch, and a displayed route with
  moving, explicitly labelled simulated guidance from the public Erbil tour position.
- iOS JavaScript export completed with `--no-bytecode`. This checks bundling, not native linking,
  signing or device behavior. Hermes bytecode compilation encountered a Windows sandbox temporary
  file permission error; it has not been claimed as successful.
- Server integration suite reported 39 skips; no server integration tests are counted as passed.

The browser route demonstration uses a synthetic tour origin and an actual mapped destination.
It is not evidence of a real drive, accurate traffic or correct arrival at the airport entrance.
No simulated traffic or reports were submitted as part of verification.

## Remaining work for the full rebuild

1. Review this design on the owner's iPhone and adjust accessibility and small-screen layouts.
2. Complete route/search comparisons against known real locations and road tests in Iraq.
3. Deploy the already planned dedicated routing/search services. Do not treat public community
   endpoints as an unlimited production backend.
4. Add and test background guidance; the current location hook only watches in the foreground.
5. Design actual offline route calculation. Downloaded map tiles alone do not provide it.
6. Validate traffic coverage, speed limits, checkpoints and community data with real observations;
   absence of data must remain visible.
7. Complete sharing-extension signing, native offline/download checks, audio interruptions,
   Bluetooth/CarPlay scope, battery/GPS testing and release checks before broader distribution.
8. Review every new Arabic/Sorani string with native speakers. Preserve the confirmed SOS policy.

Preview builds use the existing backend configuration when supplied. Distinct local storage does
not create a separate database. Only submit genuine reports; do not populate it with trial data.
