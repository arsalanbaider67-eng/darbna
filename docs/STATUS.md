# Darbna — what works, what's demo, what's missing

Status as of this build (0.1.0). This is **not production-ready**: the Android release APK
compiles (Expo SDK 54, built on Windows with `build-android.bat`), but it has not yet been run
on a real phone or against real Iraqi road data. Read this before you demo it to anyone.

## How it was verified

| Area | How | Result |
|---|---|---|
| Guidance engine (`packages/core`) | 47 unit tests incl. simulated drives with seeded GPS noise (8–30 m), multipath spikes, highway speed, missed turn, wrong-way, GPS loss, arrival | pass |
| Search normalization | Arabic spelling variants, Sorani letters, Eastern digits, 11 transliteration groups | pass |
| Shared-location parsing | geo:, Google Maps long links, OSM links, darbna://, "lat, lng" incl. Arabic digits | pass |
| API server | 34 end-to-end tests against **real PostgreSQL 16**, with fake Valhalla/Nominatim upstreams that return the real response formats | pass |
| Server entrypoint | migrate → seed → boot → health/config/search/reports/route (upstream down → 503) | pass |
| Localization | Key/placeholder parity across ar/ckb/en; no untranslated English in Arabic-script locales; instruction phrasing | pass (8 tests) |
| Mobile app | Android release build (`build-android.bat`): native compile + JS bundle | **compiles** (Darbna.apk, debug-signed); not yet run on a device |

## Feature matrix

✅ implemented and tested · 🟡 implemented, not yet run on a device · 🧪 demonstration only · ⛔ not implemented

### Core journey
| Feature | State | Notes |
|---|---|---|
| Map-first home screen with search field | 🟡 | MapLibre, style URLs come from the server |
| Current location, recenter, permission states (ask / denied / blocked / services off) | 🟡 | |
| Search: gazetteer + Nominatim, spelling-tolerant | ✅ server · 🟡 UI | |
| Destination by search, dropped pin (long-press + reverse geocode), shared location (paste, `geo:` intent on Android, `darbna://`) | 🟡 | `maps.app.goo.gl` short links can't be resolved offline — the app says so |
| Route preview: distance, ETA, arrival clock, alternatives | ✅ server · 🟡 UI | ETA is labeled "no live traffic" everywhere |
| Start / pause / resume / exit with confirmation; arrival flow | 🟡 | |
| Spoken prompts (far/near/now, "then…"), maneuver banner | ✅ engine · 🟡 TTS | Sorani TTS voices are rare; falls back to Arabic and says so in Settings |
| Automatic rerouting with heading, cooldown, offline retry | ✅ engine · 🟡 app | |
| Saved home / work / favorites, recents (device only) | 🟡 | |
| Day / night / auto themes (UI + map style) | 🟡 | |

### Community reports
| Feature | State |
|---|---|
| Six categories with location, timestamp, expiry | ✅ |
| Confirm / "not there" / flag; one vote per install; no self-votes; vote switching | ✅ |
| Duplicate detection (per-category radius → becomes a confirmation) | ✅ |
| Rate limits (3/10 min, 10/h reports; 60/h votes; per-IP burst limit) | ✅ |
| Auto-hide on "gone" votes or 3 flags; moderator restore/remove API; moderation log | ✅ (API only — ⛔ no moderator web UI) |
| Freshness + confidence shown; official vs community distinguished | ✅ server · 🟡 UI |
| Routing policy: only **verified official** closures/flooding are avoided automatically; community ones are offered as "Avoid" | ✅ |
| Reporting only when stopped (or "I'm a passenger") | 🟡 |
| Offline report queue, dropped after 15 min | 🟡 |

### Connectivity
| Capability | State |
|---|---|
| Guidance continues on the loaded route with no connection | ✅ engine (pure, on-device) · 🟡 app |
| Active trip survives app restart (resume prompt, 6 h) | 🟡 |
| Connection banner, offline search over saved/recent places | 🟡 |
| Web app opens with no internet (service worker caches the app) | ✅ verified in browser e2e (app reopened offline) |
| Map areas viewed stay available offline (web: service worker; phone: MapLibre ambient cache) | ✅ web e2e · 🟡 phone |
| "Download area on screen" (web: tiles z6–14 + Arabic/Latin glyphs + sprites into Cache Storage; phone: MapLibre offline pack) | ✅ web e2e · 🟡 phone (not yet tested on a device) |
| Offline route calculation | ⛔ needs an on-device routing engine + road graph |
| Live traffic — crowdsourced from Darbna drivers (direct mode + Supabase): anonymous speed samples every ~200 m while navigating, never first/last 300 m, median of per-trip ratios over 15 min, routes re-timed and re-sorted, slow stretches coloured, jam dots on the map | ✅ two-browser e2e · coverage only where Darbna users drive |
| Commercial live traffic | ⛔ TomTom does not cover Iraq; Google traffic can't be used in another navigation app |

Shared reports and traffic in the web/sideload builds live in Supabase (`supabase/schema.sql`):
private schema, only API functions exposed, hashed install/trip ids, hashed IPs erased after a day,
rate limits per install, per IP and overall. Moderation: Table Editor → `darbna_private.reports`.

### Not implemented (deliberately listed)
- **Background navigation** (guidance with the screen locked / another app in front). Today the
  screen is kept awake during guidance instead. Needs `expo-task-manager` background location,
  an Android foreground service, iOS `UIBackgroundModes: location, audio`, and store-review text.
- Lane guidance, speed limits, speed-camera warnings.
- Android share-sheet *receiving* plain text (only `geo:` VIEW intents), iOS share extension.
- Device attestation (Play Integrity / App Attest) against scripted report spam.
- Moderator dashboard UI; official-source ingestion (ministry/traffic-police feeds).
- CarPlay / Android Auto; accounts/sync (intentionally absent).

### Demonstration data (visibly labeled)
- `server/seed/gazetteer.seed.json` — 46 cities, neighborhoods, landmarks. Coordinates are
  **approximate**, stored as `quality='seed_unverified'`, shown with "موقع تقريبي — قيد التحقق".
- `bun src/seed.ts demo` — 5 sample reports around Tahrir Square, `is_sample=true`, hidden
  unless `SAMPLE_DATA=on`; the app shows a "بيانات تجريبية" badge while sample data is enabled.

## Before calling it production-ready

**Real-device testing** (at least: a 2018-era Android 8 phone with 2 GB RAM, a current Android, an iPhone):
- RTL layout in Arabic and Sorani on every screen; switching to English and back (app reload).
- Arabic and Sorani **map label shaping** (ڕ ڵ ێ ۆ ە) with the chosen glyph fonts.
- Denied / "only once" / later-revoked location permission; location services off.
- GPS in central Baghdad (high-rise multipath), under/over the Tigris bridges, tunnels, and
  intercity highways at 100+ km/h; screen-on battery drain over a 1-hour drive.
- Weak connectivity: 2G/EDGE fallback, captive portals, airplane mode mid-trip, reroute retry.
- TTS: available Arabic voices on common Iraqi-market phones; prompt timing at speed.

**Local road validation**: run `infra/coverage-audit.sh` and `server/scripts/journey-check.ts`,
then have drivers in Baghdad, Basra, Mosul, Erbil, Sulaymaniyah and Najaf/Karbala compare
routes with reality (one-ways, U-turn rules, closed gates, checkpoints, seasonal pilgrimage
closures). Fix data upstream in OSM where appropriate.

**Provider contracts/ops**: hosting region and latency to Iraqi networks, tile bandwidth
budget, weekly OSM refresh pipeline, backups, monitoring/alerting, on-call for moderation,
a privacy policy reviewed against Iraqi and KRG requirements, trademark check on the name.

**Native review** of all Arabic (Iraqi) and Sorani strings — see `docs/LOCALIZATION.md`.
