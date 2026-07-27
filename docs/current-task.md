# Current Task — Meta Lark Parity Fast-Track Rollout Operator

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = META_LARK_PARITY_FAST_TRACK
CONTRACT_VERSION                    = meta-lark-parity-rollout-v1
BASE_MAIN_SHA                       = 025a2f68800d3c4115676c644b28384eacacdc7f
BRANCH                              = integration/meta-lark-parity-rollout-operator
META_PROVIDER_VALIDATION            = PASS / 4 TARGETS
META_D1_OPERATOR                    = MERGED / REMOTE_NOT_RUN
REMOTE_EXECUTION_AUTHORIZED         = false
REMOTE_ACTIONS                      = NONE
REMOTE_D1_MUTATION                  = NONE
QUEUE_OR_DLQ_ACTION                 = NONE
LARK_MUTATION                       = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

The preceding Meta D1-only rollout closeout is preserved at:

```text
docs/archive/current-task-before-meta-lark-parity-rollout-2026-07-27.md
```

## Customer-priority objective

ทำให้ Chemistry K เห็นข้อมูล Meta ใน Lark เร็วที่สุดโดยไม่รอให้ D1-only ของทั้งสี่ Target จบก่อน
จึงแยกงานเป็นสองเส้นที่ทำพร้อมกัน:

```text
Workstream A — D1 per target
facebook → instagram → chemistry_k2 → chemistry_k3

Workstream B — Lark readiness
metadata/table/key preflight now
→ continue each exact operation to Lark immediately after that target passes D1
```

## Runtime fast path

Meta Runtime durably stages Provider source data before D1. A D1-only operation intentionally stops at
`lark_gate_disabled`, leaving the same Work active. The Lark continuation therefore reuses:

- the same operation ID, Work key, generation and requested timestamp;
- the already staged Provider source units;
- the completed D1 and Coverage phases;
- the existing Lark `TableSyncEngine` and stable-key plans.

The continuation omits `d1Only=true`, enables the exact Lark gate and does not require another Meta
Provider read. The first target that passes D1 may reach Lark while the next target is still running D1.

## Target order

```text
1. facebook
2. instagram
3. chemistry_k2
4. chemistry_k3
```

One target remains one evidence chain. Do not combine account identities or operations.

## Lark destinations

Metadata preflight validates all shared Meta destinations now:

```text
RAW_Meta_Organic_Accounts
RAW_Meta_Organic_Content
RAW_Meta_Organic_Metrics
RAW_Ads_Entities
RAW_Ads_Daily
MKT_Accounts
MKT_Account_Daily
MKT_Content
MKT_Content_Daily
MKT_Ads_Accounts
MKT_Ads_Campaigns
MKT_Ads_AdGroups
MKT_Ads_Ads
MKT_Ads_Creatives
MKT_Ads_Daily
```

Every Table ID must exist and be unique. Every destination must contain its exact stable-key Field.
The metadata preflight reads no records and performs no Lark mutation.

## Operator phases

```text
plan
lark-preflight

d1-ready
→ deploy-safe-baseline
→ verify-safe-baseline
→ deploy-lark-gates
→ verify-lark-deployment
→ snapshot-before
→ send-lark-continuation
→ verify-lark
→ resend-same-operation
→ verify-idempotent-rerun
→ restore-all-false
→ verify-restore
→ summary
```

`lark-preflight` may run before any D1 target. Every later phase is target-bound and begins only after
that exact target's accepted D1-only summary exists.

## Approved active flag window

Safe configuration:

```text
all MKT execution flags=false
```

Target Lark continuation configuration:

```text
selected Meta Connector=true
MKT_META_SOURCE_READ_ENABLED=true
MKT_META_D1_WRITE_ENABLED=true
MKT_META_LARK_WRITE_ENABLED=true
```

Mandatory false throughout:

```text
MKT_META_REPORT_READ_ENABLED=false
all unrelated Connector/Business flags=false
all schedules=false
MKT_DLQ_REDRIVE_ENABLED=false
Production=false
```

## Acceptance

A target passes Lark only when:

- D1 Business and Coverage counts are unchanged from the accepted D1-only snapshot;
- destination preflight, Lark phase and completion phase are complete;
- every expected Lark row is accounted as created, updated or skipped;
- Work is completed and no lock remains;
- a same-operation rerun adds a Queue attempt without changing reconciliation;
- all flags are restored false and verified;
- Provider request count during Lark continuation is zero.

## Implementation scope

- guarded Meta Lark rollout contract and CLI;
- metadata-only Lark preflight;
- exact D1 summary/readiness gate;
- safe/active Worker deployment verification;
- same-operation Queue continuation;
- Lark parity/reconciliation and rerun verification;
- all-false restore;
- evidence chaining, redaction, tests and runbook.

No new Connector, Provider client, Queue framework, Reliability runner, D1 writer, Lark client,
`TableSyncEngine`, schema, Formula, View or migration is created.

## Remote safe state during implementation

```text
Cloudflare/D1 commands             NOT_RUN
Worker deployment                  NOT_RUN
Queue messages                     NONE
Meta Provider requests             NONE
Lark metadata requests             NOT_RUN
Lark record writes                 NONE
Schedule activation               NONE
Production                        BLOCKED
```

## Required next gate

Complete Repository implementation, exact-head CI and Integration review. Repository completion alone
does not authorize Remote execution. After merge, `lark-preflight` can run in parallel with Facebook
D1 plan/preflight, then each D1-complete target can continue into Lark immediately.
