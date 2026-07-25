# Current Task — Meta Organic and Ads End-to-End Lark Delivery

## Authoritative status

```text
TASK_STATUS                      = APPROVED_FOR_IMPLEMENTATION
CURRENT_PROGRAM                  = META_CUSTOMER_VISIBLE_DELIVERY
SOURCE_BASELINE                  = PR_56_MERGED_3488C2A6
WORK_BRANCH                      = work/meta-organic-end-to-end-lark
CUSTOMER_VISIBLE_PRIORITY        = END_TO_END_LARK_FIRST
FACEBOOK_TOKEN                   = READY_IN_SECRET_BOUNDARY
INSTAGRAM_TOKEN                  = READY_IN_SECRET_BOUNDARY
META_ADS_TOKEN                   = ACCESS_DISCOVERY_PASS
FACEBOOK_ORGANIC                 = SOURCE_FOUNDATION_READY_WRITE_PATH_PENDING
INSTAGRAM_ORGANIC                = SOURCE_FOUNDATION_READY_WRITE_PATH_PENDING
META_ADS_TARGET_ACCOUNTS         = CHEMISTRYK2_AND_CHEMISTRYK3_LOCKED
META_ADS_EXACT_ID_MAPPING        = REQUIRED_BEFORE_FIRST_WRITE
META_ADS_BUSINESS_READ           = LIVE_DATASET_VERIFICATION_PENDING
GOOGLE_ADS_CUSTOMER_CONFIRMATION = WAITING_CUSTOMER_CLICK
YOUTUBE_CUSTOMER_CONFIRMATION    = WAITING_CUSTOMER_CLICK
D1_BUSINESS_WRITES               = TO_IMPLEMENT
LARK_RAW_WRITES                  = TO_IMPLEMENT
LARK_CANONICAL_WRITES            = TO_IMPLEMENT
MANUAL_LIVE_UAT                  = REQUIRED
SCHEDULE                         = DISABLED_UNTIL_MANUAL_UAT_PASS
PRODUCTION                       = BLOCKED
GOOGLE_ADS_QUEUE_ADMISSION       = PAUSED_NOT_DISCARDED
```

## Product priority rule

A Connector whose credential, authorization and exact source identity are available
must be taken through a customer-visible outcome:

```text
Connection / authorization
→ exact identity and permission preflight
→ real source read
→ D1 durable business state and Coverage
→ Shared RAW Lark rows
→ Canonical Lark rows
→ read-only reconciliation
→ idempotent manual rerun
→ customer-visible Lark verification
```

Do not stop at access preflight, transport-only staging, local fixture adapters or
connection status when the remaining path to Lark is implementable. Foundation-only
work is allowed only for a real blocker and must not outrank a ready Connector that
can produce customer-visible data.

## Current connector sequencing

Facebook Organic, Instagram Organic and Meta Ads are the active implementation
priority because their credentials are available in the Secret boundary and the
repository already contains approved GET-only source and normalization foundations.

Meta Ads target scope is locked by the customer to exactly:

```text
ChemistryK2
ChemistryK3
```

Names alone are not sufficient for writes. Before the first D1 or Lark business write,
the implementation must resolve and bind the exact two Ad Account IDs from
`/me/adaccounts`, re-read each account directly and fail closed if the ID/name,
status, currency or timezone does not match the approved mapping. Every other visible
Ad Account is out of scope and must be ignored.

Google Ads and YouTube are waiting for the customer to click and confirm the
customer-owned authorization. No workaround, fake confirmation or developer-owned
credential substitution is allowed. After confirmation, each Connector must follow
the same end-to-end path to customer-visible Lark data.

The standalone Google Ads Queue-admission branch remains paused. Resume it only as
part of the reviewed end-to-end Google Ads path, not as a higher-priority transport
milestone while Meta sources are ready.

## Objective

Deliver real Facebook Page Organic, Instagram Organic and Meta Ads data from the
currently authorized Integration Workspace sources into the existing Shared RAW and
Canonical Lark tables, with D1-first durability, exact stable keys, Coverage,
reliability, reconciliation and an idempotent manual rerun.

Completion requires the user and customer to open Lark and see the expected Organic
and Ads rows for the approved sources without duplicate stable keys, cross-account
mixing or fabricated metrics.

## Existing approved foundation

PR `#50` already provides:

- independent Facebook Organic, Instagram Organic and Meta Ads connection preflight;
- GET-only source adapters;
- pinned Graph API hosts/version contract;
- pure Organic and Ads normalizers;
- synthetic fixtures and contract tests;
- five Shared RAW table topology;
- exact stable-key, null/zero, time, money and Coverage semantics.

Reuse the existing physical destinations. Do not create provider-specific duplicate
Raw tables or a parallel reliability stack.

## Source scope

### Facebook Organic

```text
facebook.account.latest
facebook.content.inventory
facebook.content.insights
facebook.account.insights
```

Credential boundary:

```text
META_FACEBOOK_PAGE_ACCESS_TOKEN
```

The Page token remains in Secret storage. Verify exact Page identity before the
first business write. Unsupported/deprecated metrics become `null` or no row with
Coverage evidence; never guess or convert them to zero.

### Instagram Organic

```text
instagram.account.latest
instagram.content.inventory
instagram.content.insights
instagram.account.insights
```

Credential boundary:

```text
META_INSTAGRAM_ACCESS_TOKEN
```

The token must include the approved Insights permission. Verify the exact
professional-account identity before the first business write.

### Meta Ads

Approved Ad Accounts:

```text
ChemistryK2
ChemistryK3
```

Credential boundary:

```text
META_ACCESS_TOKEN
```

Required direct reads for each approved Ad Account:

```text
/{ad_account_id}
/{ad_account_id}/campaigns
/{ad_account_id}/adsets
/{ad_account_id}/ads
/{ad_account_id}/adcreatives
/{ad_account_id}/insights
```

Rules:

- bind by exact Ad Account ID after customer-approved name mapping;
- require active/usable account state before writes;
- preserve account currency and timezone exactly;
- inventory and Insights results are independent datasets;
- a valid empty dataset is `no_data_confirmed`, not failure and not fabricated data;
- split performance reads into bounded date windows;
- keep `actions` and `action_values` structured until exact conversion mapping is approved;
- do not publish guessed total Conversions, CPA or ROAS;
- no advertisement mutation, publishing, budget, bid or Spend changes.

## Destination scope

### Shared RAW Lark — Organic

```text
RAW_Meta_Organic_Accounts
RAW_Meta_Organic_Content
RAW_Meta_Organic_Metrics
```

### Shared RAW Lark — Ads

```text
RAW_Ads_Entities
RAW_Ads_Daily
```

### Canonical Lark — Organic

```text
MKT_Accounts
MKT_Account_Daily
MKT_Content
MKT_Content_Daily
```

### Canonical Lark — Ads

```text
MKT_Ads_Accounts
MKT_Ads_Campaigns
MKT_Ads_AdGroups
MKT_Ads_Ads
MKT_Ads_Creatives
MKT_Ads_Daily
```

### D1 authority

```text
organic_content_state
organic_content_observations
organic_account_daily_facts
ads_entity_state
ads_daily_facts
ads_conversion_daily_facts
data_coverage_runs
data_coverage_entities
sync_cursors
sync_work_runs / sync_work_phases / sync_work_units
sync_runs / sync_locks / dead_letter_jobs / system_alerts
```

`ads_conversion_daily_facts` remains unwritten until an exact approved Meta action
mapping exists.

## Stable-key and metric rules

```text
Raw Organic account
  {platform}:{source_account_id}

Raw Organic content
  {platform}:{source_account_id}:{source_content_id}

Raw Organic metric
  {platform}:{entity_type}:{source_entity_id}:{metric_name}:{period}:{source_time_key}

D1 Organic content
  {platform}:{account_key}:{external_content_id}

D1 Organic observation
  {content_key}:{observed_at}:{observation_kind}:v1

Raw/D1 Ads entity
  meta_ads:{account_key-or-account_id}:{entity_type}:{external_entity_id}

Raw Ads daily
  meta_ads:{account_id}:{entity_type}:{external_entity_id}:{metric_date}:{breakdown_key}

D1 Ads daily
  meta_ads:{account_key}:{report_level}:{external_entity_id}:{metric_date}:{breakdown_key}:{segment_key}
```

- External IDs remain Text.
- Missing/unsupported metric is `null` or no row.
- Observed zero remains `0`.
- Source timestamp is retained exactly; reporting dates use the source account timezone
  and customer reporting views use `Asia/Bangkok` where the contract requires it.
- One generation reuses `fetched_at`, `observed_at`, Coverage ID and stable keys.
- Rerun must not create duplicate rows or false Observations for unchanged metrics.
- Incoming `null` must not erase a protected non-null value without explicit source
  deletion/absence semantics.
- Decimal money must be parsed to safe integer micros without floating-point drift.

## Required write order

For each bounded durable unit:

```text
1. complete source/identity/schema validation
2. normalize and calculate stable keys/fingerprints
3. plan every D1 and Lark destination
4. write D1 business state/facts/observations
5. write Shared RAW Lark rows
6. write Canonical Lark rows
7. persist unit checkpoint
8. update Coverage and Sync Log
```

The cursor and completion marker may advance only after all authorized destinations
for the unit reconcile successfully. Partial failure remains partial and resumes from
the durable checkpoint.

## Implementation order

1. Review current Meta adapters, normalizers, D1 stores, shared Lark repository,
   Sync Engine, Queue routing and reliability code.
2. Record duplicate/dead-code and architecture findings before adding modules.
3. Lock exact ChemistryK2/ChemistryK3 ID mappings and direct account preflight.
4. Add shared Facebook/Instagram Organic and Meta Ads active use cases without
   duplicate clients.
5. Add exact runtime configuration and independent default-false feature flags.
6. Add D1-first durable unit/checkpoint/Coverage integration.
7. Add Shared RAW and Canonical Lark planners/writers using existing contracts.
8. Add central manual one-shot Job routing; no schedule producer.
9. Add fixture, empty-data, failure, retry, partial-write, idempotency and
   reconciliation tests.
10. Run full local Definition of Done gates.
11. Merge only after review, then use a protected Remote rollout plan.
12. Run Facebook manual UAT and verify Lark.
13. Run Instagram manual UAT and verify Lark.
14. Run ChemistryK2 and ChemistryK3 Meta Ads manual UAT and verify Lark independently.
15. Rerun all connected Meta sources and prove zero duplicate/business drift.
16. Keep schedules disabled until the customer-visible result is accepted.

## In scope

- Facebook Organic end-to-end source → D1 → Shared RAW → Canonical Lark.
- Instagram Organic end-to-end source → D1 → Shared RAW → Canonical Lark.
- Meta Ads ChemistryK2 and ChemistryK3 end-to-end source → D1 → Shared RAW →
  Canonical Lark.
- Manual one-shot Queue jobs and Worker routing.
- Exact identity/permission/account preflight before writes.
- D1-first durability, distributed lock, generation fence and resumable checkpoint.
- Coverage, Sync Log, typed retry/DLQ/Alert behavior.
- Bounded pagination, response limits and rate-limit-aware retry.
- Customer-visible Lark verification and idempotent rerun evidence.
- Secret-boundary token use only.

## Out of scope

- Any Meta Ad Account other than ChemistryK2 and ChemistryK3.
- Unapproved conversion-action aggregation into `ads_conversion_daily_facts`.
- Google Ads and YouTube live connection/UAT until the customer clicks and confirms.
- Standalone Google Ads Queue-admission implementation while the branch is paused.
- Schedule/Cron activation before manual UAT and customer review.
- Advertisement mutation, publishing, messaging, budget, bid or Spend changes.
- Lark Schema/View/Formula redesign or provider-specific Raw tables.
- Retention/delete operations.
- Production cutover or customer-owned infrastructure migration.

## Acceptance criteria

- [ ] Full current-codebase review completed before implementation.
- [ ] Existing Meta adapters/normalizers are reused without duplicate provider clients
  or reliability stacks.
- [ ] Facebook exact Page identity and permissions pass with the live token.
- [ ] Instagram exact professional-account identity and Insights permissions pass.
- [ ] ChemistryK2 and ChemistryK3 exact Ad Account IDs are bound and direct account
  reads match approved name, status, currency and timezone.
- [ ] Every non-approved visible Ad Account is excluded before any write.
- [ ] Campaign, Ad Set, Ad, Creative and Daily Insights datasets are verified
  independently for both approved accounts.
- [ ] Valid empty Ads datasets are recorded as `no_data_confirmed` without fake rows.
- [ ] Facebook, Instagram and Meta Ads manual jobs use central Connector/Job catalogs.
- [ ] Feature flags remain false in repository examples and default runtime.
- [ ] D1 Organic/Ads state, facts and Coverage reconcile exactly.
- [ ] Shared RAW rows appear in all five approved Meta/Ads tables.
- [ ] Canonical rows appear in the approved Organic and Ads tables.
- [ ] `created + updated + skipped = expected` and `failed = 0` per dataset/account.
- [ ] Exact rerun creates no duplicate stable keys, false Observations or cross-account
  data mixing.
- [ ] Missing metrics remain `null`; observed zero remains `0`.
- [ ] No token, credential, identity payload or raw provider error leaks to Git,
  Queue, D1/Lark business rows, logs or alerts.
- [ ] Retryable failures resume from checkpoint; permanent failures enter typed DLQ.
- [ ] Facebook manual Live UAT is visible and verified in Lark.
- [ ] Instagram manual Live UAT is visible and verified in Lark.
- [ ] ChemistryK2 Meta Ads manual Live UAT is visible and verified in Lark.
- [ ] ChemistryK3 Meta Ads manual Live UAT is visible and verified in Lark.
- [ ] Google Ads/YouTube remain customer-confirmation pending without fake completion
  or developer-owned substitution.
- [ ] Schedules remain disabled unless separately approved after customer review.
- [ ] `npm ci`, `npm run check`, `npm test`,
  `npm run test:report-reliability`, `npm audit --audit-level=high` and
  `npm run deploy:dry-run` pass.
- [ ] Current Task, Project Brain and CHANGELOG contain sanitized final evidence.

## Implementation result

Not started.

## Completion boundary

This task is complete only when Facebook Organic, Instagram Organic and both approved
Meta Ads accounts have real, reconciled, customer-visible rows in Lark and an
idempotent manual rerun passes. A passing token preflight, `/me/adaccounts` response,
local fixture test, deployment or Queue acknowledgement alone is not completion.
