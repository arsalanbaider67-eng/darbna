# Darbna pre-submission audit — 17 October 2026

**Submission status: HOLD. TestFlight is explicitly on hold at the owner's request while new ideas are added. Do not start an iOS store build, sign/export a new IPA, or submit for review until the owner resumes that work.**

This is a practical audit of the current repository and visible Apple setup, not a guarantee of approval or an exhaustive prediction of Apple's discretion. “Fixed in source” does not mean shipped to an iPhone. The separate redesign remains in preview PR #1; this release branch keeps the existing production screens.

## Confirmed checks

- Owner approved 75 Standard Arabic Hamid recordings, normal speed 1.0. The previous Iraqi/Sufyan requirement is superseded. English recordings are unchanged.
- Core: 129 tests passed. App: 19 tests passed. TypeScript check and web export passed. Native-device acceptance has not been performed for these changes.
- Apple sign-in verified. App record 6823604581, bundle iq.darbna.app. Existing TestFlight builds 13 and 7 were visible; latest build 13 was uploaded on 16 October. No new TestFlight build was requested.
- The App Store version 1.0 is “Prepare for Submission”. The Arabic description, keywords, support URL, copyright and review notes were empty when inspected; sign-in-required was checked despite the app having no login. No review build was selected. Category, age ratings, content rights and privacy questionnaire had not been set up.
- Saved Navigation category, Arabic subtitle and the privacy-policy URL. Final metadata and privacy declarations still need completion and verification.
- Read-only database inspection found the traffic-light table absent. Applied the repository schema and additive moderation migration. Database tests passed: private-table access denied to anon; sender blocking covers all reports from the sender; another viewer remains unaffected; self-block is rejected; flags remain hidden; moderator insert bans work; deletion clears block preferences. All fixtures rolled back, with no public fake reports retained.

## Changes prepared

| Issue found in Darbna | Resolution |
|---|---|
| Arabic could silently switch to an unwanted phone voice | Approved bundled Standard Arabic recordings; Arabic playback failure shows a notice and keeps visual guidance |
| New or existing users could contribute traffic without an explicit opt-in | Default off; previous settings require a new explicit choice; versioned consent |
| Queued location samples could flush after opting out | Pending speed/stop queues are dropped on stop/cleanup; already-sent requests cannot be recalled |
| Simulated tour positions could make public reports | Tour/demo report submission disabled; neither contributes traffic |
| Deletion failure could look successful and erase the ID needed to retry | Server confirmation first, local wipe second; meaningful regression tests |
| Privacy text incorrectly promised identifier-free sharing and fixed deletion deadlines | Revised Arabic, Sorani and English policy explains installation/trip identifiers, IP hashes, providers, public notes and cleanup limits |
| In-app privacy/support missing | Settings links plus public three-language policy/support pages; public email darbnaiq@gmail.com |
| Sender blocking missing | Private block table, per-install filtered report feed and block button; moderator ban table with insert guard; author hashes never exposed in public report JSON |
| Flagged reports could return on refresh | Personalized report query excludes the viewer's flagged/gone reports |
| Typing could issue public geocoder autocomplete requests | Local suggestions while typing; explicit remote search; queued/cached requests and clearer full-search action |
| Search could merge distinct places too aggressively or show stale results | Shared place merging, request sequencing and cache fixes with regression tests |
| Nearby search queried many public servers at once, including bulk Nominatim categories | One Overpass request per lookup with area/language cache; removed public Nominatim category lookup |
| CI manufactured public reports as a health check | Removed write probes; health checks are read-only |
| Background-audio configuration implied unsupported background navigation | Disabled that setting; documented foreground-only behavior |
| Privacy manifest said location/device codes were unlinked | Source declarations mark linked location/device identifier and report content for functionality; App Store form must be reconciled with providers |
| Displayed app version was stale | Read the configured app version |
| Native MapLibre type and web offline import were incorrect | Correct enums and platform import; type check passed |

## Remaining rejection or submission risks

Priority “blocker” means resolve before submission. “Device check” requires the actual final iPhone build. “Conditional” applies only if the described feature/market is used.

| Area | Finding / evidence | What remains |
|---|---|---|
| Completeness — blocker | Review listing is mostly blank; no build selected | Fill all required localized metadata, reviewer contact and final notes; select the final processed build |
| Screenshots — blocker | No verified native screenshots supplied | Capture the actual final app on the required supported device sizes. No web mockups, fake traffic or unavailable features |
| Reviewer access — blocker | No-login app had “Sign-in required” checked | Turn it off; use the labelled Erbil tour and explicit search instructions in the prepared notes |
| Privacy questionnaire — blocker | Not started in Apple | Disclose functionality-related precise location, installation ID, road-report content; evaluate search queries, IP processing and provider/SDK retention. Do not claim “Data Not Collected” |
| Privacy linkage — blocker | Pseudonymous codes associate reports and locations | Complete purpose/linkage/tracking answers consistently; “no account” does not mean unlinked data |
| Search history/provider data — blocker | Queries reach third parties | Verify Esri/hosting contracts and actual logging/retention before declaring exact collection categories |
| Location consent — device check | Foreground permissions configured | Test denied, approximate-only, disabled GPS, first launch, later permission changes and permission strings in all supported locales |
| Traffic consent — device check | Source/test fixes prepared | Confirm no contribution before opt-in, immediately after opt-out, in tour/demo, or after ending a route |
| Deletion — device/service check | Source now preserves retry identity on server failure | Verify final UI and a disposable, explicitly designated test installation; verify remote rows, active sharing and local wipe. Do not delete real user data during an audit |
| Retention — operational | Cleanup runs on submissions; no pg_cron extension was installed when checked | Establish monitored scheduled cleanup if fixed deadlines are desired. Current policy truthfully avoids guarantees; do not claim automatic two-hour deletion |
| UGC moderation — operational blocker | Blocking and ban controls prepared; fixed categories and flags exist | Owner must monitor support/flags, act promptly, remove abusive content and ban repeat senders. Controls alone do not establish a working moderation operation |
| Reinstallation abuse — limitation | Installation-based identity can reset | Monitor abuse and rate limits; do not claim bans cannot be evaded. No accounts are required |
| Private tables — service check | RLS/private schema intended; new block/ban tables are private | Verify anon cannot read private tables/functions, and public APIs expose only intended fields. Keep service-role credentials out of apps |
| Public map notes — privacy/safety | Free text goes directly to OpenStreetMap | Clearly warn users notes/text/location are public and not deleted by Darbna; avoid personal data; verify external submission UI |
| Checkpoint information — policy/safety | Community permanent checkpoint queues and an avoidance option exist | Review actual data and marketing. No DUI checkpoint or patrol/evasion feature. Do not describe all checkpoint features as automatically approved or automatically banned |
| Safe driving — device check | Reporting is gated while moving unless passenger; SOS opens dialler | Verify touch targets, passenger handling and no automatic dialing. Do not place emergency test calls. Obey official signs |
| Emergency accuracy — evidence retained | Existing owner confirmation covers 911 and release gate passes | Keep that evidence; do not add numbers or claim new call testing |
| Speed/traffic accuracy — reliability | OSM data and community signals have limited coverage | Show unknown/partial states; no promise of every speed limit, every place, universal live traffic or guaranteed ETA |
| Search infrastructure — blocker before public scale | Public Nominatim fallback remains; throttling is per device | Configure an appropriate own/managed service. Public-service app-wide limits and runtime switching are not solved by per-device throttling |
| Routing infrastructure — blocker before public scale | Public Valhalla fallback remains; own VPS is documented as not live | Confirm production endpoint, provider permission/capacity and uptime. Do not submit against an unproven demo service |
| Nearby infrastructure — reliability | Overpass still public | Confirm capacity/terms or configure production service; test timeouts and retry UI without hammering mirrors |
| Esri licensing — owner/provider check | Native workflow requires licensed key | Verify permitted app/geocoding use, billing/quota and key restrictions; never publish a server secret. Client keys cannot be hidden by bundling |
| Offline maps — conditional licensing | Provider tiles can be downloaded | Verify each provider's offline/prefetch rights and limits, especially satellite; do not apply the OSM standard-tile policy to unrelated OpenFreeMap hosting |
| Attribution/content rights — blocker | OSM/OpenFreeMap/Esri and recorded voices used | Check visible map attribution, data/font/SDK licenses and commercial rights to voice/assets; complete Apple content-rights answer truthfully |
| Native crash/startup — device check | Web/type tests do not prove native startup | Fresh install, upgrade from build 13, restart, low memory, network loss and recovery; inspect crashes and stalls |
| Native audio — device check | Approved files bundled; no real-device verification of this candidate | Test all 75 decode, composed prompts, rapid reroute, voice toggle, silent/volume/Bluetooth, calls and interruptions at speed 1.0 |
| Background behavior — known limitation | Foreground navigation only | Test locking/switching apps and resume; clearly state navigation/sharing stop updating in background. Do not advertise background support |
| Networking/IPv6 — device check | External HTTPS services used | Verify final build on IPv6-only/NAT64 and slow/unavailable networks; no raw IPv4 assumptions or hanging spinners |
| Accessibility/RTL — device check | Three locale tables pass parity | Test VoiceOver, larger text, Arabic/Sorani clipping, landscape/safe areas, contrast, keyboard focus and buttons on supported phones |
| Search quality — acceptance check | More than one provider/Arabic spelling variation | Check real missing names from users across cities; incomplete OSM/Esri coverage is not fixed by inventing records |
| Route safety — acceptance check | Snapping/rerouting/arrival tests exist | Verify real roads, turn restrictions, disconnected streets, walking/car, ferry and waypoint behavior, closures and stale reports |
| Export compliance — blocker if asked | App uses normal HTTPS; configuration declares no non-exempt encryption | Confirm included SDK encryption against Apple's actual questions; do not file documents or legal declarations on assumptions |
| Age rating — blocker | Questionnaire not completed | Answer UGC yes; accurately assess external access, ads/chat/social features and content. Let Apple calculate the rating; no unsupported 4+ promise |
| EU DSA — conditional owner decision | Apple shows trader setup required | Owner determines trader status/verification and markets. Do not accept legal terms or invent an address/status |
| Territories/local rules — conditional | Iraq-focused navigation/imagery/checkpoint content | Verify permitted territories, local mapping/content obligations and rights; no legal compliance guarantee from this code audit |
| Pricing/agreements — setup | App is intended free; commercial account pages not audited | Confirm free tier, territories, current developer membership/agreements. Owner handles legal acceptance and purchases |
| SDK/privacy manifests — build check | Expo 54/RN 0.81; source privacy manifest updated | Validate final archive, required-reason API manifests, SDK signatures and current upload requirements when the iOS build resumes |
| Build identity/signing — held | Existing production bundle; share extension remains off | Use increasing build number and saved signing path later. No extension entitlement without the required provisioning |
| Share extension — intentionally unavailable | Disabled in current build path | Remove extension promises from listing; no UDID needed for ordinary App Store-signed TestFlight upload |
| App functionality — lower observed risk | Native navigation features exceed a static website | Final app must actually work; no placeholder screens, beta-only claims or debug controls in the store submission |
| Payments/accounts — currently not applicable | No account, subscription, IAP, ad SDK or social login in current app | Re-audit if new ideas add purchases, accounts, advertising, tracking, AI chat or social features |
| CarPlay/other platforms — conditional | No verified CarPlay entitlement/support | Do not advertise support until implemented, entitled and tested; re-audit iPad if universal support is enabled |
| Security/release integrity — ongoing | No signing/API secrets added in these changes | Scan the final diff and archive; validate RLS/API input limits, HTTPS, key restrictions and link authorization; do not weaken signing workarounds |
| External deployment check — unresolved | Preview's third-party Cloudflare check failed; primary GitHub check had passed earlier | Verify the actual hosting target used for this release. Do not report every CI check green based only on local tests |

## Owner/device acceptance before final submission

1. Add the owner's new ideas, then rerun the audit for their data, safety, payments and entitlement impact.
2. Complete the production-service and licensing checks above; confirm support mailbox and moderation ownership.
3. Resume TestFlight only when requested; inspect the signed archive/upload result and Apple's processed build.
4. Test that exact build on iPhone, record evidence and capture real screenshots. Re-test consent/deletion/UGC using an isolated disposable test identity.
5. Finish Apple metadata, privacy/age/content-rights/export answers, reviewer contact, territories and any required owner legal decisions.
6. Remove draft holds from the review notes only after the blockers are resolved. Owner performs final App Store submission.


## Verified delivery

- Web release PR [#2](https://github.com/arsalanbaider67-eng/darbna/pull/2) merged as b8bfcc4c70a448bc12b75b2da42d7d835ff19f81. [GitHub Pages run 38985638039](https://github.com/arsalanbaider67-eng/darbna/actions/runs/38985638039) built and deployed successfully.
- Live web verification downloaded all 75 Arabic assets and confirmed each SHA-256 equals its owner-approved source file. All 75 asset hashes are referenced by the live JavaScript bundle. The live permission/consent/support controls were inspected.
- The Arabic store description, keywords, copyright, support URL, no-login setting, reviewer notes and owner-provided reviewer contact were saved in Apple's draft. A reload verified persistence; private phone/email fields were redacted by browser tooling. The owner's personal phone number is not in this repository or public support pages.
- Public support contact changed to **darbnaiq@gmail.com** at the owner's request. No message was sent to the mailbox and receipt/response operation has not been tested.
- TestFlight stayed unchanged. The automatic unsigned iOS check triggered by the web merge was cancelled; no signed iOS store workflow was dispatched and no new build was uploaded to App Store Connect.
- The primary branch check passed. The separate Cloudflare Workers integration still reports a failed check; it is not the successful GitHub Pages deployment used above.
- Apple privacy questionnaire, age rating, content-rights declaration, actual native screenshots, pricing/territory/legal confirmations, production-service capacity/licensing and exact-build iPhone acceptance remain pending. The code audit does not certify store readiness.

## Policy references

Apple requires complete, testable apps, accurate listing information, appropriate privacy disclosures and safeguards for user content. Navigation also needs careful safety behavior. See [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (1.2, 1.4, 1.5, 2.1, 2.3, 2.5 and 5.1), [privacy definitions](https://developer.apple.com/app-store/app-privacy-details/), and [submission requirements](https://developer.apple.com/app-store/submitting/). Public [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) forbids autocomplete and sets an application-wide request limit; a phone-local queue does not establish compliance for a public release.
