# SOS emergency numbers

The SOS screen shows the emergency numbers for where the user is:

| Where | Shown | Decided by |
|---|---|---|
| Kurdistan Region of Iraq (Erbil, Duhok, Sulaymaniyah, Halabja governorates) | Police **104** · Ambulance **122** · Civil defence / fire **115** | GPS inside the official IQ-KR boundary |
| Elsewhere in Iraq (incl. disputed areas such as Kirkuk, Makhmour, Sinjar, Khanaqin) | **911** (primary) | GPS inside Iraq, outside IQ-KR |
| Turkey | **112** | GPS inside Turkey |
| Any other country | No number. "Local number not confirmed" + advice | Never assumes 911 |

Calling is always one tap that opens the phone's dialer with the number filled in (`tel:`); the app never dials by
itself. SOS needs no account, points or level, and works offline and before the map has loaded.

## Sources (checked 11 Oct 2026)

| Region | Number | Source | Official? |
|---|---|---|---|
| Iraq | 911 | [INA: Ministry of Interior 911 center, 24/7, free, earlier hotlines merged into 911 (12 Jan 2025)](https://ina.iq/en/local/37665-interior-ministry-911-receives-calls-in-5-languages.html) | Yes (state news agency, MoI announcement) |
| Iraq | 911 | [INA: MoI 911 for visitors via roaming (22 Jul 2026)](https://ina.iq/en/local/50621-moi-instant-translation-in-six-languages-for-communication-with-visitors-via-911.html) | Yes |
| Iraq | 911 | [U.S. Embassy Baghdad: "The emergency number in Iraq is 911."](https://x.com/USEmbBaghdad/status/2029241725500154291) | Yes (foreign government) |
| Kurdistan Region | 122 ambulance | [KRG Dept. of Media & Information: Erbil's emergency line 122](https://gov.krd/dmi-en/activities/news-and-press-releases/2023/january/erbil-s-emergency-line-122-fast-and-free-help-to-all/) | Yes, **Erbil only** |
| Kurdistan Region | 104 police, 122 ambulance, 115 civil defence | [Help.KRD — Emergency & Useful Numbers in Kurdistan Region](https://help.krd/?id=6&lang=en) (cites erbil.gov.krd; "call last verified 2026-06-20") | **No** — a directory site, not the KRG |
| Turkey | 112 | [T.C. İçişleri Bakanlığı — 112 Acil Çağrı Merkezi: "Tek Numara 112"](https://www.112.gov.tr/) | Yes |

**Gaps to close before release**
- Kurdistan Region: no official KRG page was found that lists 104 / 115 for the whole region; 122 is official for
  Erbil. Confirm all three for Sulaymaniyah, Duhok and Halabja (e.g. with the governorates' police and health
  directorates) and add the official pages as sources.
- Whether 911 also reaches services inside the Kurdistan Region isn't documented; the app shows the KRG numbers there.
- Other neighbours (Iran, Syria, Jordan, Saudi Arabia, Kuwait): their official sites blocked automated checks, so
  they aren't in the config yet and the app says the number couldn't be confirmed.

## Verify before release (call test)

Store builds (`ios-store.yml`, `android-store.yml`) run `scripts/check-emergency-release.mjs` first and **stop**
if any number has no recorded call test. For each number, someone in that area confirms it reaches the right
service — ideally by asking the operator, or with written confirmation from the service; don't make test calls
that tie up an emergency line, and if you do call, say at once that it's a test. Then record it:

```json
"callTested": { "date": "2026-10-20", "area": "Erbil city, Asiacell + Korek SIMs", "by": "Your name" }
```

## Updating numbers (no app update needed)

1. Edit `packages/core/data/emergency-numbers.json`: change the contact, add sources (https links), set
   `lastVerified` to today, and **increase `version`**.
2. Run the tests (`bun test` in `packages/core`): the config is validated there.
3. Push to `main`. The web build publishes the file as `/darbna/emergency-numbers.json`; installed apps download it
   when online and use it only if it's valid and newer than their built-in copy. The last good copy stays on the
   phone for offline use.
4. Numbers older than `staleAfterDays` (180) are shown as "may be outdated".

## Boundaries

`packages/core/data/sos-regions.json`, built by `scripts/build_sos_regions.py` from:
- **IQ-KR**: OpenStreetMap relation 5392650 (admin_level 3, ISO 3166-2 IQ-KR) — © OpenStreetMap contributors, ODbL.
- **IQ**: union of OpenStreetMap's 18 Iraqi governorate relations (admin_level 4) — ODbL.
- **TUR**: geoBoundaries gbOpen TUR ADM0 (simplified, 300 m).
Simplification tolerance for Iraq / Kurdistan Region is 20 m. Reference data is fetched by
`.github/workflows/fetch-sources.yml` into the `data-sources` branch.

## No rapid switching

`RegionTracker` (packages/core/src/sos.ts) only changes region on fixes that are accurate (≤ 150 m) and at least
750 m + the fix's accuracy away from the boundary, seen twice at least 15 s apart. Weak GPS or being near the
boundary keeps the last confirmed region (shown as such). If nothing has been confirmed yet near the boundary,
both sets are shown, clearly labelled. The last confirmed region is saved for offline use and shown as possibly
outdated after 15 minutes without confirmation. With location denied or unknown, the user chooses their region;
a manual choice holds until location confirms a region again.
