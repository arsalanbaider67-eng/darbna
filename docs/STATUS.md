# Darbna status — 17 October 2026

Existing iPhone TestFlight builds 13 and 7 are available in App Store Connect. New TestFlight builds are **on hold by owner request** while new ideas are added. Do not start ios-store.yml until requested.

The web/mobile release candidate promotes the owner's approved 75 Standard Arabic Hamid recordings, search fixes, explicit traffic consent, reliable deletion, policy/support links and sender blocking. The full UI redesign remains separately in preview PR #1.

Verified: 129 core tests, 19 app tests, TypeScript and web export. Supabase schema and review moderation migration applied; rollback-only database regression passed. No real-device test has been performed for the new candidate. No App Store submission has been made.

App Store setup is incomplete. See [full audit](app-review-audit.md) for every identified risk and the submission gate; do not interpret successful unit tests as store readiness. Production routing/search capacity, provider licenses, privacy declarations, age/content-rights answers, moderation operation, native screenshots and physical-device acceptance remain required.
