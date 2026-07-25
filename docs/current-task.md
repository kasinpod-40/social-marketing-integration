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

## Objective

Deliver real Facebook Page Organic and Instagram Organic data from the currently
authorized Integration Workspace sources into the existing Shared RAW and Canonical
Lark tables, with D1-first durability, exact stable keys, Coverage, reliability,
reconciliation and an idempotent manual rerun.

The completion boundary is not "token works" or "API returns data". Completion
requires the user and customer to open Lark and see the expected Facebook and
Instagram account/content/metric rows in the approved Views without duplicate
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

The existing physical destinations are reused. No provider-specific duplicate Raw
tables may be created.

## Source scope

### Facebook Organic

Required datasets:

```text
facebook.account.latest
facebook.content.inventory
facebook.content.insights
facebook.account.insights
```

Required credential boundary:

```text
META_FACEBOOK_PAGE_ACCESS_TOKEN
```

The Page token must remain in Secret storage. Exact Page identity must be verified
before the first business write. Unsupported or deprecated Insight metrics become
`null` or no row with Coverage evidence; they must never be guessed or converted to
zero.

### Instagram Organic

Required datasets:

```text
instagram.account.latest
instagram.content.inventory
instagram.content.insights
instagram.account.insights
```

Required credential boundary:

```text
META_INSTAGRAM_ACCESS_TOKEN
```

The token must include the permissions required by the approved contract, including
Insights permission. Exact professional-account identity must be verified before the
first business write.

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

Reuse the approved Storage Architecture and existing D1 business grains:

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

Do not create a parallel Meta reliability stack.

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

Rules:

- External IDs remain Text.
- Missing/unsupported metric is `null` or no row.
- Observed zero remains `0`.
- Source timestamp is retained exactly; reporting dates use `Asia/Bangkok`.
- One generation reuses `fetched_at`, `observed_at`, Coverage ID and stable keys.
- Rerun must not create duplicate rows or duplicate Observations for unchanged
  cumulative metrics.
- Incoming `null` must not erase a protected existing non-null value unless the
  source contract explicitly represents deletion/absence.

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
for the unit reconcile successfully. Partial failure must remain partial and resume
from the durable checkpoint.

## Implementation order

1. Full review of current Meta adapters, normalizers, D1 stores, shared Lark
   repository, Sync Engine, Queue routing and reliability code.
2. Record duplicate/dead-code and architecture findings before adding modules.
3. Add Facebook Organic and Instagram Organic active use cases using shared
   abstractions where possible.
4. Add exact runtime configuration and independent default-false feature flags.
5. Add D1-first durable unit staging/checkpoint/Coverage integration.
6. Add Shared RAW and Canonical Lark planners/writers using existing table contracts.
7. Add central Job routing for manual one-shot execution; no schedule producer.
8. Add fixture, failure, retry, partial-write, idempotency and reconciliation tests.
9. Run local full gates.
10. Deploy only after reviewed source merge and a protected Remote rollout plan.
11. Run Facebook manual UAT and verify Lark.
12. Run Instagram manual UAT and verify Lark.
13. Rerun both with the same source state and prove zero duplicate/business drift.
14. Keep schedules disabled until the customer-visible result is accepted.

## In scope

- Facebook Organic end-to-end source → D1 → Shared RAW → Canonical Lark.
- Instagram Organic end-to-end source → D1 → Shared RAW → Canonical Lark.
- Manual one-shot Queue jobs and Worker routing.
- Exact identity/permission preflight before writes.
- D1-first durability, distributed lock, generation fence and resumable checkpoint.
- Coverage, Sync Log, typed retry/DLQ/Alert behavior.
- Bounded pagination, request/body limits and rate-limit-aware retry.
- Customer-visible Lark verification and idempotent rerun evidence.
- Safe token use from Secret storage only.

## Out of scope

- Meta Ads ingestion in this release; its current no-data state does not block
  Facebook/Instagram Organic delivery.
- Google Ads Queue-admission implementation; the existing branch remains paused.
- Schedule/Cron activation before manual UAT and customer review.
- Advertisement mutation, publishing, messaging or Spend changes.
- Lark Schema/View/Formula redesign or creation of new provider-specific Raw tables.
- Retention/delete operations.
- Production cutover or customer-owned infrastructure migration.

## Acceptance criteria

- [ ] Full current-codebase review completed before implementation.
- [ ] Existing Meta source adapters and normalizers are reused without duplicate
  provider clients or reliability stacks.
- [ ] Facebook exact Page identity and required permissions pass with the live token.
- [ ] Instagram exact professional-account identity and Insights permissions pass.
- [ ] Facebook and Instagram manual jobs use central Connector/Job catalogs.
- [ ] Feature flags remain false in repository examples and default runtime.
- [ ] D1 durable state, Observations/account facts and Coverage reconcile exactly.
- [ ] Shared RAW Lark rows appear in all three approved Meta Organic tables.
- [ ] Canonical rows appear in Accounts, Account Daily, Content and Content Daily.
- [ ] `created + updated + skipped = expected` and `failed = 0` per dataset.
- [ ] Exact rerun creates no duplicate stable keys and no false Observations.
- [ ] Missing metrics remain `null`; observed zero remains `0`.
- [ ] No token, Page credential, identity payload or raw provider error leaks to Git,
  Queue, D1/Lark business rows, logs or alerts.
- [ ] Retryable failures resume from checkpoint; permanent failures enter typed DLQ.
- [ ] Facebook manual Live UAT is visible and verified in Lark.
- [ ] Instagram manual Live UAT is visible and verified in Lark.
- [ ] Schedules remain disabled after manual UAT unless separately approved.
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
