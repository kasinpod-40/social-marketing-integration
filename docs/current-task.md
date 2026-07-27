# Current Task — Meta D1-only Processing Guarded Rollout Operator

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = META_D1_ONLY_PROCESSING_GUARDED_ROLLOUT
CONTRACT_VERSION                    = meta-d1-only-rollout-v1
BASE_MAIN_SHA                       = 7f06ae8729dd24c3bd6f548332bfe17ba374c8ab
BRANCH                              = integration/meta-d1-only-rollout-operator
META_PROVIDER_VALIDATION            = PASS / 4 TARGETS
REMOTE_EXECUTION_AUTHORIZED         = false
REMOTE_ACTIONS                      = NONE
REMOTE_D1_MUTATION                  = NONE
QUEUE_OR_DLQ_ACTION                 = NONE
LARK_MUTATION                       = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

The prior Chatwoot merge closeout is preserved verbatim at:

```text
docs/archive/current-task-before-meta-d1-only-rollout-operator-2026-07-27.md
```

## Objective

สร้าง Guarded rollout operator สำหรับทดสอบ Chemistry K Meta แบบ D1-only ทีละ Source หลัง
read-only identity/permission validation ผ่านครบ โดย reuse Meta Runtime, Shared Queue,
Reliability, resumable work, D1 History และ Coverage contracts เดิมทั้งหมด

Operator ต้องรองรับ Backup, exact deployment provenance, one initial Queue operation,
Shared continuation completion, D1/Coverage reconciliation, same-operation idempotent rerun และ
all-flags-false restore โดยห้าม Lark, Report, Schedule และ Production

## Approved targets

```text
facebook
instagram
chemistry_k2
chemistry_k3
```

หนึ่ง Evidence chain เลือกได้เพียง Target เดียว แต่ละ Target ต้องใช้ operationId, workKey,
syncRunId, Backup และ Evidence root แยกกัน

## In scope

- contract `meta-d1-only-rollout-v1`;
- plan-only default;
- exact confirmation per executable phase;
- exact reviewed Git HEAD and clean Working Tree;
- bind sanitized Meta read-only summary into target fingerprint;
- validate Safe configuration with all execution flags false;
- derive temporary Active config with exactly selected Connector + Meta source-read + Meta D1-write;
- local Safe/Active Wrangler dry-run bundle fingerprints;
- exact Worker active version and Queue topology verification;
- required Worker Secret-name-only verification;
- read-only D1 schema and operation freshness checks;
- checksum-verified Remote D1 export phase;
- Safe deployment, D1-only active deployment and guarded all-false restore;
- central stable Queue operation body with `trigger=manual_uat` and `d1Only=true`;
- one initial Queue send with pre-send attempt evidence;
- bounded D1/Coverage completion verification;
- one same-operation rerun and zero-drift verification;
- SHA-256 evidence chain and secret-shaped field redaction;
- focused regression tests, runbook and durable architecture record

## Existing contracts reused

- Meta protected active job router;
- exact Chemistry K Facebook/Instagram/Ads mappings;
- Meta Graph runtime and source adapters;
- `createStableQueueOperationBody()`;
- Shared Queue continuation and DLQ ownership;
- `runReliableSync()` and D1 lock;
- `D1ResumableWorkStore`;
- `D1MarketingHistoryStore`;
- `D1OrganicHistoryGateway`;
- Organic History Writer;
- Storage Foundation Migration `0009`;
- existing D1 Coverage tables

No new Connector, Graph client, Queue framework, Reliability runner, D1 writer, Coverage engine,
Lark sync engine or migration is authorized

## D1-only success boundary

Accepted execution must prove:

```text
sync_runs.status=success
meta_end_to_end_d1_write_v1.complete=1
Coverage run count > 0
Coverage failed_rows=0
Coverage status in complete | no_data_confirmed | revisable
no meta_end_to_end_lark_write_v1 phase
no meta_end_to_end_completion_v1 phase
no active lock
sync_work_runs.lifecycle_status=active
sync_work_runs.completed_at=NULL
```

This is the intentional `lark_gate_disabled` boundary. It is not full end-to-end completion and must
not be marked failed merely because Work is intentionally left active for a later Lark gate

## Approved flag window

Safe configuration:

```text
all MKT execution flags=false
```

Active configuration:

```text
selected Connector flag=true
MKT_META_SOURCE_READ_ENABLED=true
MKT_META_D1_WRITE_ENABLED=true
```

Mandatory false throughout:

```text
MKT_META_LARK_WRITE_ENABLED=false
MKT_META_REPORT_READ_ENABLED=false
all unrelated Connector/Business flags=false
all schedules=false
MKT_DLQ_REDRIVE_ENABLED=false
Production=false
```

## Operator phases

```text
plan
preflight
backup
deploy-safe-baseline
verify-safe-baseline
deploy-d1-only-gates
verify-d1-only-deployment
snapshot-before
send-one-d1-only
verify-d1-only
resend-same-operation
verify-idempotent-rerun
restore-all-false
verify-restore
summary
```

## Idempotency acceptance

The same exact stable operation may be sent one additional time only after first verification.
Rerun must show:

- Queue attempt increased;
- target Business counts unchanged;
- operation-scoped Business counts unchanged;
- Coverage run/entity counts unchanged;
- no Lark/completion phase;
- no active lock

## Out of scope

```text
Remote execution during Implementation
Remote D1 export or mutation
Worker deployment
Queue message
DLQ action
Lark preflight/write
Report cutover/materialization
Schedule activation
Retention/delete
Production
PR merge
```

## Acceptance criteria

- exact one-target chain;
- exact read-only summary prerequisite;
- exact three-flag active config window;
- local config drift fails closed;
- stable Queue identity uses Shared helper;
- D1/Coverage success boundary is explicit and tested;
- Lark/full-completion phase fails closed;
- same-operation rerun detects Business/Coverage drift;
- evidence hashing and tamper rejection;
- guarded restore can be opened from latest activation evidence;
- Tokens, Authorization headers, raw config and raw Provider payload never enter Evidence;
- all required verification gates pass;
- Remote action count remains zero during implementation

## Required verification

```text
npm ci
node --test tests/application/meta-d1-only-rollout-operator.test.js
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

## Implementation result

```text
IMPLEMENTATION_RESULT               = PENDING_VERIFICATION
FOCUSED_META_D1_ONLY_TESTS          = NOT_RUN
NODE_UNIT_INTEGRATION               = NOT_RUN
WORKERS_RUNTIME                     = NOT_RUN
REPORT_RELIABILITY                  = NOT_RUN
DEPENDENCY_AUDIT                    = NOT_RUN
WRANGLER_DRY_RUN                    = NOT_RUN
REMOTE_ACTION_COUNT                 = 0
```

## Remaining gate

Finish exact-head Branch Verification, inspect the complete diff and open a Draft PR. Review/merge
and every Remote phase require separate explicit approval. This task authorizes no Backup, Deploy,
Queue send or D1 Business write
