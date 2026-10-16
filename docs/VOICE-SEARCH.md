# Current direction — 2026-10-17

The owner has requested normal Arabic instead of Iraqi dialect: all 75 spoken
navigation prompts now have a Modern Standard Arabic script. The Record voices
workflow on the preview branch records the full isolated pack with Hamid, a male
Arabic news voice listed by ElevenLabs, at generation speed 1.0 and playback rate
1.0. No time stretching is used. `standard-arabic-review.json` has exact key parity
with the current pack. All 75 recordings were generated in Actions run 38981929042 and installed together
in the preview. All 75 decoded in the browser at playback rate 1.0 without audio
errors; the mobile tests (19), TypeScript check, and web export passed. Never combine
new and Iraqi clips. Listening review remains subjective and is available to the owner. The existing TestFlight app is separate.

The older Iraqi review notes below are historical and superseded by this request.

# Iraqi pronunciation and search correction — 16 October 2026

## Owner's request

The owner wants an authentic Iraqi male guidance voice without dialect mistakes. He specifically
identified «لوف» and «فلكة», then clarified that «فلكة» should remain and its pronunciation should
be corrected. Proposed recording spellings are «لِف يمين / لِف يسار» and «فَلْكَة».

No replacement audio has been synthesized, listened to, or approved in this session. Do not
describe the existing recordings as newly corrected. The active `phrases.json`, audio files and
voice manifest remain unchanged. The draft in `iraqi-review.json` is separate, with an explicit
needs-recording-and-native-listening status. It also replaces formal phrasing in several prompts
and writes out the larger numbers. These are candidates, not a declaration of flawless dialect.

## Runtime voice change

Previously, a failed or unavailable recorded prompt could silently switch to whatever Arabic
voice the device/browser provided, including a different accent or gender. Arabic guidance now
uses the recorded pack only. Playback failure returns a status; the app displays a once-per-trip
notice that on-screen guidance continues. English retains its existing system-voice fallback.
Sorani retains the established recorded-Arabic fallback, without an arbitrary device accent.
This prevents a voice switch; it does not repair pronunciation already present inside an MP3.

Sufyan's voice ID, Eleven v3 model, generation speed 0.91 and other existing settings remain
unchanged. No playback-rate, pitch or time-stretch alteration was made to any recording.

## Record and approve the corrections

1. Publish this branch after authenticated GitHub access is available.
2. Run `Iraqi voice pronunciation review` on this branch. It uses the existing
   `ELEVENLABS_API_KEY` repository secret. Default: eight samples targeting turns/roundabouts;
   `full_pack=true` generates the complete Arabic candidate pack. This consumes provider credits.
3. Download the listening-review artifact. It contains current audio, available candidate audio,
   and the proposed wording. The recordings stay isolated; the workflow cannot commit to main.
4. Have the owner/native Iraqi listener verify every pronunciation, a consistently male speaker,
   natural cadence, roundabout exits and joined distance/turn prompts. Regenerate rejected takes.
5. Only after approval, promote the approved audio with a manifest matching its exact wording,
   rerun tests and perform an iPhone audio check. Do not ship mixed old/new text or an unreviewed pack.

`gen-voice.mjs` accepts `VOICE_PHRASES_FILE`, `VOICE_REVIEW_DIR` and review-only `VOICE_KEYS`.
Candidate config cannot be used to overwrite the active pack. The Arabic candidate specifies
`language_code=ar` and disables automatic text normalization to preserve supplied word spellings;
neither parameter guarantees an Iraqi accent. Provider docs:
https://elevenlabs.io/docs/api-reference/text-to-speech/convert

`node apps/mobile/scripts/gen-voice-review.mjs` produces the local preview's listening page at
`/voice-review/`. Until synthesis runs, it explicitly labels the audio as the old recordings and
the proposed text as not yet recorded. Do not confuse this page with a newly generated voice pack.

## Why search missed places

- Core search merged any results within 60 m, even different businesses in the same building.
- Direct mode removed provider results within 300 m of any approximate built-in place, even when
  the names differed. A real pharmacy near a seeded mall could therefore disappear.
- Nominatim was silently skipped if a request had started recently; a full search could lose its
  only online provider and show partial/local results or misleadingly report offline.
- The app could launch public Nominatim requests while typing, contrary to the service's policy.
- The local preview has no Esri credential. It cannot reproduce the store build's broader provider
  configuration. The shipped app's actual enabled provider privileges have not been inspected.
- Providers have different place inventories and spellings. Removing these bugs does not create
  missing businesses or guarantee every place in Iraq is indexed.

## Search changes

- Deduplication now uses feature identity or a nearby matching normalized name. Different nearby
  shops remain visible. Same-named branches farther apart also remain separate.
- Provider results replace approximate seeds for the same named place, rather than disappearing.
- Each configured provider can return up to 20 results; the app merges up to 20 results.
- Full searches wait for their request slot. Successful queries are briefly cached and in-flight
  duplicates are shared; failures and partial coverage are retryable.
- The visible `Search all Iraq` action submits the full query. Typing uses local suggestions and
  configured providers that support autocomplete. It does not use public Nominatim autocomplete.
- Empty Arabic queries can retry a common spelling variant on explicit search; requests still
  pass through the public-service gate. A changed/cleared query invalidates older responses.
- The UI suggests adding a city name to disambiguate missing or similarly named places.

Public Nominatim permits at most one request/second across the entire application, prohibits
autocomplete and requires caching/identification. The local queue is per installation, not an
application-wide production limit. Before growing usage, use the planned dedicated service or
a licensed search service; do not treat the public endpoint as unlimited production capacity.
https://operations.osmfoundation.org/policies/nominatim/

Esri supports Iraq in Arabic and English, but coverage is not a complete list of all businesses:
https://doc.arcgis.com/en/arcgis-online/reference/geocode-coverage.htm

## Verification

- 150 automated tests passed (131 core, 19 mobile), including adjacent/co-located businesses,
  seed replacement, separate branches, partial-provider failure, Arabic spelling retry, request
  serialization/caching, and Arabic voice failure without an arbitrary system fallback.
- Full app TypeScript check passed; web export and iOS JavaScript export without bytecode passed.
- A small live Nominatim check found Erbil airport (2 results), Family Mall Erbil (1 result),
  and Basra University (1 result), each with a result in the expected city. This is a three-query
  check, not a comprehensive Iraq search audit or validation of entrances/coordinates.
- The updated browser UI returned Family Mall after pressing the full-search button.
- The listening-review page rendered the eight current recordings with proposed wording and
  explicit pending-recording labels. It contains no newly generated audio yet.
- GitHub/ElevenLabs account access, native listening review, licensed Esri live tests, a signed
  iPhone build and real-device pronunciation testing remain outstanding.
# Running review before merging

The existing **Record voices** workflow accepts `iraqi_review` (default true). Select
`codex/darbna-preview` as the branch and keep this option checked to record the eight
isolated samples and download `iraqi-voice-listening-review`. This entry point works
before the new dedicated review workflow is merged into the default branch.
The review path never commits recordings or changes the active clip manifest.

