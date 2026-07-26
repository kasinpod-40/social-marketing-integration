# Current Task — TikTok Organic Post-Lark Daily Pipeline & Report D1 Parity

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_REVIEW_PENDING
CURRENT_PROGRAM                     = TIKTOK_ORGANIC_POST_LARK_DAILY_PIPELINE_AND_REPORT_D1_PARITY
APPROVED_DATE                       = 2026-07-26
BASE_COMMIT                         = e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
IMPLEMENTATION_BRANCH               = agent/tiktok-organic-post-lark-d1-parity
DRAFT_PR                            = #65
VERIFIED_HEAD                       = e3c00b93ea95b4a4e564f09cafacc40954b30593
BRANCH_VERIFICATION                 = #517 PASS
ENVIRONMENT                         = development
CUSTOMER_PROFILE                    = integration_workspace
CUSTOMER_KEY                        = chemistry_k
ACCOUNT_KEY                         = chemistry_k
SOURCE_HANDLE                       = chemistry_k
SOURCE                              = lark_native_tiktok_for_creator
LARK_NATIVE_SYNC_TIME               = approximately 07:00 Asia/Bangkok
SNAPSHOT_DATE_CONTRACT              = previous_completed_day
LIVE_RUNTIME_ACTIONS                = PROHIBITED
SCHEDULES                           = DISABLED
RETENTION_DELETE                    = PROHIBITED
PRODUCTION                          = BLOCKED
```

## Objective

Implement a fail-closed TikTok Organic post-Lark pipeline that detects a stable new protected RAW
source watermark after the existing Lark Native sync, processes D1 and Canonical destinations
idempotently, calculates Daily/Weekly reports from D1 historical observations with Lark shadow
parity, and admits a Daily report only after the corresponding processing and Coverage complete.

The implementation reuses the existing TikTok Native connector, Durable source staging, preflight,
D1 Organic history, Canonical Lark writer, Reliability runner, Queue/DLQ contracts and Report engine.
It does not create a second TikTok source connector or a parallel Reliability/Queue/D1/Lark stack.

## Retained verified starting facts

```text
RAW_TikTok_Creator_Videos             approximately 2021 / protected Lark Native source
organic_content_state                 2021
organic_content_observations          2021
data_coverage_entities                2021
D1 duplicate state groups             0
D1 duplicate observation groups       0
MKT_Content last verified             22
MKT_Content_Daily last verified       208
Report primary reader                 Lark MKT_Content + MKT_Content_Daily
Report content limit                  800
Report D1 reader                      not implemented before this branch
Report D1 shadow read                 not connected before this branch
TikTok schedule                       disabled
Daily report schedule                 disabled
Production                            blocked
```

These are retained repository/rollout facts. Any new Live count, freshness, Coverage or parity claim
requires the guarded read-only audit and separately approved external validation. Tests and fixtures
must not be described as a Live pass.

## Date contract

The Lark Native sync at approximately 07:00 Asia/Bangkok is treated as the first trusted cumulative
snapshot after the preceding local calendar day has completed. Scheduled post-Lark processing writes:

```text
metricDate = local scheduled date - 1 day
```

Daily Report uses the same completed date as `periodEnd`. Manual jobs may provide an explicit approved
`metricDate`; the scheduled producer must not infer the current local day.

## Implemented scope

### 1. Guarded read-only audit

Added GET-only operator path:

```text
/operator/tiktok/post-lark-audit
```

The route requires a default-false audit flag, bearer operator authentication and the Integration
Workspace identity. It has no Queue or write capability and returns only sanitized counts, identities,
watermarks and cross-layer gaps for:

- protected `RAW_TikTok_Creator_Videos`;
- D1 State, Observation, Coverage and Coverage entities;
- Canonical `MKT_Content` and `MKT_Content_Daily`;
- latest completed Coverage/watermark and active Report source mode.

It excludes captions, RAW payloads, Lark cell payloads, credentials, tokens and unapproved identity.

### 2. Deterministic RAW watermark

Added bounded read-only source probing with:

- exact Chemistry K account/source-handle validation;
- deterministic compact watermark;
- bounded pagination and repeated-cursor rejection;
- duplicate source record/content identity rejection;
- invalid Stable-key input rejection;
- two-probe settling requiring identical count, maximum modified instant and watermark.

The compact watermark uses only approved identity/hash state and does not retain Caption or RAW body.

### 3. Durable watermark admission

Added additive Migration:

```text
migrations/0016_tiktok_post_lark_pipeline.sql
```

It defines `tiktok_source_admissions` with stable admission/work uniqueness and lifecycle checks.
Admission identity is based on Customer/Account, source watermark and Snapshot metric date. A repeated
same-watermark active/completed admission is a no-op and does not create Business drift.

Migration 0016 exists in source only. It has not been applied remotely.

### 4. Staged source-watermark fence

The admitted Queue job retains the original generation and Work identity. Before the first Business
write, the exact Durable staged dataset is hashed and compared with the admitted source watermark.
A mismatch is Permanent and fail-closed.

### 5. D1-first processing and Canonical delivery

The implementation reuses the existing staged TikTok processor and hooks:

```text
Durable source staging
→ full-unit preflight
→ Observation
→ Current State
→ Coverage
→ existing Canonical MKT_Content / MKT_Content_Daily writer
```

It preserves existing stable keys, idempotent upsert, generation fence, retry, lock, DLQ and
partial-write semantics. No second D1 writer or Lark sync engine was introduced.

### 6. D1 TikTok Organic Report source

Added a bounded deterministic D1 reader over:

- `organic_content_state`;
- `organic_content_observations`;
- `data_coverage_runs`;
- `data_coverage_entities`.

It supports more than 800 Content identities, preserves missing metric `null`, observed zero and
negative corrections, and selects current/compare/baseline observations deterministically.

D1 is the historical metric authority. Lark `MKT_Content` is used only as a bounded metadata cache for
top-ranked Caption/URL/thumbnail hydration.

### 7. Lark/D1 shadow parity and D1-primary gate

The active Report route now honors the existing default-false storage controls:

```text
MKT_REPORT_D1_SHADOW_READ_ENABLED
MKT_REPORT_D1_READ_ENABLED
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED
```

Modes:

```text
all false                 existing Lark-only behavior
shadow=true               Lark authoritative + D1 diagnostic comparison
read=true                 D1 historical metric source
read=true + shadow=true   D1 cutover blocked by any parity mismatch
```

Parity compares identities, current and comparison metrics, Data status, baseline Coverage, source
Snapshot count, top-content rank/IDs and deterministic digests. Integers/identities require exact
equality; floating values use an explicit bounded tolerance.

D1 primary also requires completed Coverage, zero failed rows and zero current Content identities
missing an observed Coverage entity.

### 8. Coverage-gated post-processing report admission

When the post-process flag is enabled, the Daily report request is created only after processing
success and a fresh durable Coverage re-read proves:

- Coverage status is complete;
- expected and observed entity counts match;
- failed rows equal zero;
- Coverage source watermark equals the admitted RAW watermark.

The request identity includes Customer/Profile/Account, report type, period end, formula version and
source watermark. Claim, retry, completion and replay are idempotent.

### 9. Scheduler safety

The Primary Cron now emits a read-only TikTok watermark probe rather than a blind Business sync.
Scheduled TikTok processing requires watermark admission to be explicitly enabled. The producer uses
the previous completed local day for `metricDate`.

The scheduler rejects simultaneous use of post-processing Daily report admission and the independent
Daily report schedule, preventing duplicate Daily producers.

### 10. Default-false controls

```text
MKT_TIKTOK_AUDIT_HTTP_ENABLED=false
MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED=false
MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
MKT_SCHEDULE_TIKTOK_ENABLED=false
MKT_SCHEDULE_DAILY_REPORT_ENABLED=false
MKT_LARK_DAILY_RETENTION_ENABLED=false
```

Storage/report flags do not implicitly enable schedules.

## Architecture contract

```text
Lark Native TikTok sync approximately 07:00
→ bounded read-only RAW probes
→ stable new source watermark
→ durable same-watermark admission
→ existing Durable source staging
→ exact staged-watermark fence
→ full-unit preflight
→ existing D1 Observation / State / Coverage
→ existing Canonical Lark writer
→ completed Coverage re-read
→ idempotent report request
→ Lark-primary + D1-shadow or D1-primary Report calculation
→ bounded Lark metadata hydration
→ existing Lark Report output
→ optional deterministic D1 materialization
```

## Out of scope and safety boundary

This implementation did not authorize or perform:

```text
Remote D1 backup or Migration 0016 apply    NOT RUN
Worker deployment                           NOT RUN
Queue message                               NOT SENT
DLQ redrive/delete                          NOT RUN
Recovery                                    NOT RUN
Remote Lark schema/data mutation            NONE
Remote D1 Business mutation                 NONE
Schedule enablement                         NONE
Retention/delete                            NONE
LIVE UAT                                    NOT RUN
Production                                  BLOCKED
Google Ads runtime-state change             NONE
```

Facebook, Instagram, Meta Ads, YouTube, WooCommerce and Chatwoot implementation are separate
Workstreams and are not part of this task.

## Repository acceptance result

```text
RAW watermark determinism                   PASS by focused tests
RAW duplicate/invalid identity rejection    PASS by focused tests
Two-read settling                           PASS by focused tests
Same-watermark admission no-op              PASS by focused tests
New-watermark logical admission             PASS by focused tests
Stale/admission identity conflict            PASS by focused tests
Staged source-watermark mismatch            PASS by focused tests
Previous-completed-day schedule contract    PASS by Unit and Worker runtime tests
D1 identities above 800                     PASS by connector tests
Null / observed zero / correction           PASS by connector/report tests
Coverage-derived data status                PASS by application tests
Lark/D1 parity and mismatch diagnostics     PASS by report tests
D1-primary fail-closed gate                 PASS by report tests
Report request/materialization idempotency  PASS by application/connector tests
TikTok resumable/generation/replay          PASS by focused regression
Google Ads safe-state/router regression     PASS by full suite
Remote RAW→D1 reconciliation                PENDING separate approved LIVE UAT
Remote D1→Canonical reconciliation          PENDING separate approved LIVE UAT
Remote exact rerun zero drift               PENDING separate approved LIVE UAT
```

## Verification evidence

Branch Verification run `#517` passed on reviewed head
`e3c00b93ea95b4a4e564f09cafacc40954b30593`:

```text
Install locked dependencies          PASS
Syntax / architecture / hygiene      PASS
Focused staged TikTok tests          4 / 4 PASS
Node Unit / Integration tests        868 / 868 PASS
Workers runtime tests                9 / 9 PASS
Report reliability regression        91 / 91 PASS
Dependency audit                     0 vulnerabilities
Wrangler deployment dry-run          PASS / no deployment
Diagnostics upload                   PASS
```

Two stale regression fixtures were corrected during review so they now assert the approved watermark
probe producer and previous-completed-day contract rather than the removed blind scheduled sync.

## Implementation result

```text
STATUS          = IMPLEMENTATION_COMPLETE_REVIEW_PENDING
DRAFT_PR        = #65
VERIFIED_HEAD   = e3c00b93ea95b4a4e564f09cafacc40954b30593
TESTS           = PASS / Branch Verification #517
LIVE_VALIDATION = NOT RUN / PROHIBITED BY THIS TASK
REMOTE_ACTIONS  = NONE
REMAINING_RISKS = Remote schema readiness, Live source freshness, Coverage reconciliation and
                  Lark/D1 parity require a separately approved guarded rollout
```

## Next separate approval gate

No Live action is authorized by this implementation closeout. A later rollout must remain bounded,
manual and schedule-disabled in this order:

1. read-only Remote configuration and schema preflight;
2. Remote D1 backup;
3. additive Migration 0016 apply;
4. flags-false Worker deployment and route smoke;
5. guarded read-only RAW/D1/Canonical audit;
6. manual freshness probe;
7. one new-watermark admission;
8. D1/Canonical/Coverage reconciliation;
9. Lark-primary + D1-shadow parity;
10. exact same-watermark rerun with zero Business drift;
11. D1-primary Report validation with immediate rollback path to Lark primary;
12. only then propose controlled schedule activation.

## Archived predecessor

The completed Google Ads task remains preserved at:

```text
docs/archive/current-task-before-tiktok-post-lark-d1-parity-2026-07-26.md
```
