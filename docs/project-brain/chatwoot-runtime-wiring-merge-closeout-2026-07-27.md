# Chatwoot Runtime Wiring — Merge Closeout — 2026-07-27

## Merge result

```text
PR                                  = #97
TITLE                               = feat: integrate guarded Chatwoot analytics
SOURCE_HEAD                         = ff1ea87472fced8a48c2551d66a100d2b59220fc
MERGED_MAIN_SHA                     = 91ab3c6d153aa8e3e1188a5a5df75ad1b5b8ce19
MERGE_METHOD                        = SQUASH
MERGED_AT                           = 2026-07-27T14:15:29Z
```

PR #97 passed exact-head Branch Verification before merge and entered `main` without a direct push.
The merged implementation remains guarded and manual-only.

## Merged architecture

- Chatwoot is the top-level Queue route and falls back to the existing WooCommerce, YouTube,
  Google Ads, Meta and TikTok/report chain.
- The Connector and Queue Job remain `uat_pending` and `manualOnly`.
- Stable operation identity is `chatwoot:<accountKey>:<operationId>`.
- Deterministic `syncRunId`, original request time and generation are preserved through completion
  and replay.
- Shared Reliability, Queue/DLQ, distributed lock, generation fence, resumable work, D1 Coverage,
  checkpoint, Lark repository and `TableSyncEngine` contracts are reused.
- D1 state/facts complete before optional Lark writes; Coverage completes before checkpoint advance.
- Migration `0018_chatwoot_analytics.sql` is additive and PII-minimized.

## Verification evidence

```text
FINAL_SOURCE_HEAD                   = ff1ea87472fced8a48c2551d66a100d2b59220fc
BRANCH_VERIFICATION_RUN             = 30265965959 / #655 / PASS
NODE_TESTS                          = 1050 / 1050 PASS on aligned code head
WORKERS_RUNTIME                     = 11 / 11 PASS
REPORT_RELIABILITY                  = 91 / 91 PASS
CHATWOOT_NAMED_TESTS                = 38 / 38 PASS
DEPENDENCY_AUDIT                    = 0 vulnerabilities
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
FINAL_ARTIFACT                      = 8652808933
FINAL_ARTIFACT_DIGEST               = sha256:ff256e79e412b5cd9629fff2cb12260464b82f97010412606ad25ba4c91be18c
```

## Remote safe state after merge

```text
MIGRATION_0017                      = APPLIED_OUTSIDE_WORKSTREAM / DO_NOT_RERUN
MIGRATION_0018_REMOTE_APPLY         = NOT_RUN
CHATWOOT_PROVIDER_REQUEST           = NOT_RUN
CUSTOMER_TOKEN_ACCESS               = NOT_RUN
REMOTE_D1_CHATWOOT_MUTATION         = NONE
REMOTE_LARK_MUTATION                = NONE
QUEUE_OR_DLQ_ACTION                 = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE_OR_WEBHOOK                 = DISABLED
CUSTOMER_OR_PRODUCTION_LIVE_UAT     = NOT_RUN
PRODUCTION                          = BLOCKED
```

The merge authorizes no Remote phase. Any schema apply, credential preflight, guarded Provider read,
Worker deployment, Queue execution, Lark parity test, LIVE UAT or Production action requires a new
Integration-owned task and explicit authorization.
