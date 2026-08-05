# Lark Notification Runtime Smoke Poll Recovery v1

Date: 2026-08-05

## Objective

Close the already-admitted Runtime Smoke Test from retained evidence without admitting another Queue job. The
recovery is read-only against Cloudflare/D1 and Lark, except for writing private local closeout evidence.

## Verified incident boundary

```text
original smoke main             9ca8091a3e258813793f88499d931b2f9da62a59
Queue attempt evidence          present
Cloudflare Queue admission      confirmed exactly one
Lark Executive message          received
failure stage                   poll-sent-and-mirrored
failure code                    LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_REMOTE_STATE_INVALID
invalid fields                  unsafeDeliveryRows, terminalParity
blind rerun                     forbidden
Worker deployment               0
Report Settings write           0
Automation / Schedule           0 / 0
Production                      BLOCKED
```

## Root cause

The normal smoke readback validator represents the final invariant: every delivery row must be terminal
`sent/mirrored`, `unsafeDeliveryRows=0`, and total rows must equal sent/mirrored rows. The polling loop invoked this
final validator before checking whether the exact smoke row was merely in flight. A normal first observation of
`claimed`, `sending`, or `sent` with mirror pending was therefore reported as global unsafe drift.

The delivery runtime was not the failing component. The Lark message confirms that the existing admission reached
the transport. Recovery must never compensate with another admission.

## Retained evidence authority

Recovery scans the configured smoke evidence root and accepts exactly one directory that contains:

```text
01-read-only-preflight.json
02-queue-send.attempt.json
```

and does not yet contain:

```text
smoke-test-summary.json
```

The directory name, both evidence files and original repository Head must match. The persisted smoke AI Run hash,
operation hash and job hash must be valid SHA-256 values. The attempt must state a maximum Queue admission count of
one. Ambiguous, missing or inconsistent evidence fails closed.

## Exact identity recovery

The raw AI Run key is not persisted in public evidence. Recovery reads Executive AI rows from the existing Lark
Table and selects exactly one `notification-runtime-smoke:*` row whose SHA-256 equals the retained hash. It also
requires:

```text
scope_type             executive
notification_reason    runtime_smoke_test
preview_mode           false
```

No new AI row is created and no existing AI row is updated.

## Polling semantics

The recovery readback permits one nonterminal delivery only when all conditions hold:

- notification schema remains one table and three indexes;
- active lock count is zero;
- the retained Controlled UAT remains exactly one sent/mirrored row;
- total delivery rows equal sent/mirrored rows plus unsafe rows;
- unsafe rows are at most one;
- the exact smoke delivery count is one;
- when unsafe rows equal one, the exact smoke row itself is not yet sent/mirrored and is in a reviewed transient
  state.

Any second unsafe row or a terminal smoke row accompanied by another unsafe row is unrelated drift and fails
closed. `blocked` and `blocked_unknown` are terminal failures and do not authorize resend.

## Completion proof

Recovery closes only when:

```text
total delivery rows            retained baseline + 1
sent/mirrored rows              retained baseline + 1
unsafe delivery rows            0
exact smoke delivery rows       1
smoke status / mirror           sent / mirrored
claim count                     at least 1
sent_at                         present
message ID hash                 valid SHA-256
Notification Log rows           retained baseline + 1
smoke AI sent_to_group          true
Controlled UAT                  unchanged
active Worker                   reviewed version at 100 percent
Report Settings chain           remains active
additional Queue admissions     0
additional message sends        0
Worker deployments              0
Report Settings writes          0
Automation / Schedule           0 / 0
Production                      BLOCKED
```

A bounded observation repeats D1 and Lark reads and requires all delivery, claim, sent timestamp, message hash and
mirror facts to remain unchanged.

## Exact command after merge

```bash
CONFIRM_LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY=VERIFY_EXISTING_RUNTIME_SMOKE_WITHOUT_RESEND \
node scripts/lark-notification-runtime-smoke-recovery-exact-terminal.mjs --recover
```

The original smoke execution command is permanently closed and must not be rerun.
