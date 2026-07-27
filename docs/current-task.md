# Current Task — Meta Lark Parity Fast-Track Rollout Operator

## Authoritative status

```text
TASK_STATUS                         = PASS_FOR_MERGE_REVIEW
CURRENT_PROGRAM                     = META_LARK_PARITY_FAST_TRACK
CONTRACT_VERSION                    = meta-lark-parity-rollout-v1
ORIGINAL_BASE_MAIN_SHA              = 025a2f68800d3c4115676c644b28384eacacdc7f
ALIGNED_MAIN_SHA                    = c124e6fdbe27fcd56fb357baef1b4769957748df
ALIGNMENT_PR                        = #130 / MERGED_INTO_FEATURE_BRANCH
ALIGNMENT_MERGE_COMMIT              = 1d2b86f45ae54a7de2c39f7cec41adc78cc28106
BRANCH                              = integration/meta-lark-parity-rollout-operator
DRAFT_PR                            = #131 / OPEN / DRAFT / UNMERGED
VERIFIED_IMPLEMENTATION_HEAD        = c476f4f1044b73ccdfb489afe92d7199afceb872
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

The aligned WooCommerce task is preserved at:

```text
docs/archive/current-task-before-meta-lark-fast-track-after-alignment-2026-07-27.md
```

The preceding Meta D1 closeout remains preserved at:

```text
docs/archive/current-task-before-meta-lark-parity-rollout-2026-07-27.md
```

## Customer-priority objective

ทำให้ Chemistry K เห็นข้อมูล Meta ใน Lark เร็วที่สุดโดยไม่รอให้ D1-only ของทั้งสี่ Target จบก่อน
จึงใช้ Pipeline สองเส้นพร้อมกัน:

```text
Workstream A — D1 per target
facebook → instagram → chemistry_k2 → chemistry_k3

Workstream B — Lark readiness
metadata/table/key preflight now
→ continue each exact operation to Lark immediately after that target passes D1
```

## Runtime fast path

Meta Runtime durably stages Provider data before D1. A D1-only operation stops intentionally at
`lark_gate_disabled`, leaving the exact Work active. The Lark continuation therefore reuses:

- the same operation ID, Work key, generation and original requested timestamp;
- the already staged Provider source units;
- completed D1/Coverage state;
- the existing Lark client, repository and `TableSyncEngine`.

The continuation omits `d1Only=true`, enables the exact Lark gate and requires zero additional Meta
Provider requests. The first target that passes D1 can reach Lark while the next target is still being
prepared.

## Target order

```text
1. facebook
2. instagram
3. chemistry_k2
4. chemistry_k3
```

One target remains one evidence chain. Worker deployment and Queue-send windows are serialized even
when read-only preparation is parallel.

## Lark destination preflight

Validate all 15 shared destinations immediately:

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

Every Table ID must exist and be unique. Every table must contain its exact stable-key Field. The
metadata preflight reads no records and performs no mutation.

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

`lark-preflight` may run before any D1 target. Every later phase is bound to the exact accepted D1
summary for that target.

## Approved flag window

Safe configuration:

```text
all MKT execution flags=false
```

Active target continuation:

```text
selected Meta Connector=true
MKT_META_SOURCE_READ_ENABLED=true
MKT_META_D1_WRITE_ENABLED=true
MKT_META_LARK_WRITE_ENABLED=true
```

Mandatory false:

```text
MKT_META_REPORT_READ_ENABLED=false
all unrelated Connector/Business flags=false
all schedules=false
MKT_DLQ_REDRIVE_ENABLED=false
Production=false
```

## Acceptance

A target passes only when:

- exact D1 summary, operation and Work identity match;
- Provider requests during continuation equal zero;
- D1 Business and Coverage counts are unchanged;
- destination preflight, Lark phase and completion phase are complete;
- every expected Lark row is reconciled as created, updated or skipped;
- Work is completed and no lock remains;
- same-operation rerun leaves reconciliation unchanged;
- all flags are restored false and verified.

## Existing contracts reused

- merged Meta source adapters and durable source staging;
- stable Queue operation and Shared continuation;
- Reliability, locks and resumable Work;
- D1 Organic/Ads writers and Coverage;
- Lark Bitable client, repositories and `TableSyncEngine`;
- merged WooCommerce Lark-preflight, Chatwoot safe-config and TikTok exact-version changes inherited
  from current `main` through PR #130.

No new Connector, Queue framework, Reliability engine, D1 writer, Lark engine, schema, Formula, View,
migration or Schedule is introduced.

## Verification result

The initial exact-head CI exposed one test-only config adapter defect: the first helper matched `=`
while the Worker config is JSONC and uses `:`. The adapter and CLI were corrected to use the same
JSONC string/boolean contract as the merged D1 operator. Runtime continuation semantics were unchanged.

Exact implementation head `c476f4f1044b73ccdfb489afe92d7199afceb872` passed:

```text
META_END_TO_END_VERIFICATION        = #45 / 30291842594 / PASS
BRANCH_VERIFICATION                 = #713 / 30291842621 / PASS
FOCUSED_META_TESTS                  = 15 / 15 PASS
NODE_UNIT_INTEGRATION               = 1117 / 1117 PASS
WORKERS_RUNTIME                     = 12 / 12 PASS
REPORT_RELIABILITY                  = 88 / 88 PASS
DEPENDENCY_AUDIT                    = 0 vulnerabilities
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
META_DIAGNOSTICS_ARTIFACT           = 8663093481
META_ARTIFACT_DIGEST                = sha256:addc9fa012e7a0046716ed0af3c8f09f7e601b67d12adfbdc54d4ee514071e34
BRANCH_DIAGNOSTICS_ARTIFACT         = 8663098052
BRANCH_ARTIFACT_DIGEST              = sha256:03dff2964f4521f699ef418304ae7f3b8b8a56666d1551dfc0466d180bcc2612
REMOTE_ACTION_COUNT                 = 0
```

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

The documentation-only final head must pass Meta End-to-End Verification and Branch Verification once
more. Then perform final diff/review-thread/main-alignment checks before the separately authorized
Squash Merge of PR #131.

After merge, Lark metadata preflight may run immediately in parallel with Facebook D1 plan/read-only
preflight. Repository completion alone authorizes no Remote mutation.
