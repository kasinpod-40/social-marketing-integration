# Current Task — Facebook and Instagram Organic End-to-End Lark Delivery

## Authoritative status

```text
TASK_STATUS                      = APPROVED_FOR_IMPLEMENTATION
CURRENT_PROGRAM                  = META_ORGANIC_CUSTOMER_VISIBLE_DELIVERY
SOURCE_BASELINE                  = PR_56_MERGED_3488C2A6
WORK_BRANCH                      = work/meta-organic-end-to-end-lark
CUSTOMER_VISIBLE_PRIORITY        = END_TO_END_LARK_FIRST
FACEBOOK_TOKEN                   = READY_IN_SECRET_BOUNDARY
INSTAGRAM_TOKEN                  = READY_IN_SECRET_BOUNDARY
FACEBOOK_ORGANIC                 = SOURCE_FOUNDATION_READY_WRITE_PATH_PENDING
INSTAGRAM_ORGANIC                = SOURCE_FOUNDATION_READY_WRITE_PATH_PENDING
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

From this task onward, a Connector whose credential, authorization and exact
source identity are available must be taken through a customer-visible outcome:

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

Facebook Organic and Instagram Organic are the active implementation priority
because their tokens are already available in the Secret boundary and both have
approved source adapters and normalization contracts.

Google Ads and YouTube are not rejected and are not waiting for another foundation
phase. Their connection flows are waiting for the customer to click and confirm the
customer-owned authorization. No workaround, fake confirmation or developer-owned
credential substitution is allowed.

After either customer confirmation succeeds, that Connector must be taken through
the same end-to-end rule: exact identity validation, real source read, D1 durability,
Shared RAW/Canonical Lark delivery, reconciliation and idempotent rerun. It must not
be treated as another access-only or transport-only milestone.

The standalone Google Ads Queue-admission branch remains paused. Resume it only when
it is part of the reviewed end-to-end Google Ads path to customer-visible Lark data,
not as a higher-priority transport milestone while Facebook/Instagram are ready.

## Objective

Deliver real Facebook Page Organic and Instagram Organic data from the currently
authorized Integration Workspace sources into the existing Shared RAW and Canonical
Lark tables, with D1-first durability, exact stable keys, Coverage, reliability,
reconciliation and an idempotent manual rerun.

Completion requires the user and customer to open Lark and see the expected Facebook
and Instagram account/content/metric rows in the approved Views without duplicate
stable keys or fabricated metrics.

## Existing approved foundation

PR `#50` already provides:

- independent Facebook Organic and Instagram Organic connection preflight;
- GET-only source adapters;
- pinned Graph API hosts/version contract;
- pure Organic normalizers;
- synthetic fixtures and contract tests;
- five Shared RAW table topology;
- exact stable-key, null/zero, time and Coverage semantics.

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

## Destination scope

### Shared RAW Lark

```text
RAW_Meta_Organic_Accounts
RAW_Meta_Organic_Content
RAW_Meta_Organic_Metrics
```

### Canonical Lark

```text
MKT_Accounts
MKT_Account_Daily
MKT_Content
MKT_Content_Daily
```

### D1 authority

```text
organic_content_state
organic_content_observations
organic_account_daily_facts
data_coverage_runs
data_coverage_entities
sync_cursors
sync_work_runs / sync_work_phases / sync_work_units
sync_runs / sync_locks / dead_letter_jobs / system_alerts
```

## Stable-key and metric rules

```text
Raw account
  {platform}:{source_account_id}

Raw content
  {platform}:{source_account_id}:{source_content_id}

Raw metric
  {platform}:{entity_type}:{source_entity_id}:{metric_name}:{period}:{source_time_key}

D1 content
  {platform}:{account_key}:{external_content_id}

D1 observation
  {content_key}:{observed_at}:{observation_kind}:v1
```

- External IDs remain Text.
- Missing/unsupported metric is `null` or no row.
- Observed zero remains `0`.
- Source timestamp is retained exactly; reporting dates use `Asia/Bangkok`.
- One generation reuses `fetched_at`, `observed_at`, Coverage ID and stable keys.
- Rerun must not create duplicate rows or false Observations for unchanged metrics.
- Incoming `null` must not erase a protected non-null value without explicit source
  deletion/absence semantics.

## Required write order

For each bounded durable unit:

```text
1. complete source/identity/schema validation
2. normalize and calculate stable keys/fingerprints
3. plan every D1 and Lark destination
4. write D1 business state/observation/account facts
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
3. Add shared Facebook/Instagram Organic active use cases without duplicate clients.
4. Add exact runtime configuration and independent default-false feature flags.
5. Add D1-first durable unit/checkpoint/Coverage integration.
6. Add Shared RAW and Canonical Lark planners/writers using existing contracts.
7. Add central manual one-shot Job routing; no schedule producer.
8. Add fixture, failure, retry, partial-write, idempotency and reconciliation tests.
9. Run full local Definition of Done gates.
10. Merge only after review, then use a protected Remote rollout plan.
11. Run Facebook manual UAT and verify Lark.
12. Run Instagram manual UAT and verify Lark.
13. Rerun both and prove zero duplicate/business drift.
14. Keep schedules disabled until the customer-visible result is accepted.

## In scope

- Facebook Organic end-to-end source → D1 → Shared RAW → Canonical Lark.
- Instagram Organic end-to-end source → D1 → Shared RAW → Canonical Lark.
- Manual one-shot Queue jobs and Worker routing.
- Exact identity/permission preflight before writes.
- D1-first durability, distributed lock, generation fence and resumable checkpoint.
- Coverage, Sync Log, typed retry/DLQ/Alert behavior.
- Bounded pagination, response limits and rate-limit-aware retry.
- Customer-visible Lark verification and idempotent rerun evidence.
- Secret-boundary token use only.

## Out of scope

- Meta Ads ingestion in this release; current no-data does not block Organic delivery.
- Google Ads and YouTube live connection/UAT until the customer clicks and confirms.
- Standalone Google Ads Queue-admission implementation while the branch is paused.
- Schedule/Cron activation before manual UAT and customer review.
- Advertisement mutation, publishing, messaging or Spend changes.
- Lark Schema/View/Formula redesign or provider-specific Raw tables.
- Retention/delete operations.
- Production cutover or customer-owned infrastructure migration.

## Acceptance criteria

- [ ] Full current-codebase review completed before implementation.
- [ ] Existing Meta adapters/normalizers are reused without duplicate provider clients
  or reliability stacks.
- [ ] Facebook exact Page identity and permissions pass with the live token.
- [ ] Instagram exact professional-account identity and Insights permissions pass.
- [ ] Facebook and Instagram manual jobs use central Connector/Job catalogs.
- [ ] Feature flags remain false in repository examples and default runtime.
- [ ] D1 state, Observations/account facts and Coverage reconcile exactly.
- [ ] Shared RAW rows appear in all three approved Meta Organic tables.
- [ ] Canonical rows appear in Accounts, Account Daily, Content and Content Daily.
- [ ] `created + updated + skipped = expected` and `failed = 0` per dataset.
- [ ] Exact rerun creates no duplicate stable keys or false Observations.
- [ ] Missing metrics remain `null`; observed zero remains `0`.
- [ ] No token, credential, identity payload or raw provider error leaks to Git,
  Queue, D1/Lark business rows, logs or alerts.
- [ ] Retryable failures resume from checkpoint; permanent failures enter typed DLQ.
- [ ] Facebook manual Live UAT is visible and verified in Lark.
- [ ] Instagram manual Live UAT is visible and verified in Lark.
- [ ] Google Ads/YouTube remain recorded as customer-confirmation pending without
  fake completion or developer-owned substitution.
- [ ] Schedules remain disabled unless separately approved after customer review.
- [ ] `npm ci`, `npm run check`, `npm test`,
  `npm run test:report-reliability`, `npm audit --audit-level=high` and
  `npm run deploy:dry-run` pass.
- [ ] Current Task, Project Brain and CHANGELOG contain sanitized final evidence.

## Implementation result

Not started.

## Completion boundary

This task is complete only when both connected Organic sources have real,
reconciled, customer-visible rows in Lark and an idempotent manual rerun passes.
A passing token preflight, API response, local fixture test, deployment or Queue
acknowledgement alone is not completion.
