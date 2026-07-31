# WooCommerce Completed-State Incremental Admission Race Recovery v1

## Status

```text
Repository implementation     in review
Remote Provider request       0
Worker deployment             0
Queue/DLQ message             0
Remote D1 query/write         0
Remote Lark request/write     0
Schedule                      disabled
Meta execution                0
Production                    blocked
```

## Problem

The completed-state closeout accepted and submitted a separately persisted WooCommerce Incremental UAT
job. Cloudflare Queue acceptance returned before the stable Queue-attempt row was visible to the first D1
poll. The poll called completed-state timestamp validation too early, threw, and entered automatic
all-false Safe restore.

The message was consumed after the Safe version became active. Stable Queue attempt metadata was written
first, then the WooCommerce router rejected the disabled connector before Shared Reliability admission.
The exact message became one open Terminal DLQ with no Sync Run, Durable Work, Phase, Coverage, Lock,
Provider request or Incremental Business write.

## Root correction

`classifyWooCommerceCompletedStatePoll()` now separates three states:

```text
pending admission   Queue attempt has not reached D1 visibility
pending execution   Queue identity exists but Sync/Work/completion is not durable yet
completed/terminal  exact completed contract or permanent Sync failure
```

Pending states return normally to the bounded poll loop. The temporary UAT deployment therefore remains
active while Cloudflare Queue and D1 converge. Completed-state timestamp validation runs only after the
operation has durable admission evidence.

The correction does not relax completed-state validation. A successful result still requires exact
operation identity, matching generations, successful Sync, completed Work, retired Phase, exact scope,
six valid Coverage rows and zero failures.

## Exact incident contract

Recovery reads the original private evidence and requires:

- exact previous Repository Head;
- exact Incremental operation, original requested-at and watermark;
- exact Queue job SHA-256;
- exactly one accepted source Queue evidence file;
- one Queue row and one attempt;
- one matching open Terminal DLQ;
- error `WOOCOMMERCE_CONNECTOR_INVALID`;
- retry count `1` and job type `woocommerce.commerce.sync`;
- exact terminal-message match at admission;
- zero Sync, Work, Phase, Coverage and active Lock;
- original Full completion fingerprint unchanged;
- Worker all-false and zero active Reliability state.

Any mismatch blocks before backup, deployment or Queue submission.

## Recovery sequence

```text
clean exact current main
→ full Repository gates
→ validate original private evidence and exact job hash
→ exact-name Queue REST discovery
→ all-false/zero-active Remote admission
→ validate exact open Terminal incident
→ fresh D1 export
→ deploy exact Woo UAT flags
→ submit the same Incremental job once
→ poll through pending admission and active durable Work
→ require Queue attempts >= 2
→ require successful Sync/completed Work/six Coverage rows
→ verify current D1/Lark parity
→ bridge the verified Full replay checkpoint to the new exact Head
→ write the Incremental completion checkpoint
→ update only the exact DLQ and recovery metadata rows
→ deploy and verify all flags false
→ verify zero active Work/Lock/Queue operation
```

## Queue-send idempotency

The recovery writes a mode-0600 attempt file before the Queue API call.

- no file: one send may occur;
- `accepted=true`: rerun is verification-only and never resends;
- `accepted=false`: acceptance is uncertain and the operator blocks;
- identity or job-hash mismatch: operator blocks.

A replacement Full or Incremental operation is never created.

## D1 mutation boundary

Before Incremental processing, all Business writes remain owned by the existing WooCommerce Runtime and
Shared sync/reliability layers. The recovery operator does not directly write Business tables.

After successful completion and D1/Lark parity, the only direct SQL mutation is:

```text
dead_letter_jobs
  exact open incident → redriven

dead_letter_operation_metadata
  exact not_started/in_progress incident → completed
```

The SQL is transaction-wrapped and pinned to operation, Work key, generation, original requested-at,
error, retry count and job type. It contains no Business-table update or delete.

The original Terminal message must match the first Queue attempt during admission. After the second
accepted delivery, `queue_operation_attempts.last_main_message_id` correctly points to the new message;
post-recovery proof therefore relies on the retained exact DLQ row/error plus immutable operation identity,
not a false expectation that the latest message ID remains the first Terminal message ID.

## Safe restore

The all-false configuration is retained in memory immediately after the fresh D1 backup. Any later error
attempts automatic restore. Success requires a separately verified all-false deployment and final Remote
read confirming zero active Reliability state.

## Public command after merge

```bash
CONFIRM_WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY=\
RECOVER_WOO_INCREMENTAL_ADMISSION_RACE_EXACT_OPERATION_ONLY \
node scripts/woocommerce-completed-state-incremental-admission-race-recovery-launcher.mjs --execute
```

Do not run the original completed-state launcher, manually redrive the DLQ or edit D1 before this recovery.

## Success markers

```text
WOOCOMMERCE_2026_COMPLETED_SAFE
WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE
WOO_INCREMENTAL_ADMISSION_RACE_RECOVERED_SAFE
```

## Required tests

- Queue acceptance before D1 attempt visibility remains pending;
- Queue row before Sync/Work remains pending;
- running Sync and active Work remain pending;
- exact completed Incremental still passes;
- exact incident accepts only the observed zero-admission state;
- identity, timestamp, error, DLQ or Reliability drift blocks;
- recovered state requires attempt growth, completion and six valid Coverage rows;
- closure SQL touches only the two DLQ metadata tables;
- backup/deploy/send/completion/closure/restore ordering is fixed;
- public launcher binds evidence to exact Head;
- full Unit/Workers, Report reliability, dependency audit and Wrangler dry-run pass.
