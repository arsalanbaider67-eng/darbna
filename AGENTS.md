# Darbna — guide for AI coding agents (and new developers)

Read this first. It is the single handoff document for anyone (Claude, Codex, Cursor, Copilot,
Gemini, a human) working on this repo. Keep it up to date when you change how things work.

## What Darbna is
A free turn-by-turn navigation app for **Iraq** (دربنا, "our road"). Arabic first (Iraqi dialect),
Sorani Kurdish (ckb) and English. Recorded Iraqi-voice guidance, driver road reports (checkpoint
queues, cameras, crashes…), live traffic and traffic lights learned from drivers, SOS (911), trip
sharing, offline maps, satellite view.

- Web app (GitHub Pages): https://arsalanbaider67-eng.github.io/darbna/
- iPhone: TestFlight (App Store Connect app "Darbna – Iraq Navigation", bundle `iq.darbna.app`)
- Owner: arsalanbaider67-eng. The owner is not a programmer: explain results in plain words.

## Repo layout
| Path | What |
|---|---|
| `packages/core` | Pure TypeScript, no I/O: guidance engine, routing helpers, search merge (`search.ts`), reports, traffic, traffic-light learning (`signals.ts`), SOS region logic (`sos.ts`), shared-link parsing (`share.ts`). **Unit tested with bun.** |
| `packages/core/data` | Bundled data: gazetteer, road hazards from OSM (`road-hazards.json`, refreshed monthly by CI), SOS numbers and region shapes |
| `apps/mobile` | Expo SDK 54 / React Native 0.81 app (iOS, Android, and the web build). `*.web.tsx` files are the web versions (maplibre-gl); others are native (MapLibre RN) |
| `apps/mobile/src/apiDirect.ts` | "Direct mode" (what ships): public/own routing + search services and Supabase RPCs. `api.ts` is the older own-server mode |
| `apps/mobile/src/i18n/{ar,ckb,en}.ts`, `apps/mobile/locales/*.json` | UI strings and iOS permission texts. **All three languages must have the same keys** (a test checks this) |
| `apps/mobile/assets/voice` | Recorded voice prompts (ElevenLabs), `phrases.json` + `scripts/gen-voice.mjs` |
| `supabase/schema.sql` | Database: tables in schema `darbna_private`, only `SECURITY DEFINER` RPCs exposed. The owner runs this file by hand in Supabase after changes |
| `server/` | Optional own API server (not used by the shipped app) |
| `infra/`, `docs/SERVER.md` | Plan for the owner's VPS (routing.darbna.com / search.darbna.com: Valhalla, Nominatim, Caddy) — not live yet |
| `e2e/real-world.mjs` | Playwright test of the web build against real services (GPS, free map gestures, 10 Iraq searches, navigation) |
| `docs/` | `STATUS.md` (old feature matrix), `ARCHITECTURE.md`, `store-listing.md`, `app-review-notes.md`, `search-audit.md`, `signals-count.md`, `EMERGENCY_NUMBERS.md` |

## Commands
- Core tests: `cd packages/core && bun test` (must stay green; ~120 tests).
- There is **no lockfile**; CI uses `npm install` at the root (npm workspaces). `postinstall` runs
  `patch-package` (patches in `patches/`).
- Type check + web build: the **"Check branch"** workflow runs on every push to a non-main branch
  and publishes the web build to the `web-preview-wip` branch.
- End-to-end: run the **"E2E real world"** workflow (tests `web-preview-wip`); results land in the
  `e2e-results` branch and as annotations. Last known: 36/36.

## CI workflows (`.github/workflows`)
| Workflow | Does |
|---|---|
| `web.yml` | Deploys the web app to GitHub Pages on push to main |
| `check.yml` | Branch typecheck + web preview build |
| `e2e.yml` | Playwright real-world test |
| `ios-store.yml` | Signs + uploads an iPhone build to TestFlight (manual). Input `share_extension` (see below) |
| `ios-unsigned.yml` | Unsigned .ipa (also pushed to the `ios-build` branch) |
| `android-store.yml` | Play Store build (not used yet) |
| `voices.yml` | Re-records voice prompts with ElevenLabs |
| `road-hazards.yml` | Monthly OSM speed bumps / cameras / traffic lights |
| `search-audit.yml`, `count-signals.yml` | Search quality audit; traffic-light counts per provider |
| `server-deploy.yml` | Deploys `infra/` to the VPS over SSH (when it exists) |
| `pkg-info.yml`, `fetch-file.yml`, `deps-check.yml` | Helpers (npm package info, vendor a file, print installed versions) |

**Secrets** (names only; values are the owner's — never ask for them in chat, never commit them):
`APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (App Store Connect API key),
`ELEVENLABS_API_KEY`, `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION`, `SERVER_HOST`/`SERVER_USER`/`SERVER_SSH_KEY`,
`ANDROID_UPLOAD_*` (Play signing, not set up yet).
**Variables**: `ESRI_KEY` (licensed satellite + Esri geocoding, required for store builds),
`ESRI_GEOCODE`, `VALHALLA_URL`, `NOMINATIM_URL`, `SUPABASE_URL`, `SUPABASE_KEY` (publishable),
optional `MAPBOX_TOKEN`, `HERE_KEY`.

## Rules the owner cares about
- **Test before claiming something works.** Say exactly what was verified and how (unit test, e2e,
  real device). Never use fake or hardcoded data to make a feature look like it works.
- Arabic is the default language; layouts are RTL. Every user-facing string goes in all three
  i18n files.
- Arabic voice = ElevenLabs voice "Sufyan" (id `9FHjCdVXgA4tYxIYHTcZ`, model eleven_v3, speed 0.91,
  stability/similarity 0.75), **never slowed down or time-stretched**. English = "Daniel".
- Brand: purple `#21194A` panels, yellow `#FFD25E` highlights, white `#FFF5EF` text (`brand/`).
- SOS shows **only 911** (Iraq, Kurdistan Region included). The release gate
  (`scripts/check-emergency-release.mjs`) blocks store builds unless every number is call-tested or
  owner-confirmed. Do not add numbers without the owner.
- Privacy: no accounts, no tracking. Anything new that leaves the phone must be added to
  `apps/mobile/public/privacy.html` (3 languages) and the App Store privacy answers.
- Ask the owner before anything irreversible or anything in his Apple / Google / Supabase accounts.

## Hard-won gotchas (don't re-learn these)
- **iOS builds**: App Store requires the iOS 26 SDK, but Xcode 26.4+ (clang 21) breaks React Native
  0.81's `fmt` pod → `ios-store.yml` picks Xcode 26.0–26.3 **and** patches `fmt/base.h`.
- **Signing**: archive is built unsigned and signed at export with cloud signing (no device
  registered). Consequence: no App Group entitlement → the **share extension**
  (`expo-share-intent`, "Share → Darbna" from Google/Apple Maps) is **off** (`share_extension`
  input false; JS gated by `EXPO_PUBLIC_SHARE_EXTENSION`). To turn it on: register the owner's
  iPhone UDID in the developer account and switch the archive to automatic (development) signing.
- `expo-audio` pulls `expo-asset@*` → root `package.json` `overrides` pins `expo-asset ~12.0.0`
  (otherwise the JS bundle fails with `expo/internal/bundle-origin`).
- Store builds install with `NODE_ENV=production` (no devDependencies): build-time tools must be in
  `dependencies`.
- iOS clips Noto Sans Arabic when `lineHeight` < ~1.6×fontSize: use `<Txt tight={px}>`, never a
  small `lineHeight`.
- MapLibre (web): `Map.jumpTo` cancels an active gesture → the follow loop must not move the camera
  while a finger is on the map.
- iPhones stop sending positions while you stand still → "GPS lost" only after 10 s when moving,
  2 min when stopped; navigation polls a fresh fix after 4 s of silence.
- Public Nominatim/Valhalla/Overpass have strict usage policies; production should use the owner's
  VPS (`docs/SERVER.md`). Nominatim max 1 request/s.

## Open work (as of 2026-10-16)

### Isolated redesign preview

Voice/search follow-up: see `docs/VOICE-SEARCH.md`. Arabic recorded guidance must never silently
fall back to a different device voice; failures show a notice and retain on-screen instructions.
`assets/voice/iraqi-review.json` is candidate wording, NOT an installed recording pack. The owner
specifically requested correcting «لوف» to «لِف» and keeping «فلكة» with corrected pronunciation.
The new manual Iraqi voice-review workflow generates isolated candidates using the existing
secret; it does not commit or promote them. Native Iraqi listening approval is still required.
Public Nominatim is submission-only, with serialized request starts and a brief cache. Do not
restore public autocomplete or proximity-only deduplication; different shops can share a building.

The `codex/darbna-preview` branch prepares a separate trial of the clean purple/yellow design.
See `docs/PREVIEW.md` for scope, verification, limits and build instructions. Set
`DARBNA_VARIANT=preview` for `iq.darbna.app.preview` and the `darbna-preview` URL scheme;
production remains `iq.darbna.app`. The preview has separate local settings/saved-place keys.
The manual `Build isolated Darbna preview` workflow produces a web artifact without publishing.
`iOS store build` now accepts `variant=preview`; a separate Apple app record and signing setup
are required before that variant can reach TestFlight. Sharing is still gated as documented above.
Never claim a web export or iOS JavaScript export is a signed/tested iPhone build.

1. Share extension (needs iPhone UDID, see above).
2. VPS for routing/search (`docs/SERVER.md`) before App Store submission.
3. Owner must re-run `supabase/schema.sql` (traffic-light learning tables).
4. App Store listing, screenshots, age rating; then "Submit for Review" (owner presses it).
5. `docs/STATUS.md` is outdated (pre-TestFlight) — refresh it.
