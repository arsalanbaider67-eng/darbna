# Deployment

## 1. Server stack (one machine to start)

```sh
cp .env.example .env            # fill every CHANGE_ME and empty secret
# build infra/tiles/data/iraq.pmtiles + styles first — see infra/tiles/README.md
cd infra && docker compose --env-file ../.env up -d
docker compose logs -f valhalla nominatim   # first build: Valhalla ~tens of minutes, Nominatim a few hours
```

Edit `infra/Caddyfile` with your domains; Caddy obtains TLS certificates automatically.
The API runs migrations on start (`MIGRATE_ON_START=true`). Load the gazetteer once:

```sh
docker compose exec api bun src/seed.ts gazetteer
```

Never run `seed.ts demo` in production, and keep `SAMPLE_DATA=off`.

**Health:** `GET /healthz`. **Logs:** JSON lines with method, path (IDs masked), status and
latency only — no query strings or bodies, which contain coordinates. The Caddy log filter
drops URIs for the same reason.

**Data refresh:** rebuild Valhalla tiles weekly (`force_rebuild=True` for one run), let
Nominatim apply Geofabrik diffs, re-extract `.pmtiles` monthly.

**Backups:** only the `darbna` Postgres database holds state worth backing up (reports,
gazetteer, moderation log). Everything else rebuilds from OSM.

## 2. Moderation

```sh
# hidden queue
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://api.example.iq/v1/admin/reports?status=hidden
# restore / remove
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Moderator: noor" \
  -d '{"action":"remove","note":"spam"}' https://api.example.iq/v1/admin/reports/<id>/moderate
# verified official closure (always avoided by routing)
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"category":"closure","coord":[44.40,33.33],"expiresAt":"2026-10-08T06:00:00Z","officialRef":"Baghdad Traffic Directorate post, 7 Oct"}' \
  https://api.example.iq/v1/admin/official-reports
```

## 3. Mobile app

Expo Go cannot load MapLibre's native code, so use a development build or EAS.

```sh
cd apps/mobile
npx expo install --fix                 # align native module versions with the installed Expo SDK
EXPO_PUBLIC_API_URL=https://api.example.iq npx expo run:android   # or run:ios
# store builds
npx eas build -p android --profile production
npx eas build -p ios --profile production
```

Store listings must explain location use (foreground only in this version) and link a
privacy policy. Set `bundleIdentifier`/`package` in `app.config.ts` to your own.
