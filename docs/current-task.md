# Current Task — Chatwoot Runtime Wiring Merge Closeout

## Authoritative status

```text
TASK_STATUS                         = MERGED_REMOTE_INTEGRATION_NOT_AUTHORIZED
CURRENT_PROGRAM                     = CHATWOOT_INTEGRATION_RUNTIME_WIRING
MERGED_PR                           = #97
SOURCE_HEAD                         = ff1ea87472fced8a48c2551d66a100d2b59220fc
MERGED_MAIN_SHA                     = 91ab3c6d153aa8e3e1188a5a5df75ad1b5b8ce19
MERGE_METHOD                        = SQUASH
MERGED_AT                           = 2026-07-27T14:15:29Z
FOUNDATION_PR                       = #68 / MERGED
MIGRATION_0017                      = APPLIED_OUTSIDE_WORKSTREAM / DO_NOT_RERUN
MIGRATION_0018                      = SOURCE_ONLY / NOT_APPLIED
REMOTE_ACTION_AUTHORIZED            = false
REMOTE_ACTIONS                      = NONE
PRODUCTION                          = BLOCKED
```

The completed implementation task is archived at:

```text
docs/archive/chatwoot-runtime-wiring-merged-current-task-2026-07-27.md
```

Technical contracts and durable project records remain in:

```text
docs/tasks/chatwoot-end-to-end.md
docs/tasks/chatwoot-integration-wiring.md
docs/project-brain/chatwoot-foundation-merge-closeout-2026-07-27.md
docs/project-brain/chatwoot-runtime-wiring-2026-07-27.md
docs/project-brain/chatwoot-runtime-wiring-merge-closeout-2026-07-27.md
```

## Merge result

PR #97 passed exact-head Branch Verification and was Squash Merged into `main`. No direct push to
`main` occurred.

```text
PR_STATE                            = CLOSED
PR_MERGED                           = true
FINAL_SOURCE_HEAD                   = ff1ea87472fced8a48c2551d66a100d2b59220fc
SQUASH_MERGE_COMMIT                 = 91ab3c6d153aa8e3e1188a5a5df75ad1b5b8ce19
BRANCH_VERIFICATION                 = #655 / 30265965959 / PASS
FINAL_DIAGNOSTICS_ARTIFACT          = 8652808933
FINAL_ARTIFACT_DIGEST               = sha256:ff256e79e412b5cd9629fff2cb12260464b82f97010412606ad25ba4c91be18c
```

## Merged repository scope

- Additive `migrations/0018_chatwoot_analytics.sql` with 14 PII-minimized tables and indexes.
- Strict fail-closed Chatwoot config; Provider identity and Token are not read while Connector is
  disabled.
- Chatwoot Connector and Queue Job remain protected `uat_pending` and `manualOnly`.
- Stable account-scoped Queue identity: `chatwoot:<accountKey>:<operationId>`.
- Exact operation identity, generation, original request time and deterministic `syncRunId` are
  preserved through completion and replay.
- Shared Reliability, Queue/DLQ, distributed lock, generation fence, resumable work, D1 Coverage,
  checkpoint, Lark repository and `TableSyncEngine` contracts are reused.
- D1 state/facts finish before optional Lark writes; Coverage completes before checkpoint advance.
- Fifteen logical Chatwoot Lark table keys are registered without Remote Base mutation.

Locked route order:

```text
Chatwoot
→ WooCommerce
→ YouTube
→ Google Ads
→ Meta
→ TikTok / reports / active fallback
```

## Default-false controls

```text
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

## Verification result

```text
ALIGNED_CODE_HEAD                   = c44b1b2247b3374d95022eef01317f77c7e0eca0
FOCUSED_TIKTOK                      = 4 / 4 PASS
NODE_UNIT_INTEGRATION               = 1050 / 1050 PASS
WORKERS_RUNTIME                     = 11 / 11 PASS
REPORT_RELIABILITY                  = 91 / 91 PASS
CHATWOOT_NAMED_TESTS                = 38 / 38 PASS
DEPENDENCY_AUDIT                    = 0 vulnerabilities
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
EXACT_FINAL_HEAD_VERIFICATION       = #655 / PASS
```

## Remote safe state

```text
CHATWOOT_PROVIDER_API_REQUEST       = NOT_RUN
CUSTOMER_TOKEN_ACCESS_OR_ROTATION   = NOT_RUN
REMOTE_D1_QUERY_BACKUP_0018_APPLY   = NOT_RUN
REMOTE_CHATWOOT_BUSINESS_MUTATION   = NONE
REMOTE_LARK_SCHEMA_DATA_MUTATION    = NONE
QUEUE_SEND_RETRY_DLQ_ACTION         = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE_WEBHOOK_ACTIVATION         = NONE
CUSTOMER_PRODUCTION_LIVE_UAT        = NOT_RUN
PRODUCTION                          = BLOCKED
```

## Required next gate

The next Chatwoot phase must be opened as a new Integration-owned task. Before any action it must
refresh `main`, open PRs and the migration ledger, then separately authorize the intended phase.
Potential phases include Remote read-only preflight, Migration `0018` backup/apply/readback, exact
Lark schema mapping, guarded Provider identity/permission preflight, state-only D1 UAT, optional Lark
parity UAT and later full-snapshot reporting UAT.

This merge closeout authorizes none of those phases. Schedule and Webhook remain disabled until
reconciliation, rollback and operator verification pass.
