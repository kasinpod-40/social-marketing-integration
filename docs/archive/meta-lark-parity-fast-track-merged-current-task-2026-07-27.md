# Meta Lark Parity Fast-Track Rollout — Merged Task Archive

## Authoritative result

```text
TASK_STATUS                         = MERGED_REMOTE_EXECUTION_NOT_AUTHORIZED
CURRENT_PROGRAM                     = META_LARK_PARITY_FAST_TRACK
CONTRACT_VERSION                    = meta-lark-parity-rollout-v1
MERGED_PR                           = #131
SOURCE_HEAD                         = c38058b8399313397294912cbc7b8a19116605b6
MERGED_MAIN_SHA                     = 34779e39b5f80d7786e4fced207fffcb5b9bcd21
MERGE_METHOD                        = SQUASH
REMOTE_EXECUTION_AUTHORIZED         = false
REMOTE_ACTIONS                      = NONE
REMOTE_D1_MUTATION                  = NONE
QUEUE_OR_DLQ_ACTION                 = NONE
LARK_MUTATION                       = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

## Customer-priority fast path

```text
Lark metadata/table/key preflight now
Facebook D1 accepted → Facebook Lark continuation immediately
Instagram D1 accepted → Instagram Lark continuation immediately
ChemistryK2 D1 accepted → ChemistryK2 Lark continuation immediately
ChemistryK3 D1 accepted → ChemistryK3 Lark continuation immediately
```

The operator reuses the same stable operation, Work key, generation, staged Provider data, completed
D1 phase and Coverage. It omits `d1Only` for the continuation and expects zero additional Meta Provider
requests.

## Merged phases

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

## Locked active window

Exactly these four flags may be true for a target continuation:

```text
selected Meta Connector
MKT_META_SOURCE_READ_ENABLED
MKT_META_D1_WRITE_ENABLED
MKT_META_LARK_WRITE_ENABLED
```

Report, unrelated Connectors/Business features, all schedules, DLQ redrive and Production remain false.

## Acceptance

- all 15 Meta Lark destinations and stable-key fields pass metadata preflight;
- exact target D1 summary and active Work identity match;
- D1 Business and Coverage counts do not change during Lark continuation;
- all expected Lark rows reconcile as created, updated or skipped;
- Work completes with no lock;
- same-operation rerun does not change reconciliation;
- all flags restore false;
- Provider request count during continuation is zero.

## Verification

```text
META_END_TO_END_VERIFICATION        = #46 / 30292167005 / PASS
BRANCH_VERIFICATION                 = #714 / 30292165540 / PASS
FOCUSED_META_TESTS                  = 15 / 15 PASS
NODE_UNIT_INTEGRATION               = 1117 / 1117 PASS
WORKERS_RUNTIME                     = 12 / 12 PASS
REPORT_RELIABILITY                  = 88 / 88 PASS
DEPENDENCY_AUDIT                    = 0 vulnerabilities
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
META_DIAGNOSTICS_ARTIFACT           = 8663216496
META_ARTIFACT_DIGEST                = sha256:46c209156c4001d50afa50f51c7383794fe6a34324aacc0381553354ee31abb0
BRANCH_DIAGNOSTICS_ARTIFACT         = 8663208596
BRANCH_ARTIFACT_DIGEST              = sha256:77d5944de8abfa718c4156368aad322535e088e24daea1e11369137a2ad60dca
FINAL_COMPARE_AHEAD                 = 18
FINAL_COMPARE_BEHIND                = 0
FINAL_CHANGED_FILES                 = 10
UNRESOLVED_REVIEW_THREADS           = 0
```

## Remote safe state

No Cloudflare/D1 command, Worker deployment, Queue/DLQ action, Meta Provider request, Lark metadata or
record request, Schedule/Secret change, retention/delete or Production action occurred during the
Repository task.

## Next gate

Run two separately confirmed read-only lanes in parallel from then-current `main`:

```text
Lane A: Meta Lark metadata preflight
Lane B: Facebook Meta D1 plan/read-only preflight
```

No backup, deployment, Queue send, D1 Business processing or Lark record mutation is authorized by
this archive.
