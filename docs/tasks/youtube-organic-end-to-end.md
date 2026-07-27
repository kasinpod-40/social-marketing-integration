# YouTube Organic End-to-End Integration

## Authoritative workstream status

```text
WORKSTREAM                         = youtube-organic-end-to-end
BRANCH                             = agent/youtube-organic-end-to-end
BASE_SHA                           = ad6614dd8ee0cb2a1dda5cdbe7035f44b40581d4
IMPLEMENTATION                     = COMPLETE_ON_WORKSTREAM_BRANCH
SHARED_ENTRYPOINT_WIRING           = NOT_DONE / INTEGRATION_CHAT_OWNED
REMOTE_D1_MIGRATION                = NOT_RUN
WORKER_DEPLOY                      = NOT_RUN
QUEUE_MESSAGE                      = NOT_SENT
REMOTE_LARK_MUTATION               = NONE
SCHEDULE_CHANGE                    = NONE
CUSTOMER_OR_PRODUCTION_LIVE_UAT    = NOT_RUN
MERGE                              = BLOCKED_PENDING_INTEGRATION_REVIEW
```

## Scope and authority

This workstream connects the existing YouTube Organic foundation to Storage Architecture v1 without creating a second YouTube connector, Reliability engine, Queue framework, D1 writer or Lark sync engine.

Sources of truth reviewed before implementation:

- `AGENTS.md`
- `docs/current-task.md`
- `PROJECT_BRAIN.md`
- `docs/project-brain/storage-architecture-and-migration-contract-v1.md`
- the existing YouTube Blueprint, connector, adapters, normalizers and runtime contracts
- the existing Shared Google OAuth Core and customer connection lifecycle

Latest inspected `main` at workstream start:

```text
ad6614dd8ee0cb2a1dda5cdbe7035f44b40581d4
```

Latest source migration inspected:

```text
migrations/0016_tiktok_post_lark_pipeline.sql
```

Migration `0016` is TikTok-owned and was not applied remotely by this workstream. YouTube reuses the additive Storage tables from `migrations/0009_storage_foundation.sql`; this branch adds no migration and does not alter the migration sequence.

## Files changed

Add-only workstream files:

```text
packages/application/src/use-cases/sync-youtube-organic-end-to-end.js
packages/application/src/storage/youtube-storage-first-sync-engine.js
packages/application/src/storage/youtube-organic-history-storage.js
packages/application/src/storage/youtube-availability-history-storage.js
packages/application/src/storage/youtube-account-history-storage.js
packages/application/src/reports/load-youtube-organic-report-source.js
packages/connectors/src/youtube/d1-youtube-organic-report-source.js
apps/sync-worker/src/youtube-organic-job-router.js
tests/application/youtube-organic-end-to-end.test.js
tests/application/load-youtube-organic-report-source.test.js
tests/application/youtube-organic-job-routing.test.js
tests/connectors/d1-youtube-organic-report-source.test.js
docs/tasks/youtube-organic-end-to-end.md
```

Reserved Integration files were not edited, including:

```text
AGENTS.md
docs/current-task.md
PROJECT_BRAIN.md
README.md
CHANGELOG.md
root package.json
main Worker entrypoint
shared scheduler
shared job catalog
customer profiles
Wrangler configuration
migration sequence
shared Lark table registry
```

## Existing shared helpers reused

- `YouTubeApiClient`
- `youtube-organic.adapter.js`
- `youtube-raw.adapter.js`
- `youtube-runtime-factory.js`
- `normalizeYouTubeVideoBatch`
- `syncYouTubeOrganicToLark`
- `TableSyncEngine`
- `createOrganicHistoryWriter`
- `D1OrganicHistoryGateway`
- `D1MarketingHistoryStore`
- `runReliableSync`
- D1 incremental checkpoint and resumable work generation fence
- warning outbox, distributed lock, bounded retry and DLQ behavior
- Application-boundary + Connector-adapter pattern used by the existing D1 report source

## Architecture

```text
YouTube Data API / YouTube Analytics API
        ↓
existing identity validation, uploads discovery, pagination and normalization
        ↓
syncYouTubeOrganicEndToEnd
        ↓
YouTubeStorageFirstSyncEngine wrapping Existing TableSyncEngine
        ↓
shared OrganicHistoryWriter / D1MarketingHistoryStore
        ↓
D1 state + cumulative observations + account snapshot + Coverage
        ↓
Existing TableSyncEngine Lark plans after D1 success
        ↓
RAW_YouTube_* + MKT_Accounts + MKT_Content + MKT_Content_Daily
```

The existing YouTube use case builds all six TableSyncEngine plans before executing the first plan. The wrapper captures those plans, performs one D1-first write before the first Lark execution, then delegates every Lark plan to the existing engine. A retry after a partial Lark failure replays the same durable D1 identities and lets TableSyncEngine repair only missing Lark rows.

## Data contracts

### Content current state

```text
content_key = youtube:{account_key}:{video_id}
table       = organic_content_state
```

Availability values:

```text
available | missing | private | deleted | expired | unknown
```

Missing/private/unavailable handling is non-destructive:

- no row deletion;
- no observed metric is overwritten with zero;
- missing metrics remain `null`;
- prior Business facts are preserved;
- an availability-only change is not fabricated as a cumulative metric observation.

### Cumulative observations

```text
observation_key = {content_key}:{observed_at}:{observation_kind}:v1
table           = organic_content_observations
metric_semantics = cumulative
```

`observed_at` uses durable `requestedAt/generation`, so retrying the same Queue operation does not create a second logical observation. Metric decreases continue to use the Shared Writer's `correction` classification.

### Account daily facts

```text
account_daily_key = youtube:{account_key}:{metric_date}
table             = organic_account_daily_facts
metric_semantics  = snapshot
```

Hidden subscriber count is stored as `followers=null`, never as observed zero. Unsupported account metrics remain `null`.

### Coverage

Content:

```text
dataset_key     = organic_content_cumulative
scope_mode      = full_inventory | recent_window
metric_semantics = cumulative
```

Account:

```text
dataset_key     = organic_account_snapshot
scope_mode      = exact_entities
metric_semantics = snapshot
```

Stable IDs:

```text
content_coverage_run_id = coverage:youtube:{operation_digest}
account_coverage_run_id = coverage:youtube-account:{operation_digest}
history_sync_run_id     = history:youtube:{operation_digest}
```

The operation digest uses `workKey + generation + accountKey`. Source watermark input is deterministic and includes sorted Content identities, availability evidence and Channel counters.

## Channel identity, pagination and quota behavior

- configured Channel ID must match the Data API resource exactly;
- when Analytics is enabled, OAuth owner identity must match the same Channel ID;
- uploads playlist is discovered through `channels.list(part=contentDetails)`;
- uploads pagination uses `pageToken`, repeated-token detection and `contentMaxPages`;
- video details use `videos.list(id=...)` in batches of at most 50 IDs;
- ID mode does not send `maxResults`;
- Analytics tracked-video filters are chunked to at most 50 IDs;
- Analytics pagination uses `startIndex`, `maxResults=200` and `analyticsMaxPages`;
- Full reconciliation follows the existing checkpoint/full-sync interval;
- Incremental Coverage is `recent_window` only when the existing checkpoint decision is incremental. Initial or due reconciliation remains `full_inventory` even when the request says incremental.

Error classification remains the existing connector contract:

```text
quotaExceeded                                      permanent / YOUTUBE_QUOTA_EXHAUSTED
rateLimitExceeded, userRateLimitExceeded           transient / bounded shared retry
backendError, HTTP 429, eligible HTTP 5xx           transient / bounded shared retry
identity mismatch, invalid scope/config             permanent
repeated pagination token or pagination hard limit  fail closed
partial Lark write                                  retryable repair through existing core
```

API responsibilities remain separated:

- API key: public YouTube Data API requests;
- OAuth owner credentials: `mine=true` identity and YouTube Analytics;
- customer OAuth: existing Shared Google OAuth Core only.

## Deleted/private/unavailable behavior

- a returned Video resource with `privacyStatus=private` is stored as `private`;
- an ID requested from the uploads scope but omitted by `videos.list` is stored as `missing`;
- an ID absent from a complete uploads inventory is first classified as `missing`, not guessed as deleted;
- `deleted` requires explicit source/operator evidence;
- incremental recent-window sync never marks entities outside the inspected scope missing or deleted;
- Coverage evidence remains separate from Current state and incomplete Coverage is never labeled complete.

## YouTube Analytics storage semantics

YouTube Analytics rows are period facts. This workstream keeps the existing `RAW_YouTube_Analytics_Daily` + Existing TableSyncEngine behavior and does not coerce period facts into `organic_content_observations`, which is approved for cumulative semantics only.

A separate data contract and additive migration are required before introducing a D1 content-period-fact table. No such migration is included here.

## D1 report source

The workstream adds:

```text
Application boundary: loadYouTubeOrganicReportSource
Connector adapter:    D1YouTubeOrganicReportSource
```

The Application layer depends only on `source.load`; it does not query D1 directly. The Connector adapter reads bounded data from:

```text
organic_content_state
organic_content_observations
organic_account_daily_facts
data_coverage_runs
data_coverage_entities
```

Reader behavior:

- deterministic `ROW_NUMBER()` selection per Content/account;
- current, compare and latest pre-period baseline rows for cumulative delta calculation;
- default Content cap 10,000 and hard cap 50,000;
- account cap is independently bounded;
- preserves observed zero, `null` and correction semantics;
- returns normalized Report-engine rows, not fabricated Lark records;
- never scans full historical Lark tables;
- derives `dataStatus` fail-closed from Coverage status, failed rows, expected/observed mismatch and uncovered Content identities.

## Lark targets

When Integration Chat wires the dedicated route and explicitly opens all required gates, the existing TableSyncEngine targets remain:

```text
RAW_YouTube_Channels
RAW_YouTube_Videos
RAW_YouTube_Analytics_Daily
MKT_Accounts
MKT_Content
MKT_Content_Daily
```

No Lark table, field, view, formula, filter or record was changed by this workstream.

## Runtime flags

New dedicated flags, both default false:

```text
MKT_YOUTUBE_END_TO_END_ENABLED=false
MKT_YOUTUBE_LARK_WRITE_ENABLED=false
```

Shared gates reused and expected to remain false until a separate rollout approval:

```text
MKT_CONNECTOR_YOUTUBE_ENABLED=false
MKT_TIME_SERIES_D1_WRITE_ENABLED=false
MKT_SCHEDULE_YOUTUBE_ENABLED=false
MKT_YOUTUBE_ANALYTICS_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
```

Guards:

- dry-run does not require Business-write gates;
- non-dry execution requires the dedicated route gate, shared D1 write gate and dedicated Lark delivery gate;
- D1 succeeds before Existing TableSyncEngine executes the first Lark plan;
- the dedicated router is not wired into the shared Worker entrypoint by this branch;
- flags do not enable Schedule implicitly.

## Retry, lock and DLQ behavior

No new Retry, lock, Queue or DLQ implementation was introduced.

The dedicated route reuses:

- `runReliableSync`;
- existing distributed lock lease and renewal;
- durable `workKey`/generation fencing;
- existing resumable Source phases;
- warning outbox;
- existing retry classification;
- Queue terminal failure and DLQ handling owned by shared routing.

## Idempotency and reconciliation

- Queue retry retains the same durable operation digest;
- Coverage and History IDs are stable across retries;
- Observation key retains the durable operation timestamp;
- D1 UPSERT preserves `first_seen_at`, does not reduce `last_observed_at` and does not zero-fill missing metrics;
- TableSyncEngine reuses stable Lark keys and plan/diff/skip behavior;
- Full inventory emits missing evidence only for a complete inspected scope;
- Analytics reconciliation keeps existing Raw evidence and warning behavior;
- D1 Report read refuses a complete label when Coverage does not reconcile.

## Focused tests added

- D1-first ordering before Lark;
- retry after synthetic Lark partial failure;
- stable Coverage/History IDs and Observation idempotency;
- available/missing/private non-destructive handling;
- hidden subscriber count remains `null`;
- full-vs-incremental Coverage scope follows the existing checkpoint decision;
- uploads playlist pagination;
- `videos.list` ID mode without `maxResults`;
- permanent `quotaExceeded` classification;
- canonical Content/Daily mapping and unsupported metric `null`;
- Report Application boundary;
- deterministic current/compare/baseline D1 reads;
- observed zero, correction and account-null preservation;
- Coverage fail-closed behavior and bounded limits;
- more than the historical 800-Content Lark cap;
- dedicated route, shared D1 and Lark gates default false.

Static syntax checks performed on the intended files in the available execution environment:

```text
node --check packages/application/src/use-cases/sync-youtube-organic-end-to-end.js
node --check packages/application/src/storage/youtube-storage-first-sync-engine.js
node --check packages/application/src/storage/youtube-organic-history-storage.js
node --check packages/application/src/storage/youtube-availability-history-storage.js
node --check packages/application/src/storage/youtube-account-history-storage.js
node --check packages/application/src/reports/load-youtube-organic-report-source.js
node --check packages/connectors/src/youtube/d1-youtube-organic-report-source.js
node --check apps/sync-worker/src/youtube-organic-job-router.js
node --check tests/application/youtube-organic-end-to-end.test.js
node --check tests/application/load-youtube-organic-report-source.test.js
node --check tests/application/youtube-organic-job-routing.test.js
node --check tests/connectors/d1-youtube-organic-report-source.test.js
```

Focused D1 report harness result available during implementation:

```text
5 / 5 PASS
```

The GitHub connector execution environment did not provide a complete local Repository checkout or authenticated `gh`, so these mandatory branch gates remain CI/Integration evidence, not claimed as locally passed:

```text
npm ci
npm run check
npm test
node --test tests/application/youtube-organic-end-to-end.test.js
node --test tests/application/load-youtube-organic-report-source.test.js
node --test tests/application/youtube-organic-job-routing.test.js
node --test tests/connectors/d1-youtube-organic-report-source.test.js
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Draft PR must remain on hold until all required gates pass on the exact reviewed head.

## Remote actions not performed

```text
Cloudflare Worker deployment            NOT RUN
Remote D1 backup or migration apply      NOT RUN
Remote D1 Business write                 NOT RUN
Remote Lark schema/data mutation         NONE
Queue message send                       NOT SENT
DLQ redrive/delete                       NOT RUN
Cron or Schedule enablement              NONE
Google Cloud configuration change        NONE
OAuth Secret/token change                NONE
Production credential use                NONE
Customer or Production LIVE UAT          NOT RUN
PR merge                                 NOT RUN
```

## Integration Chat steps after review

1. Compare/rebase the Draft PR onto the latest `main` and inspect parallel Workstream conflicts.
2. Run all mandatory full gates and focused tests on the exact reviewed head.
3. Review the dedicated router and wire `processYouTubeOrganicEndToEndJob` only in the Integration-owned shared routing file.
4. Add the two dedicated flags to shared configuration/examples/Wrangler with default `false`; reuse the existing shared Storage/Connector/Report flags.
5. Confirm the Remote schema is ready for Storage Foundation `0009`; do not apply TikTok migration `0016` as part of YouTube work.
6. Deploy a safe version with every new and existing execution flag false.
7. Run read-only/dry-run validation with DEV credentials only.
8. Open the shared D1 gate while keeping the dedicated Lark gate false and verify that non-dry execution is blocked before Source work.
9. Open the dedicated Lark gate only for a separately approved controlled DEV UAT; verify D1-first ordering, Coverage, idempotency and Lark reconciliation in one execution.
10. Validate D1 report shadow parity before any D1-primary Report cutover.
11. Keep Schedule disabled until a separate explicit approval.
12. Keep Customer/Production LIVE UAT blocked until Integration Chat opens a new task.

## Shared-file patch proposals

This workstream does not edit reserved files directly. Integration Chat may later apply these proposals:

- import/use `processYouTubeOrganicEndToEndJob` in the shared Worker router;
- add the two dedicated default-false flags to shared runtime config/examples/Wrangler;
- add an optional focused test script in root `package.json` if desired;
- wire the YouTube D1 report source only after shadow parity passes;
- update `docs/current-task.md`, `PROJECT_BRAIN.md`, `README.md` and `CHANGELOG.md` after Integration Review.
