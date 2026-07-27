# Archived Current Task — Meta D1-only Processing Guarded Rollout Operator

This archive records the reviewed Repository implementation that was Squash Merged through PR #114.

## Authoritative merge facts

```text
TASK_STATUS                         = MERGED_REMOTE_EXECUTION_NOT_AUTHORIZED
CURRENT_PROGRAM                     = META_D1_ONLY_PROCESSING_GUARDED_ROLLOUT
CONTRACT_VERSION                    = meta-d1-only-rollout-v1
MERGED_PR                           = #114
SOURCE_HEAD                         = 0044127bdc55f735e91b8fa02f4db19698a02868
SQUASH_MERGE_COMMIT                 = 50fe71da6dea64e2f0ba04b1067e7e424e2a5451
MERGED_AT                           = 2026-07-27T17:08:35Z
ORIGINAL_BASE_MAIN_SHA              = 7f06ae8729dd24c3bd6f548332bfe17ba374c8ab
FINAL_ALIGNED_MAIN_SHA              = fb16083ec9615944f675b326a69db9ca98d00353
ALIGNMENT_PR_1                      = #115
ALIGNMENT_MERGE_COMMIT_1            = 259da95ccf3b78d92dbc8921f4cbaed4604784be
ALIGNMENT_PR_2                      = #117
ALIGNMENT_MERGE_COMMIT_2            = 12137908000032df6b23263c67a4574907af724c
REMOTE_EXECUTION_AUTHORIZED         = false
REMOTE_ACTIONS                      = NONE
PRODUCTION                          = BLOCKED
```

The implementation inherited the merged YouTube live Remote-contract parser and merge-closeout records
from PRs #113 and #116 without replacing or weakening those contracts.

## Objective delivered

The merged operator supports guarded Chemistry K Meta D1-only processing for exactly one target per
evidence chain:

```text
facebook
instagram
chemistry_k2
chemistry_k3
```

Each target requires a separate operation ID, stable work key, sync-run ID, backup and evidence root.
The operator is plan-only by default and exposes separately confirmed phases:

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

No phase grants permission for a later phase.

## Runtime reuse

The implementation reuses the existing:

- Meta protected manual job router and exact Chemistry K mappings;
- Meta Graph source adapters and token connection runtime;
- Shared stable Queue operation helper and continuation path;
- Reliability runner, D1 lock and generation fencing;
- `D1ResumableWorkStore`;
- `D1MarketingHistoryStore` and `D1OrganicHistoryGateway`;
- Organic History Writer;
- Storage Foundation Migration `0009` and shared Coverage tables.

No new Connector, Graph client, Queue framework, Reliability engine, D1 writer, Coverage engine, Lark
sync engine or migration was created.

## Approved execution window

Safe configuration requires all MKT execution flags false. A target-specific D1-only window permits
exactly:

```text
selected Connector flag=true
MKT_META_SOURCE_READ_ENABLED=true
MKT_META_D1_WRITE_ENABLED=true
```

The following remain false throughout:

```text
MKT_META_LARK_WRITE_ENABLED
MKT_META_REPORT_READ_ENABLED
all unrelated Connector and Business flags
all schedules
MKT_DLQ_REDRIVE_ENABLED
Production
```

## D1-only acceptance boundary

An accepted target execution must prove:

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

The active unfinished Work boundary is intentional while the Lark gate is disabled. It is not full
end-to-end completion and is not a failed D1 run.

One explicit same-operation resend is allowed only after first verification. The rerun must increase
Queue attempts while leaving target Business counts, operation-scoped counts and Coverage counts
unchanged, with no Lark/completion phase and no active lock.

## Final verification

Exact final source head `0044127bdc55f735e91b8fa02f4db19698a02868` passed:

```text
META_END_TO_END_VERIFICATION        = #42 / 30287591901 / PASS
BRANCH_VERIFICATION                 = #682 / 30287592019 / PASS
FOCUSED_META_D1_ONLY_TESTS          = 15 / 15 PASS
NODE_UNIT_INTEGRATION               = 1081 / 1081 PASS
WORKERS_RUNTIME                     = 11 / 11 PASS
REPORT_RELIABILITY                  = 91 / 91 PASS
DEPENDENCY_AUDIT                    = 0 vulnerabilities
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
VERIFICATION_ARTIFACT               = 8661468409
VERIFICATION_ARTIFACT_DIGEST        = sha256:2bd112b3257e62d5da376440cdfd6a2863d6e88e94b72e26e4785cab51fe1c6f
FINAL_COMPARE_AHEAD                 = 24
FINAL_COMPARE_BEHIND                = 0
FINAL_CHANGED_FILES                 = 9
UNRESOLVED_REVIEW_THREADS           = 0
```

## Remote safe state

```text
REMOTE_D1_EXPORT_OR_MUTATION         = NOT_RUN
WORKER_DEPLOYMENT                    = NOT_RUN
META_PROVIDER_REQUEST                = NOT_RUN
QUEUE_MESSAGE                        = NONE
DLQ_ACTION                           = NONE
LARK_PREFLIGHT_OR_WRITE              = NONE
REPORT_CUTOVER                       = NONE
SCHEDULE_ACTIVATION                  = NONE
RETENTION_OR_DELETE                  = NONE
PRODUCTION                           = BLOCKED
```

Squash Merge of PR #114 merged Repository capability only. It authorizes no plan execution, Remote
preflight, backup, deployment, Queue send, D1 Business processing, Lark parity or Production action.
