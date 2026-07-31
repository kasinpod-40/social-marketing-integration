# Project Brain — WooCommerce Completed-State Incremental Admission Race

## Decision

The accepted WooCommerce Incremental UAT operation must be recovered under its original durable identity.
No replacement operation, manual DLQ redrive or direct Business-table edit is authorized.

## Verified live boundary

```text
Original Full completion             unchanged
Full same-operation replay           verified
Incremental Queue acceptance         verified
Incremental Queue attempts           1
Open exact Terminal DLQ              1
Terminal error                       WOOCOMMERCE_CONNECTOR_INVALID
Sync / Work / Phase / Coverage       0 / 0 / 0 / 0
Active Lock                          0
Worker flags                         all false
Meta execution                       0
Production                           blocked
```

The Incremental operation never entered Shared Reliability or Provider processing.

## Root cause

The completed-state operator submitted the Incremental Queue message and immediately polled D1. Queue API
acceptance and D1 attempt visibility are not atomic. The first Snapshot therefore lacked
`queueOriginalRequestedAt` and the completed selector threw a timestamp error.

Automatic Safe restore then deployed the all-false Worker. The message was consumed afterward:

1. Queue routing persisted the stable attempt row.
2. WooCommerce routing evaluated the now-disabled Connector gate.
3. The job failed permanently before `runReliableSync()`.
4. The exact message was retained as a Terminal DLQ.

## Durable correction

The poll classifier now recognizes pending Queue admission and active/incomplete durable execution before
calling completed-state validation. The UAT window remains active during bounded propagation and Work
execution. Permanent Sync failure and completed-state drift remain fail-closed.

## Exact recovery authority

The recovery is bound to:

- previous exact-head private evidence;
- the original Incremental operation/requested-at/watermark;
- the exact stable Queue job hash;
- one accepted source Queue evidence file;
- one open Terminal DLQ with exact error/job/retry identity;
- zero pre-existing Sync/Work/Phase/Coverage/Lock;
- the unchanged original Full completion fingerprint.

The recovery sends the same job once after a fresh D1 backup and temporary exact Woo UAT deployment.
Accepted recovery evidence makes all reruns verification-only.

## DLQ closeout authority

DLQ metadata is closed only after:

- Queue attempts increased to at least two;
- Sync succeeded;
- Durable Work completed;
- authoritative completion exists;
- six Coverage rows are valid;
- D1/Lark parity passes;
- no active Lock remains.

Only the exact `dead_letter_jobs` and `dead_letter_operation_metadata` rows may change. No Business fact is
directly mutated or deleted by the recovery operator.

The first Terminal message identity is required during pre-recovery admission. After the second delivery,
`last_main_message_id` belongs to the successful message by design, so post-recovery proof retains the
exact Terminal DLQ/error and immutable operation generation instead of comparing against the replaced
latest-message pointer.

## Final safe state

```text
Original Full fingerprint             unchanged
Same Incremental operation            completed
Replacement operation                 false
Exact Terminal DLQ                    redriven
Recovery metadata                     completed
D1/Lark parity                        pass
Worker flags                          all false
Active Work / Lock / Queue operation  0 / 0 / 0
Schedule                              disabled
Meta execution                        0
Production                            blocked
```

## Public operating command

```bash
CONFIRM_WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY=\
RECOVER_WOO_INCREMENTAL_ADMISSION_RACE_EXACT_OPERATION_ONLY \
node scripts/woocommerce-completed-state-incremental-admission-race-recovery-launcher.mjs --execute
```

This command is authorized only after exact-head CI, Review and merge. Direct operator use and the original
completed-state launcher are not authorized for the current incident.

## Repository implementation safety

```text
Remote Provider request       0
Remote D1 query/write         0
Remote Lark request/write     0
Queue/DLQ message             0
Worker deployment             0
Schedule/Meta/Production      disabled / 0 / blocked
```
