# Rewards preview — launch remains closed

The owner chose a free draw at each ten-level milestone, with one prize per completed
draw and manual review/delivery by the owner. There are no paid entries or rewarded ads.

| Prize category | Probability | Weight out of 20,000 |
|---|---:|---:|
| Voucher | 40% | 8,000 |
| Free oil change | 0.5% | 100 |
| Free car | 0.005% | 1 |
| Mobile top-up voucher | 59.495% | 11,899 |

These are planned probabilities, not available offers. A 40% voucher probability does
not promise a 40% discount. Independent draws do not guarantee a car every 20,000 draws.
No real offers, balances, contacts or claims are seeded by the migration.

## Implementation

- Settings opens the Arabic-first rewards screen; English and Sorani are included.
- Recognition points remain separate from reward eligibility. New independent checks
  earn +2 reward credit for the author once per confirmed report and +2 for each independent
  driver confirming another report once. Submission alone, clearance votes and thanks earn none.
  Self-checks and unconfirmed reports do not qualify. Flagged/removed reports reverse credit.
- Levels continue beyond six. Level 10 needs 6,500 reward credits; level 20 needs 16,500.
  Historical recognition points are not backfilled into reward eligibility.
- PostgreSQL generates an unbiased cryptographic bucket. Each installation/milestone
  has one durable draw; retrying returns the same result. The client cannot choose a prize.
- All four configured categories must be funded and available before drawing. Exhaustion
  of any category pauses the whole milestone pool rather than silently changing odds.
- Draws reserve stock and snapshot the prize, rules and odds. Claim submission records
  one optional contact method for manual delivery. It sends no email, SMS, money or prize.
- Private tables use RLS and revoked client permissions. Public functions return only
  the requesting installation's history and never return contact details.
- The app blocks draw/claim interaction while navigating. Terms and consent precede entry
  and contact submission. Existing wins retain their original rules when a program pauses.
- Delete My Data removes reward identity/history/contact records. Anonymous stock counters
  remain reserved after deletion, so deleting an identity cannot manufacture more stock.
  The owner must reconcile abandoned/deleted reservations separately.

## Database and owner review

Apply `schema.sql` first, then `rewards.sql`, then `report-integrity.sql`. Reapplying the base schema later can overwrite
`darbna_delete_me`; reapply both feature migrations afterward. The migration starts with
`enabled=false`, `launch_reviewed=false`, and no offers. Do not enable it as part of a build.

Owner-only SQL Editor review (never grant this function or private table access to app roles):

```sql
select id, milestone, offer_title, contact_method, contact_value, status
from darbna_private.reward_claims where status in ('pending','approved') order by created_at;
-- Replace the UUID only after inspecting that real claim and checking eligibility.
select darbna_private.review_reward_claim('CLAIM_UUID', 'approved');
-- Mark sent only after the owner has actually delivered the prize.
select darbna_private.review_reward_claim('CLAIM_UUID', 'sent');
-- Rejections require a claimant-visible explanation; do not put internal/private notes here.
select darbna_private.review_reward_claim('CLAIM_UUID', 'rejected', 'Reason visible to claimant');
```

The permitted transitions are pending→approved/rejected and approved→sent/rejected.
Sent is final. Approval and delivery recheck reward eligibility. Rejection releases stock;
it does not grant a reroll. Contact matching limits duplicate claims at the same milestone,
with phone and WhatsApp sharing a canonical number.

## Launch blockers

1. Specify the mobile top-up amount/operator restrictions, voucher value/discount and merchant conditions, oil-change
   provider/service coverage, car model/value, quantities, funding and fulfilment commitments.
2. Obtain promotion review for every eligible country, age group and distribution channel.
   Free earned entries alone do not establish legal eligibility. Publish official rules in
   all supported languages: sponsor, eligibility, dates/timezone, entry limits, exact odds,
   stock/exhaustion, delivery deadline, taxes/costs, disqualification and disputes. State that
   Apple does not sponsor or administer the promotion. See Apple's [5.3 guidelines](https://developer.apple.com/app-store/review/guidelines/#gaming-gambling-and-lotteries).
3. Add enforceable country/age eligibility and stronger identity/contact verification before
   valuable prizes go live. Anonymous installation IDs are resettable and are not proof of
   a unique human. Coordinated fake confirmations can still farm credit; manual review and
   duplicate-contact checks do not eliminate this risk. Account recovery is not implemented.
4. Define contact retention, claim recovery and address/vehicle fulfilment handling. Collect
   any additional delivery information separately with clear consent. No address/payment
   fields or external messaging are included in this preview.
5. Publish the updated three-language privacy policy and update App Store privacy answers
   before shipping a version that collects reward contacts. The source privacy manifest
   includes email, phone and other contact data; App Store Connect answers are not updated
   by changing that manifest.
6. Test simultaneous requests with separate database connections, real-device accessibility,
   eligibility enforcement and owner fulfilment procedures in staging. Do not enable from
   a local preview, seed pretend prizes or issue a new TestFlight build without the owner.

## Verified on 17 October 2026

132 core tests + 19 mobile tests passed, along with TypeScript and the web export.
The SQL tests passed in an explicit rollback transaction: exhaustive 20,000 bucket counts,
RNG range, independent credit/reversal, draw ownership, retries, stock pause, claim privacy,
manual transitions and deletion. These are single-connection tests, not a load/concurrency test.
Fixtures were rolled back. The installed program was verified disabled with zero offers,
draws and claims. Rewards UI is a separate local preview; production web and TestFlight
have not received this feature.

## Confirmed abuse and +2 scoring update

The planned prize breakdown is removed from the top of the preview. Actual odds remain
visible with the rules before any enabled draw. The 59.495% category is mobile top-up vouchers;
amounts, operators and funding are still unset. Future report points are +2 once for the
author after an independent confirmation, and +2 per driver confirming another report once.
Existing recognition balances are preserved. Legacy thanks recognition remains separate.

Raw flags enter the private report_review_queue; expiration and clearance are not offences.
The owner reviews evidence and calls private review_report(report UUID, fake/abuse/valid, reason).
Only five distinct owner-confirmed fake/abusive reports cause the automatic reporting ban.
Repeated review of the same report adds no strike. Correcting a verdict to valid can lift
that automatic ban, but never a separate owner ban. This is human-reviewed moderation,
not an automatic truth detector. New report submissions (including duplicate paths) and
confirmations reject banned installations. Unusual activity counts and driver feedback help
review; the app does not silently add GPS evidence collection or claim to verify presence.

Owner review example (private SQL Editor only):

```sql
select * from darbna_private.report_review_queue;
-- Replace UUID and reason after examining the actual evidence.
select darbna_private.review_report('REPORT_UUID', 'fake', 'Evidence reviewed by owner');
-- Correct an error, if appropriate:
select darbna_private.review_report('REPORT_UUID', 'valid', 'Correction after appeal');
```

Moderation verdicts and hashed identities survive normal data deletion to enforce bans;
privacy text discloses this. Device reinstallation can still bypass anonymous identity,
so this cannot be described as a permanent ban on a verified person.
