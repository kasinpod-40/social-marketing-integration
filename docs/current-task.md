# Current Task — Meta D1-only Processing Guarded Rollout Operator

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_PASS_DRAFT_PR_OPEN
CURRENT_PROGRAM                     = META_D1_ONLY_PROCESSING_GUARDED_ROLLOUT
CONTRACT_VERSION                    = meta-d1-only-rollout-v1
BASE_MAIN_SHA                       = 7f06ae8729dd24c3bd6f548332bfe17ba374c8ab
BRANCH                              = integration/meta-d1-only-rollout-operator
DRAFT_PR                            = #114
VERIFIED_IMPLEMENTATION_HEAD        = e667a1b9141a8a472157ed94d693ab0b50be90b2
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

Operator รองรับ Backup, exact deployment provenance, one initial Queue operation,
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

## Implemented scope

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
- runbook, task contract and durable Project Brain record

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
Lark sync engine or migration was created

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

## Verification result

The first exact-head CI attempt exposed one test-only defect: a normalized camelCase D1 snapshot was
normalized a second time by the completion classifier. The runtime contract was unchanged. The
normalizer was made idempotent and both verification workflows then passed on exact head
`e667a1b9141a8a472157ed94d693ab0b50be90b2`.

```text
META_END_TO_END_VERIFICATION        = #31 / 30284509274 / PASS
BRANCH_VERIFICATION                 = #670 / 30284508692 / PASS
FOCUSED_META_D1_ONLY_TESTS          = 15 / 15 PASS
NODE_UNIT_INTEGRATION               = 1075 / 1075 PASS
WORKERS_RUNTIME                     = 11 / 11 PASS
REPORT_RELIABILITY                  = 91 / 91 PASS
DEPENDENCY_AUDIT                    = 0 vulnerabilities
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
VERIFICATION_ARTIFACT               = 8660233416
VERIFICATION_ARTIFACT_DIGEST        = sha256:ddfd07495533887a07f83cf9e0e39eb5415bc038c1ee070a3b413f0d04eaa237
REMOTE_ACTION_COUNT                 = 0
```

## Out of scope and safe state

```text
Remote execution during Implementation     NOT_RUN
Remote D1 export or mutation                NOT_RUN
Worker deployment                           NOT_RUN
Provider request                            NOT_RUN
Queue message                               NONE
DLQ action                                  NONE
Lark preflight/write                        NONE
Report cutover/materialization              NONE
Schedule activation                         NONE
Retention/delete                            NONE
Production                                  BLOCKED
PR merge                                    NOT_AUTHORIZED
```

## Remaining gate

Draft PR #114 remains open and unmerged. Review and merge require separate approval. After merge,
refresh exact `main`, Worker version, D1 migration ledger, Queue topology and sanitized read-only
summary before separately authorizing the first target's plan/preflight. Backup, deployment, Queue
send and D1 Business writes remain unauthorized by this implementation result
