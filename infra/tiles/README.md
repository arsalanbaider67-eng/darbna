# Map tiles for Iraq

1. **Extract Iraq** from a Protomaps daily planet build (OSM data, ODbL):

   ```sh
   # https://docs.protomaps.com/pmtiles/cli  — builds are listed at https://maps.protomaps.com/builds/
   pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles data/iraq.pmtiles \
     --bbox=38.7,29.0,48.9,37.5 --maxzoom=15
   ```
   Expect roughly 300–600 MB. Refresh monthly.

2. **Fonts & sprites**: copy `fonts/` and `sprites/` from
   https://github.com/protomaps/basemaps-assets into `data/` so the app never depends on a
   third-party host at runtime.

3. **Styles**: `npm i @protomaps/basemaps@5 && node build-style.mjs https://tiles.example.iq`
   writes `data/styles/darbna-{day,night}.json`.

4. `docker compose up tiles` serves TileJSON at `/iraq.json` and tiles at `/iraq/{z}/{x}/{y}.mvt`.

## Things to verify on real devices

- **Arabic and Sorani label shaping** in MapLibre Native. Arabic letters are shaped by the
  renderer; Sorani-specific letters (ڕ ڵ ێ ۆ ە) must be checked on Android and iOS with
  the chosen font stack — if any render unjoined, switch the label font to one that covers
  Arabic Extended (e.g. Noto Sans Arabic glyph PBFs built with `font-maker`).
- Label density at zoom 13–16 in Baghdad, Basra and Erbil.

## Alternative: hosted tiles

MapTiler / Stadia / others serve OSM-based vector tiles with Arabic labels. Use a key
restricted to the app's bundle IDs, check their terms for navigation use, and budget per
map-load pricing (see `docs/PROVIDERS.md`).
