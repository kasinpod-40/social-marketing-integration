# Current Task — WooCommerce Incremental Admission Race Controlled Recovery

## Authoritative status

```text
TASK_STATUS                         = MERGED_AWAITING_CONTROLLED_RECOVERY
CURRENT_PROGRAM                     = WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_V1
IMPLEMENTATION_PR                   = #315 / SQUASH_MERGED
MERGED_MAIN_SHA                     = c750a1655a91b64c2aa069d020a7044fa5e27a3a
IMPLEMENTATION_HEAD                 = ad0a16584d63094e2f518e34e3cc650a08b62ef7
FINAL_BRANCH_VERIFICATION           = #1350 / 30608174704 / PASS
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
WORKER_EXECUTION_FLAGS              = ALL_FALSE
TERMINAL_DLQ                        = EXACT_INCIDENT_OPEN
SCHEDULE                            = DISABLED
META_EXECUTION                      = 0
PRODUCTION                          = BLOCKED
```

PR #315 corrected the WooCommerce completed-state Incremental admission race and added the guarded exact-operation recovery. The Repository implementation is merged. The incident itself has not yet been mutated or recovered on Live DEV infrastructure.

## Incident retained for recovery

```text
Original Incremental operation      persisted exact operation from private evidence
Queue rows / attempts               1 / 1
Terminal DLQ                        1 / open
Terminal error                      WOOCOMMERCE_CONNECTOR_INVALID
Terminal retry                      1
Sync / Work / Phase / Coverage      0 / 0 / 0 / 0
Active lock                         0
Provider request                    0
Incremental Business write          0
Worker flags                        all false
```

The accepted Queue message was consumed after automatic Safe restore. The Queue router recorded the stable operation attempt, then the disabled WooCommerce connector gate rejected the message before Shared Reliability admitted Sync/Work state.

## Merged correction

- Queue acceptance not yet visible in D1 is bounded `pendingAdmission`.
- Queue visible before Sync/Work, running Sync and active Work are bounded `pendingExecution`.
- Completed-state timestamp and completion validation do not run before durable admission.
- Permanent terminal failures and exact identity, scope, generation, Coverage and failed-row checks remain fail-closed.
- Recovery is pinned to the original Incremental operation, requested-at, watermark and job SHA-256.
- A fresh Remote D1 backup is required before temporary Woo UAT activation or metadata mutation.
- Only the same Incremental job may be submitted; replacement Full/Incremental operations are forbidden.
- Accepted recovery evidence makes reruns verification-only and blocks blind resend.
- Recovery must complete through existing Shared Reliability, D1/Lark writers and parity checks.
- Only the exact DLQ and recovery metadata rows may close after durable completion.
- Success and failure paths restore and verify all Worker execution flags false.

## Only remaining operator action

Run from a clean local checkout of current `main` on the authorized Mac:

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag

git fetch origin main
git switch main
git pull --ff-only origin main

CONFIRM_WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY=\
RECOVER_WOO_INCREMENTAL_ADMISSION_RACE_EXACT_OPERATION_ONLY \
node scripts/woocommerce-completed-state-incremental-admission-race-recovery-launcher.mjs --execute
```

Do not run the previous completed-state closeout launcher. Do not manually redrive the DLQ, create a replacement operation, edit Remote D1/Lark Business rows, send another Queue message or enable Schedule.

## Recovery acceptance

```text
Same Incremental operation          required
Queue attempts                      >= 2
Sync Run                            success
Durable Work                        completed
Completed Phase                     retired
Coverage                            6 / invalid 0
D1/Lark parity                      PASS
Exact Terminal DLQ                  redriven
Recovery metadata                   completed
Worker execution flags              all false
Active Work / Lock / Queue op       0 / 0 / 0
Schedule / Meta / Production        disabled / 0 / blocked
Decision                            WOOCOMMERCE_2026_COMPLETED_SAFE
Closeout marker                     WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE
Recovery marker                     WOO_INCREMENTAL_ADMISSION_RACE_RECOVERED_SAFE
```

If execution fails after Queue acceptance or temporary UAT deployment, do not blindly rerun. Preserve the complete JSON error and the exact-head private evidence for stage-aware diagnosis.

## Verification already completed

```text
npm ci                              PASS
npm run check                       PASS
Focused Woo recovery tests          PASS
Focused Chatwoot tests              PASS
Focused TikTok regression           PASS
npm test                            PASS
npm run test:report-reliability     PASS
npm audit --audit-level=high        PASS
npm run deploy:dry-run              PASS
Branch Verification #1350           PASS
Unresolved review threads           0
```

Historical implementation detail is retained in Git history, `CHANGELOG-WOOCOMMERCE-COMPLETED-STATE.md`, `docs/tasks/woocommerce-completed-state-incremental-admission-race-recovery-v1.md` and the corresponding Project Brain document.
