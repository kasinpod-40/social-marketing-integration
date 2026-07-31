# Project Brain — WooCommerce Completed-State Incremental Admission Race

## Final decision

```text
WOOCOMMERCE_2026_COMPLETED_SAFE
WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE
WOO_INCREMENTAL_ADMISSION_RACE_RECOVERED_SAFE
```

The exact accepted WooCommerce Incremental UAT operation was recovered successfully under its original
durable identity on 2026-07-31. No replacement Full or Incremental operation was created. The exact
Terminal DLQ is closed, D1/Lark parity passed and the Worker returned to all-false with zero active
reliability state.

## Verified final live boundary

```text
Recovery Repository Head             2f66b7b139c192ebb964e8e7f520a30940acee7b
Source evidence Head                  d3592b256d52bf72e4a3d9d33ab707cb5bca4961
Original Full completion              unchanged
Same Incremental operation            recovered / completed
Replacement Incremental operation     false
Queue attempts                        4
Exact Terminal DLQ                    closed
Recovery metadata                     completed
Sync / Work                           success / completed
Completed Phase                       retired
Coverage                              6 / invalid 0
D1/Lark parity                        pass
Worker flags                          all false
Active Work / Lock / Queue operation  0 / 0 / 0
Old pre-2026 rows                     0
Meta execution                        0
Schedule                              disabled
Production                            blocked
```

## Root cause retained

The completed-state operator submitted the Incremental Queue message and immediately polled D1. Queue API
acceptance and D1 attempt visibility are not atomic. The first Snapshot therefore lacked
`queueOriginalRequestedAt` and the completed selector threw a timestamp error.

Automatic Safe restore then deployed the all-false Worker. The message was consumed afterward:

1. Queue routing persisted the stable attempt row.
2. WooCommerce routing evaluated the now-disabled Connector gate.
3. The job failed permanently before `runReliableSync()`.
4. The exact message was retained as a Terminal DLQ.

## Durable correction

The poll classifier recognizes pending Queue admission and active/incomplete durable execution before
calling completed-state validation. The UAT window remains active during bounded propagation and Work
execution. Permanent Sync failure and completed-state drift remain fail-closed.

The recovery is bound to:

- previous exact-head private evidence;
- the original Incremental operation/requested-at/watermark;
- the exact stable Queue job hash;
- one accepted source Queue evidence file;
- the exact Terminal DLQ error/job/retry identity;
- zero pre-existing Sync/Work/Phase/Coverage/Lock at recovery admission;
- the unchanged original Full completion fingerprint.

Accepted recovery evidence makes reruns verification-only and blocks blind resend.

## Completed recovery proof

```text
Backup file
outputs/woocommerce-completed-state-closeout-v1/2f66b7b139c192ebb964e8e7f520a30940acee7b/backups/social-mkt-state-dev-before-incremental-race-1785478493614.sql

Backup bytes                         46590401
Backup SHA-256                       1de97c8c1906bc6efc0877b1e49cad4ffe58fd098ee32d39743c23bd63ba934d
Full completion fingerprint          64705bde96a6c7aee9793c7a1b5fba65afbbe9f97986394bbaf8661fc54fa74f
Incremental completion fingerprint   0caf61eadfb4a016dcb151b6422391c465463c4e4fc0470d6fdc1130bb1b98d2
Final safe Worker version            7bd10941-a97a-4c5c-bc95-6f3424ee25aa
Exact metadata mutation count        2
Business fact delete                 false
Direct Business mutation             false
Blind Queue resend                    false
```

The backup and exact-head evidence are private local artifacts and are not Repository content.

## DLQ closeout result

The exact `dead_letter_jobs` and `dead_letter_operation_metadata` rows closed only after:

- Queue attempts increased beyond the original attempt;
- Sync succeeded;
- Durable Work completed;
- authoritative completion existed;
- six Coverage rows were valid;
- D1/Lark parity passed;
- no active Lock remained.

No Business fact was directly mutated or deleted by the recovery operator.

## Operating boundary after completion

Do not run the completed-state closeout launcher or the recovery launcher again for this closed incident.
Do not manually redrive the DLQ, create a replacement operation, edit Remote D1/Lark Business rows or
enable WooCommerce Schedule.

The recovery result declared the next step:

```text
resume_pinned_meta_finalizer
```

That is a separate controlled workstream. It must locate and validate the existing pinned Meta finalizer
contract and evidence before any Meta execution. This WooCommerce result does not authorize an inferred or
replacement Meta operation.

## Final safe state

```text
WooCommerce                          completed safe
Exact completed-state closeout       closed safe
Incremental admission race recovery  recovered safe
Worker execution flags               all false
Active reliability state             zero
Schedule                             disabled
Meta execution                       0
Production                           blocked
```
