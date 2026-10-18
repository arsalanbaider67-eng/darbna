# Darbna — guide for AI coding agents (and new developers)

Read this first. It is the single handoff document for anyone (Claude, Codex, Cursor, Copilot,
Gemini, a human) working on this repo. Keep it up to date when you change how things work.

## What Darbna is
A free turn-by-turn navigation app for **Iraq** (دربنا, "our road"). Arabic first (Standard Arabic voice guidance),
Sorani Kurdish (ckb) and English. Recorded Standard Arabic voice guidance, driver road reports (checkpoint
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
| `infra/`, `docs/SERVER.md` | Owner's live VPS (routing.darbna.com / search.darbna.com: Valhalla, Nominatim, Caddy); verify app build endpoints separately |
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
- Arabic voice: owner approved Standard Arabic Hamid recordings on 17 October 2026 (voice `A9ATTqUUQ6GHu0coCz8t`, eleven_v3, generation/playback speed 1.0, stability/similarity 0.75). This supersedes the earlier Iraqi/Sufyan instruction. Never time-stretch. English remains Daniel. Do not silently substitute a device voice for Arabic.
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
0. The owner authorized a navigation-and-points release on 17 October 2026, including a new
   signed TestFlight build, on `codex/navigation-points-release`. Prize screens and contact
   collection are excluded from this build. Points are recognition only, without redeemable
   value: +2 once for an independently confirmed report and +2 for an independent confirmation.
   Five distinct owner-confirmed fake/abusive reports cause a reporting ban; raw flags do not.
   The Supabase scoring/moderation migrations are installed and rollback-tested.
   Future prizes remain disabled, with no offers, on the separate `codex/report-rewards` preview.
   Do not enable prizes through a remote switch after review; they require defined funded
   offers, published rules, privacy updates and a new reviewed app version.
1. Share extension (needs iPhone UDID, see above).
2. VPS routing/search deployed and API-tested on 18 October 2026. Production endpoint rebuilds and actual iPhone acceptance remain required before App Store submission. See `docs/SERVER.md`.
3. Owner must re-run `supabase/schema.sql` (traffic-light learning tables).
4. App Store listing, screenshots, age rating; then "Submit for Review" (owner presses it).
5. `docs/STATUS.md` is outdated (pre-TestFlight) — refresh it.

## Prizes, report confirmation, support (2026-10-18)
- **Prizes**: `supabase/prizes.sql` (apply after the other SQL files; tests in `prizes.test.sql`). One prize per 10 levels
  (level 10, 20 …; 50 points per level, so a prize every 500 points) from the same points the app shows; the app shows only "you won a prize — contact support" with a claim
  code (`DRB-XXXX-XXXX`), never the prize. Owner checks/delivers in SQL (`darbna_private.set_prize_status`). This replaces
  the earlier draw/odds preview in `rewards.sql` for what ships (that one stays disabled).
- **Reports**: unconfirmed driver reports are faded + "waiting for another driver" and do **not** warn on the road; they warn
  once confirmed (same report by another driver, or "still there"). +2 to everyone involved (report-integrity.sql).
- **Support**: `apps/mobile/src/support.ts` — email darbnaiq@gmail.com; phone/WhatsApp from GitHub variables
  `SUPPORT_PHONE` / `SUPPORT_WHATSAPP` (international format). Web pages open via `openPage()` (in-app browser with Done).
- **Routing**: own Valhalla (routing.darbna.com) is Iraq-only; trips touching outside Iraq go to the public OSM Valhalla.
