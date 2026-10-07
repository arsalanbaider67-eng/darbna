# Darbna (دربنا) — Architecture & Implementation Plan

> Working name. "Darbna" = "our road" in Iraqi Arabic. A trademark/app-store name search
> in Iraq and the KRI is required before launch.

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| Mobile | **React Native (Expo, TypeScript)** | One codebase for Android + iOS, mature RTL support (`I18nManager`), small team velocity, OTA fixes. Runs on Android 7+ (API 24). |
| Map rendering | **MapLibre Native** (`@maplibre/maplibre-react-native`) | Open-source vector renderer, no vendor lock-in, any tile provider, renders Arabic labels (Sorani shaping must be verified on devices), offline-pack API available for later. |
| Tiles | **OpenStreetMap-derived vector tiles** (self-hosted Protomaps `.pmtiles` extract for Iraq, or MapTiler as a paid fallback) | OSM has the densest open road coverage in Iraq, with many `name:ar`, `name:ckb`, `name:en` tags. Style URL is server-configured, so the provider is swappable. |
| Routing | **Valhalla** (self-hosted, built from Geofabrik `iraq-latest.osm.pbf`) | Real road-graph routing, alternates, polygon exclusions (used for *verified* closures), maneuver lists. MIT licensed. OSRM is a drop-in alternative behind the same `RoutingProvider` interface. |
| Search | **Local gazetteer + Nominatim** (self-hosted on the same Iraq extract) | Gazetteer handles curated Iraqi aliases/spelling variants; Nominatim covers streets and POIs. Both behind `GeocodingProvider`. |
| Backend | **Bun + PostgreSQL 16 (earthdistance, pg_trgm)** — zero runtime npm dependencies | Bun's built-in HTTP server and Postgres client keep the supply chain tiny. `earthdistance` handles report dedupe radii and bbox queries without PostGIS; `pg_trgm` drives fuzzy search. |
| Shared logic | **`packages/core`** (pure TypeScript, zero deps) | Route snapping, off-route/missed-turn detection, arrival, announcement scheduling, Arabic/translit normalization, report confidence — identical on client and server and unit-tested. |

## Data flow

```
App ──HTTPS──> Darbna API ──> Valhalla   (routing; no traffic data)
                         ├──> Nominatim  (geocoding)
                         └──> PostgreSQL (reports, gazetteer, votes)
App ──HTTPS──> Tile server (style + vector tiles, cached on device)
```

The app never talks to Valhalla/Nominatim directly: provider URLs and any keys stay
server-side, and the server is the single place to swap providers.

Guidance runs **on the device** from the downloaded route (geometry + maneuvers). The
network is only needed to fetch a route, reroute, search, and sync reports — which is
what lets an active trip survive a signal drop.

## Privacy model

- No account. The app creates a random install ID; the server stores only
  `HMAC(install_id, server_secret)` for rate limiting and one-vote-per-report.
- Routing/search requests are proxied without logging coordinates (logger redaction).
  No trip traces are ever stored.
- Reports store a road location + category + time; not who made them in any
  linkable form, and the reporter hash is nulled after expiry.
- Saved places/history live only on the device. Settings → "Delete my data" wipes
  local data and calls `DELETE /v1/me`, which erases the hash's votes and links.

## Stages (each runnable)

1. **Core journey**: map → locate → search → preview (alternatives) → guide (voice) → reroute → arrive.
2. Community reports (create/confirm/"gone", dedupe, expiry, rate limits, moderation).
3. Saved places (home/work/favorites), dropped pin, shared-location deep links.
4. Localization: Iraqi Arabic (default, RTL), Kurdish Sorani, English.
5. Connectivity: status banner, cached last route, offline-tolerant guidance, retry queue.

See `STATUS.md` for what is working vs. demonstration vs. needing infrastructure.
