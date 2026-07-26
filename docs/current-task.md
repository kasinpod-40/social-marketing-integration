# Current Task — TikTok Organic Post-Lark Daily Pipeline & Report D1 Parity

## Authoritative status

```text
TASK_STATUS                         = APPROVED_FOR_IMPLEMENTATION
CURRENT_PROGRAM                     = TIKTOK_ORGANIC_POST_LARK_DAILY_PIPELINE_AND_REPORT_D1_PARITY
APPROVED_DATE                       = 2026-07-26
BASE_COMMIT                         = e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
IMPLEMENTATION_BRANCH               = agent/tiktok-organic-post-lark-d1-parity
ENVIRONMENT                         = development
CUSTOMER_PROFILE                    = integration_workspace
CUSTOMER_KEY                        = chemistry_k
ACCOUNT_KEY                         = chemistry_k
SOURCE_HANDLE                       = chemistry_k
SOURCE                              = lark_native_tiktok_for_creator
LARK_NATIVE_SYNC_TIME               = 07:00 Asia/Bangkok
SNAPSHOT_DATE_CONTRACT              = previous_completed_day
LIVE_RUNTIME_ACTIONS                = PROHIBITED
SCHEDULES                           = DISABLED
RETENTION_DELETE                    = PROHIBITED
PRODUCTION                          = BLOCKED
```

## Objective

Implement a fail-closed TikTok Organic post-Lark pipeline that detects a stable new RAW source
watermark after the existing Lark Native sync, processes D1 and Canonical destinations idempotently,
calculates Daily/Weekly reports from D1 historical observations with Lark shadow parity, and only
admits a report after the corresponding processing and Coverage have completed.

The implementation must reuse the existing TikTok Native connector, Durable source staging,
preflight, D1 Organic history, Canonical Lark writer, Reliability runner, Queue/DLQ contracts and
Report engine. It must not create a second TikTok source connector or a parallel reliability stack.

## Verified starting state

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
Report D1 reader                      not implemented
Report D1 shadow read                 not connected to active handler
TikTok schedule                       disabled
Daily report schedule                 disabled
Production                            blocked
```

These are retained repository/rollout facts. A new Live count or freshness claim requires the
read-only audit operator and external evidence; implementation tests must not fabricate a Live pass.

## Date contract

The Lark Native sync runs at approximately 07:00 Asia/Bangkok and returns the first trusted
cumulative snapshot after the prior calendar day has completed. Scheduled TikTok processing must
therefore write:

```text
metricDate = local scheduled date - 1 day
```

The Daily report uses the same completed day as `periodEnd`. This aligns the 07:00 ingestion cutoff
with the report period and prevents a current-day Snapshot from being excluded by a previous-day
report boundary.

Manual jobs may still provide an explicit approved `metricDate`; the producer must not infer a
current-day date for the scheduled post-Lark path.

## In scope

### 1. Read-only audit

Add a guarded read-only audit path that can inspect, without mutation:

- RAW count, source handles, latest modified instant and deterministic compact watermark;
- duplicate RAW record/content identities and invalid Stable-key inputs;
- D1 State, Observation and Coverage counts plus duplicate/missing relationships;
- Canonical `MKT_Content` and `MKT_Content_Daily` counts and Stable-key gaps;
- latest completed TikTok Coverage and source watermark;
- current Report source mode and configured bounds.

Audit output must be sanitized and must not include captions, raw payloads, credentials, tokens,
Lark cell payloads, customer PII or secret IDs beyond approved non-secret business keys.

### 2. D1 report source

Implement a bounded D1 TikTok Organic report reader over:

- `organic_content_state` for Canonical identity and current metadata available in D1;
- `organic_content_observations` for the latest cumulative observation at period end and the latest
  baseline before the earliest report/compare start;
- `data_coverage_runs` and `data_coverage_entities` for data-status and Coverage proof.

The reader must support more than 800 content identities, preserve `null` versus observed zero,
retain corrections, use deterministic ordering and expose a source summary/watermark.

Lark `MKT_Content` remains a bounded metadata cache for caption/URL/thumbnail hydration only. The
D1 reader must not depend on full Lark history or `MKT_Content_Daily`.

### 3. Shadow parity

Wire the existing fail-closed flags into the active Report handler:

```text
MKT_REPORT_D1_SHADOW_READ_ENABLED
MKT_REPORT_D1_READ_ENABLED
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED
```

Modes:

```text
all false                 Lark primary only
shadow=true               Lark primary + D1 shadow compare; Lark output remains authoritative
read=true                 D1 primary; shadow comparison optional
```

Shadow comparison must verify stable identities, period metrics, data status, baseline coverage,
source snapshot count, top-content rank/IDs and deterministic result digests. Integer and identity
values require exact equality. Floating metrics require an explicit bounded tolerance.

A shadow mismatch must fail closed for a D1 cutover but must not alter the Lark-primary customer
result while the D1 reader flag remains false.

### 4. Watermark-aware admission

Add a read-only RAW probe and deterministic source watermark based on the approved compact source
state. A new Business job may be admitted only when:

- source identity matches Chemistry K exactly;
- two bounded probes of the source produce the same count and watermark;
- the watermark differs from the latest completed checkpoint/admission;
- no same-watermark active or completed work already exists;
- the configured settling interval and bounds are satisfied.

The Work/admission identity must be based on account, source watermark and Snapshot metric date, not
only a Queue message ID. Same-watermark checks are no-op and must not create Business drift.

### 5. Post-processing report admission

After TikTok processing and Coverage complete, create an idempotent Daily report request keyed by:

```text
customer profile + account + report type + period end + formula version + source watermark
```

The report must not be admitted before D1/Canonical processing and Coverage complete. A later
watchdog may retry a missing report request but may not bypass the completion gate.

### 6. Materialization preparation

When `MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=true`, persist deterministic D1 report
materializations through the existing Storage Foundation contract. Retention remains disabled and is
not part of this task.

### 7. Tests and documentation

Add focused Unit/Integration/Workers-runtime coverage for all new contracts, update the Current Task,
Project Brain, README and CHANGELOG, and preserve all existing TikTok/Core/Google Ads behavior.

## Out of scope

- creating another TikTok platform/source connector;
- changing or mutating `RAW_TikTok_Creator_Videos`;
- Lark Schema/View/Formula/Filter changes;
- destructive D1 migrations or deletion/retention;
- Remote D1 mutation from implementation;
- Queue send, DLQ redrive or Recovery execution;
- Worker deployment;
- enabling TikTok, Report or any other Business schedule;
- changing Google Ads closed runtime state;
- Facebook, Instagram, Meta Ads, WooCommerce or Chatwoot runtime implementation;
- Production rollout.

## Safety boundary

During implementation and review:

```text
Deploy                              prohibited
Remote D1 write/migration           prohibited
Lark write/schema mutation          prohibited
Queue message                       prohibited
DLQ redrive/delete                  prohibited
Recovery                            prohibited
Schedule enable                     prohibited
Retention/delete                    prohibited
Production                          blocked
```

All new runtime behavior must remain behind existing or new default-false flags. Storage flags must
not implicitly enable schedules.

## Architecture contract

```text
Lark Native TikTok sync 07:00
→ bounded read-only RAW probes
→ stable new source watermark
→ idempotent TikTok admission
→ existing Durable source staging
→ preflight all Units
→ D1 Observation / State / Coverage
→ Lark MKT_Content / MKT_Content_Daily
→ completed checkpoint
→ idempotent report request
→ D1 primary/shadow report calculation
→ Lark report output
```

The D1 report reader must reuse the current Report calculation and output builders. Do not duplicate
metric formulas or create a second report engine.

## Acceptance criteria

```text
RAW source identity                         exact Chemistry K
RAW watermark                               deterministic and stable
RAW duplicate content identities            0
Same-watermark admission                    no-op
New-watermark admission                     exactly one logical Work
Stale generation                            rejected
RAW → D1 missing keys                       0 in approved Live UAT
D1 State/Observation/Coverage duplicates    0
D1 → MKT_Content missing keys               0 in approved Live UAT
MKT_Content stable-key duplicates           0
MKT_Content_Daily stable-key duplicates     0
Scheduled Snapshot metricDate               previous completed day
Report identities >800                      supported by D1 source
Report D1 reader                             bounded and deterministic
D1/Lark shadow comparison                   exact under parity fixture/UAT
D1 primary cutover                          blocked on mismatch
Report request before processing complete   rejected/no-op
Report request after processing complete    idempotent
Exact rerun                                 zero Business drift
Retention/delete                            disabled
Schedules during Manual UAT                 disabled
Production                                  blocked
```

## Required tests

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

Focused coverage must include:

- RAW watermark determinism, settling and duplicate rejection;
- previous-completed-day schedule date contract;
- same/new watermark admission identities;
- D1 current/baseline selection across more than 800 Content rows;
- null, observed zero and correction semantics;
- Coverage-derived data status;
- Lark/D1 shadow parity and mismatch diagnostics;
- D1-primary fail-closed mode;
- report request/materialization idempotency;
- TikTok resumable/generation/replay regression;
- Google Ads safe-state and router regression.

## Manual LIVE UAT gate

No Live action is authorized by this implementation task. After source review and Branch
Verification pass, a separate bounded rollout plan must be presented for approval. That plan must
start read-only and preserve all schedules as disabled.

Required sequence for the later separately approved rollout:

1. read-only RAW/D1/Canonical audit;
2. manual freshness probe;
3. one new-watermark processing admission;
4. D1/Canonical/Coverage reconciliation;
5. Lark-primary + D1-shadow parity;
6. exact same-watermark rerun with zero drift;
7. D1-primary report validation with rollback to Lark primary;
8. only then propose controlled schedule activation.

## Implementation result

```text
STATUS          = IN_PROGRESS
FILES_CHANGED   = PENDING
COMMANDS_RUN    = GitHub connector inspection only
TESTS           = NOT_RUN
LIVE_VALIDATION = NOT_RUN / PROHIBITED
REMOTE_ACTIONS  = NONE
REMAINING_RISKS = D1/Lark parity and Live freshness require separately approved external validation
```

## Archived predecessor

The completed Google Ads task is preserved at:

```text
docs/archive/current-task-before-tiktok-post-lark-d1-parity-2026-07-26.md
```
