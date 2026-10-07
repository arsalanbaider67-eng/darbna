# دربنا · Darbna

Turn-by-turn navigation and community road reports for Iraq. Arabic-first (RTL), with
Kurdish Sorani and English; built on OpenStreetMap data and self-hostable open-source
routing and search.

> **Status: pre-release.** The server and navigation core are tested; the mobile app has not
> yet been compiled or run on a device. See [`docs/STATUS.md`](docs/STATUS.md) before demoing.

```
apps/mobile      React Native (Expo) app — Android & iOS
server           API: routing/search proxy, reports, moderation (Bun + PostgreSQL)
packages/core    Pure-TS navigation engine, search normalization, report rules (shared)
infra            docker-compose: Postgres, Valhalla, Nominatim, tiles, Caddy (TLS)
docs             ARCHITECTURE · STATUS · PROVIDERS · DEPLOYMENT · LOCALIZATION
```

## Local development

**Prerequisites:** Bun ≥ 1.2, Node 20 + npm, PostgreSQL 14+ (with contrib) or Docker,
Android Studio and/or Xcode.

```sh
npm install                                     # workspaces: core, server, mobile

# --- backend
createdb darbna
export DATABASE_URL=postgres://localhost/darbna
cd server
bun src/migrate.ts
bun src/seed.ts gazetteer                       # approximate seed places, labeled as such
bun src/seed.ts demo                            # optional SAMPLE reports (shown only with SAMPLE_DATA=on)
ROUTING_URL=http://localhost:8002 GEOCODER_URL=http://localhost:8088 bun src/main.ts
```

Routing, search and tiles need the upstream services. Start them from `infra/`
(`docker compose up valhalla nominatim tiles` — the first build takes a while; see
`docs/DEPLOYMENT.md`) or point the URLs at providers you have contracts with
(`docs/PROVIDERS.md`). Without them the API still serves search over the gazetteer and
reports, and returns `503 unavailable` for routes — the app shows that state.

```sh
# --- app (Expo Go won't work: MapLibre is native code)
cd apps/mobile
npx expo install --fix
EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:8080 npx expo run:android
```

## Tests

```sh
cd packages/core && bun test        # guidance engine, GPS-noise drive simulations, normalization, reports
cd apps/mobile && bun test          # locale parity, instruction phrasing
TEST_DATABASE_URL=postgres://localhost/darbna_test bun test   # in server/: end-to-end API (wipes that DB)
ROUTING_URL=http://localhost:8002 bun server/scripts/journey-check.ts   # real routes across 10 Iraqi trips
```

## Configuration

All settings are environment variables — see [`.env.example`](.env.example). Secrets stay on
the server; the app only receives the API URL at build time and style URLs at runtime.

## Privacy, in one paragraph

No accounts. The app generates a random install ID; the server stores only an HMAC of it
to rate-limit reports and enforce one vote per report, and erases that link when a report
expires. Trip paths are never sent for storage — the server proxies route requests without
logging coordinates. "Delete my data" in Settings wipes the device and unlinks everything
server-side.

Map data © OpenStreetMap contributors (ODbL).
