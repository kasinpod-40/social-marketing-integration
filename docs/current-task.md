# Current Task — WooCommerce Completed-State Incremental Admission Race Recovery Hotfix v1

## Authoritative status

```text
TASK_STATUS                         = REPOSITORY_IMPLEMENTATION_IN_REVIEW
CURRENT_PROGRAM                     = WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_V1
BASE_MAIN_SHA                       = 52b437af017d6bb59738ff79adfe7f6d5df5bbe5
BRANCH                              = hotfix/woocommerce-completed-state-incremental-admission-race-v1
IMPLEMENTATION_PR                   = DRAFT_PENDING
BRANCH_VERIFICATION                 = REQUIRED_ON_FINAL_EXACT_HEAD
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
D1_WRITE                            = NONE
LARK_WRITE                          = NONE
META_EXECUTION                      = NONE
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

Historical Current Task content remains available through Git history and the WooCommerce completed-state
Project Brain documents.

## Live incident

The guarded completed-state closeout passed Full completion admission, fresh D1 backup, temporary UAT
activation, D1/Lark parity and same-operation Full replay. It then submitted the separately persisted
Incremental UAT operation.

The first D1 poll happened before Queue admission metadata was visible. The completed-state selector tried
to require `queueOriginalRequestedAt` immediately and threw `WOOCOMMERCE_COMPLETED_STATE_TIMESTAMP_INVALID`.
The outer safety boundary correctly restored the Worker to all-false.

The accepted Incremental message arrived after that restore:

```text
Queue row / attempts              1 / 1
Terminal DLQ                      1 / open
Terminal error                    WOOCOMMERCE_CONNECTOR_INVALID
Message identity                  exact match
Sync Run                          0
Durable Work                      0
Phase                             0
Coverage                          0
Active Lock                       0
Worker flags                      all false
Meta execution                    0
Production                        blocked
```

The Queue router records stable attempt identity before invoking the connector router. The WooCommerce
router then rejected the message at the disabled Connector gate before `runReliableSync()` could create
Sync/Work state. No Provider request or Business write was admitted for this Incremental operation.

## Objective

Correct the Queue-admission polling race and recover only the exact accepted Incremental operation:

```text
pending Queue / Sync / Work visibility remains pending
→ preserve temporary UAT window
→ exact source-evidence and Terminal-DLQ admission
→ fresh D1 backup
→ temporary exact Woo UAT flags
→ submit the same Incremental operation once
→ complete through Shared Reliability and durable Work
→ verify D1/Lark parity
→ close only the exact DLQ/recovery metadata
→ automatic all-false Safe restore
→ zero active Work/Lock/Queue operation
```

## In scope

- Treat missing Queue admission metadata and active/incomplete durable state as bounded `pendingExecution`.
- Preserve all completed-state identity, scope, Coverage, failed-row and Source-parity checks.
- Pin recovery to the exact previous-head evidence, Incremental job hash and original watermark.
- Require exactly one accepted Queue attempt and one matching open Terminal DLQ with
  `WOOCOMMERCE_CONNECTOR_INVALID`.
- Require zero Sync Run, Work, Phase, Coverage and active Lock before recovery.
- Use reviewed exact-name Cloudflare Queue REST discovery; explicit Queue-ID bypass is rejected.
- Back up Remote D1 before the recovery send or metadata mutation.
- Submit only the same Incremental operation and require Queue attempts to grow from `1` to at least `2`.
- Reuse existing WooCommerce Runtime, Shared Reliability, D1/Lark writers, Queue/DLQ and parity logic.
- Close only `dead_letter_jobs` and `dead_letter_operation_metadata` after durable completion and parity.
- Bind recovery evidence and the final summary to the exact merged Repository Head.
- Restore and verify all Worker execution flags false on success and failure.

## Out of scope

- Replacement Full or Incremental operation.
- Re-running the original completed-state launcher before this recovery closes.
- Manual Queue redrive, direct Business-table editing or deletion.
- Changing the original Queue attempt or Terminal DLQ identity.
- New Reliability, Queue, D1 writer or Lark sync engines.
- Schedule, Meta execution, Production or customer-owned Production cutover.
- Any Remote action during Repository implementation or CI.

## Root correction contract

`classifyWooCommerceCompletedStatePoll()` must return a pending classification without throwing when:

- Queue acceptance is recorded locally but the D1 Queue row has not appeared;
- the Queue row exists but Sync Run and Work have not appeared;
- Sync Run is `running`;
- Durable Work is `active`;
- authoritative completion has not yet been persisted.

Permanent Sync failure remains terminal. Exact completed state still requires valid Queue timestamp,
matching generations, completed Sync/Work, retired Phase, six valid Coverage rows, zero failed rows and
exact completion scope.

## Exact incident admission

```text
Queue rows                       1
Queue attempts                   1
Queue generation/requestedAt     exact source evidence
DLQ metadata rows                1
Recovery status                  not_started
Terminal DLQ rows/status         1 / open
Terminal error                   WOOCOMMERCE_CONNECTOR_INVALID
Terminal retry count             1
Job type                         woocommerce.commerce.sync
Terminal message identity        exact Queue attempt match
Sync / Work / Phase / Coverage   0 / 0 / 0 / 0
Active Lock                      0
```

Any mismatch blocks the recovery before backup, deployment or Queue submission.

## Exact recovery completion

```text
Same Incremental operation       required
Replacement operation            forbidden
Queue attempts                    >= 2
Sync Run                          success
Durable Work                      completed
Completion JSON                   present
Completed Phase row               retired
Coverage                          6 / invalid 0
D1/Lark parity                    PASS
Exact Terminal DLQ               redriven
Recovery metadata                completed
Worker flags                      all false
Active Work / Lock / Queue op     0 / 0 / 0
Schedule / Meta / Production      disabled / 0 / blocked
```

## Public execution authority after Review and Merge

```bash
CONFIRM_WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY=\
RECOVER_WOO_INCREMENTAL_ADMISSION_RACE_EXACT_OPERATION_ONLY \
node scripts/woocommerce-completed-state-incremental-admission-race-recovery-launcher.mjs --execute
```

Direct operator execution, original closeout rerun and manual DLQ redrive are not approved.

## Acceptance criteria

```text
Queue not yet visible                              pending / no throw
Queue visible before Sync/Work                     pending / no throw
Running Sync or active Work                        pending / no premature Safe restore
Exact completed-state validation                   unchanged
Exact previous-head evidence and job hash          required
Exact open connector-disabled Terminal DLQ         required
Pre-recovery Sync/Work/Phase/Coverage/Lock          0/0/0/0/0
Fresh D1 backup                                    PASS required
Same Incremental operation only                    PASS required
Queue attempts                                     1 -> >=2
Incremental completion and D1/Lark parity          PASS required
DLQ closure before completion                      forbidden
Metadata mutation scope                            two DLQ metadata tables only
Business fact delete/direct mutation               0
Blind resend after accepted recovery attempt       blocked
Worker final execution flags                       all false
Active Work/Lock/Queue operation                   0/0/0
Schedule/Meta/Production                           disabled/0/blocked
Success marker                                     WOO_INCREMENTAL_ADMISSION_RACE_RECOVERED_SAFE
```

## Required validation

```text
npm ci
npm run check
focused Woo completed-state/race/runtime tests
focused Chatwoot final tests
focused TikTok staged regression
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification on exact PR Head
```

## Implementation result

- Added pending-admission and pending-execution classifications before completed-state timestamp
  validation.
- Added a pure exact-incident/recovered-state contract and guarded metadata-only closure SQL.
- Added a public exact-head launcher and plan-only guarded recovery operator.
- Added previous-head evidence/job-hash binding, fresh backup, same-operation one-send evidence,
  verification-only rerun behavior, D1/Lark parity, exact DLQ closure and all-false Safe restore.
- Added focused regressions for Queue propagation, active durable execution, exact incident drift,
  recovered-state proof, metadata mutation scope and operator ordering.
- Routed this hotfix through the repository-scoped `mkt-ci` Branch Verification runner.
- Repository implementation has performed no Remote action. Exact-head CI and Review remain required.
