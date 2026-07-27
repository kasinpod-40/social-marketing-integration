# TikTok Post-Lark Cross-layer Gap Reconciliation

Date: 2026-07-28

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTED_DRAFT_REVIEW_PENDING
BRANCH                              = fix/tiktok-post-lark-gap-reconciliation
DRAFT_PR                            = #154
REMOTE_RECONCILIATION               = NOT_RUN
WORKER_CURRENT_SAFE_STATE           = VERIFIED_404_BEFORE_IMPLEMENTATION
MIGRATION                           = NONE
QUEUE_DURING_IMPLEMENTATION         = NONE
REMOTE_D1_DURING_IMPLEMENTATION     = NONE
LARK_DURING_IMPLEMENTATION          = NONE
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

## Runtime evidence that opened this task

The guarded Final Runtime Audit completed on the attested active Worker version and then restored an
attested all-flags-false Worker:

```text
AUDIT_MODE                          = read_only
AUDIT_RAW_RECORD_COUNT              = 2024
AUDIT_READY_FOR_MANUAL_PROCESSING   = false
AUDIT_ISSUE_COUNT                   = 3
AUDIT_ISSUE_CODES                   = TIKTOK_CROSS_LAYER_GAP x3
QUEUE_OR_WRITE_PERFORMED            = false
FINAL_ROUTE_STATUS                  = 404
FINAL_SAFE_VERSION                  = 69659331-b77a-45d4-9053-3a6869847a0a
```

The compact terminal summary did not preserve the three gap names or counts. The executable operator
must therefore read the full sanitized Audit again and classify exact gaps before any write gate opens.
No gap name or count may be inferred from historical row counts.

## Scope

1. Correct the Audit D1 bound mismatch: the Lark scan can traverse up to `500 × 1,000`, while the D1
   identity adapter is intentionally bounded to 50,000 rows.
2. Read and classify the exact full Audit result.
3. Allow automatic reconciliation only when every issue is an additive `TIKTOK_CROSS_LAYER_GAP` and
   `contentNotInRaw=0`.
4. Reuse the existing pipeline only:
   `RAW watermark probe → durable Admission → existing Queue → existing staged full sync → D1-first
   Organic History → Canonical Lark Content/Daily → Coverage`.
5. Prove exact same-watermark parity and same-operation replay idempotency.
6. Always restore and attest all-flags-false HTTP `404`.

## Explicit non-goals

- no new D1 writer, Lark sync engine, Queue framework, Reliability engine or Migration;
- no delete, retention, overwrite, key repair or inferred conflict resolution;
- no report materialization, report read cutover or notification;
- no Schedule activation;
- no Production/customer-owned deployment;
- no execution from an unmerged branch or dirty working tree.

## Fail-closed blockers

Automatic reconciliation must stop before Queue submission when any of these are present:

- Canonical missing or duplicate stable keys;
- D1 duplicate keys, missing observations or missing Coverage entities;
- Canonical Content not present in protected RAW;
- unknown issue or gap category;
- Audit identity mismatch;
- RAW watermark change between before/after Audit;
- existing completed Admission for the same watermark/date while parity is incomplete;
- Active Worker version/status not attested three consecutive times;
- Queue target ambiguity or unsupported Cloudflare authentication;
- final safe-close cannot be attested.

## Acceptance criteria

```text
PLAN_ONLY_DEFAULT                    = PASS
AUDIT_D1_MAX_CONTENT_RECORDS         = 50000
EXACT_IDENTITY                       = development / integration_workspace / chemistry_k
ACTIVE_RECONCILIATION_FLAGS          = TikTok connector + watermark admission + D1 write + Audit only
TIKTOK_INCREMENTAL                   = false / full reconciliation
ALL_SCHEDULES                        = false
UNRELATED_CONNECTORS                 = false
PRE_AUDIT                            = FULL_SANITIZED_GAPS_CAPTURED
QUEUE_SUBMISSION                     = ONE PROBE WHEN ADDITIVE REPAIR REQUIRED
DURABLE_ADMISSION                    = completed
POST_AUDIT                           = zero issues / same RAW watermark
REPLAY                               = exact same probe / Admission unchanged
FINAL_SAFE_CLOSE                     = exact runtime version / 404 x3
REMOTE_ACTIONS_DURING_IMPLEMENTATION = 0
```
