# Map, search and routing providers

Every external dependency sits behind an interface (`RoutingProvider`, `GeocodingProvider`,
style URLs in `/v1/config`), so swapping one is a config change plus, at most, one adapter file.

## Default: self-hosted, OpenStreetMap-based

| Component | Software (license) | Data | Attribution required |
|---|---|---|---|
| Routing | Valhalla (MIT) | OSM Iraq extract via Geofabrik (ODbL) | "© OpenStreetMap contributors" |
| Geocoding | Nominatim (GPL-2.0; running it as a service is fine) | same extract | same |
| Vector tiles | go-pmtiles (BSD-3), Protomaps basemap layers (BSD-3) | OSM (ODbL) | same, visible on the map |
| Rendering | MapLibre Native (BSD-2) | — | — |
| Font | Noto Sans Arabic (SIL OFL) | — | — |

**ODbL notes.** Showing the map, routes and search results is a "Produced Work": attribution
is required (the app shows it on the map and in Settings). If you build and publicly use an
improved *database* derived from OSM (e.g. corrected street names), share-alike applies to
that derived database. The community-reports database is independent data and is not derived
from OSM. Have counsel confirm before launch.

**Why OSM for Iraq.** OSM is the only openly licensed source with nationwide road
geometry and many Arabic, Kurdish and English names. Coverage quality varies: major roads
and city centers are generally mapped; newer residential areas, one-way tagging, turn
restrictions and street names are uneven. *This could not be measured from the build
environment* — run `infra/coverage-audit.sh` and `server/scripts/journey-check.ts` and
review the numbers before committing.

### Usage limits
Self-hosted components have no per-request limits beyond your hardware. Do **not** point
production at public demo servers: `nominatim.openstreetmap.org` (max 1 req/s, no
autocomplete use), the FOSSGIS Valhalla/OSRM demos, and `tile.openstreetmap.org` all forbid
or heavily restrict app traffic.

### Rough operating cost (planning estimates — verify with your host)
| Item | Sizing for the Iraq extract | Notes |
|---|---|---|
| Valhalla | 2–4 vCPU, 4–8 GB RAM, ~5 GB disk | Graph rebuild weekly, ~tens of minutes |
| Nominatim | 4 vCPU, 8–16 GB RAM, 30–60 GB SSD | First import a few hours; daily diffs |
| Tiles + API + Postgres | 2 vCPU, 4 GB RAM, ~5 GB | |
| Bandwidth | Vector tiles dominate: plan tens of MB per active user per month | Cache headers + CDN in front of `tiles.` |

A single dedicated server (8 vCPU / 32 GB / NVMe) runs everything for a pilot; split
Nominatim and Valhalla onto their own machines and add a CDN as usage grows. Host close to
Iraqi networks (Gulf or Turkey/European regions are typical) and measure latency from
Asiacell, Zain IQ and Korek before choosing.

## Hosted alternatives (need contracts and keys)

| Need | Options | What to check |
|---|---|---|
| Tiles | MapTiler, Stadia Maps, others serving OSM vector tiles | Terms for turn-by-turn apps, per-load pricing, Arabic labels, key restriction by bundle ID |
| Routing / search | HERE, TomTom, Google Maps Platform, Mapbox | Iraq coverage and traffic availability, whether results may be shown on a non-provider map, caching limits, per-request pricing |

Commercial providers may offer traffic data for Iraq; if one is added, set
`durationSource` accordingly and flip `liveTraffic` only when the data is actually used.

## Credentials

| Secret | Where it lives | Never |
|---|---|---|
| `INSTALL_HASH_SECRET`, `ADMIN_TOKEN`, DB passwords, any routing/geocoding keys | server `.env` only | in the app bundle or git |
| Tile key (if hosted tiles) | inside the style URL the server hands out | unrestricted; restrict by app bundle ID / referrer |
| `EXPO_PUBLIC_API_URL` | app build env | — it's public by design |
