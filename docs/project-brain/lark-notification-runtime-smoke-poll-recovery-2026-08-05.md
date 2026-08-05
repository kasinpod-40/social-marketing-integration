# Lark Notification Runtime Smoke Poll Recovery — 2026-08-05

## Current incident

The first post-activation Runtime Smoke Test admitted one reviewed runtime Queue job and the Executive `1D`
notification arrived in the Lark group. The exact Terminal stopped during D1 polling because it applied the final
all-terminal parity validator to the first in-flight observation.

```text
Queue admission                  1 confirmed
Lark message                     received
failure stage                    poll-sent-and-mirrored
invalid                          unsafeDeliveryRows, terminalParity
Queue outcome uncertain          false
blind rerun allowed              false
Worker deploy                    0
Report Settings write            0
Automation / Schedule            0 / 0
Production                       BLOCKED
```

## Interpretation

This incident is a verifier timing defect, not evidence that Lark send failed. A new delivery can legitimately be
`claimed`, `sending`, or `sent` with its Lark mirror still pending during early polling. The original validator is a
correct final-state invariant but was called too early.

## Recovery authority

Only this poll-only recovery entrypoint may continue the retained smoke attempt:

```text
scripts/lark-notification-runtime-smoke-recovery-exact-terminal.mjs
```

It discovers exactly one incomplete retained evidence chain, resolves the original smoke AI identity by SHA-256,
and performs D1/Lark readback only. It contains no Queue message endpoint, no POST admission, no Worker deployment,
no Report Settings writer and no Lark Automation/Schedule/Webhook path.

## Permanent safety rule

Once `02-queue-send.attempt.json` exists, the original smoke command is permanently closed. An error, timeout or
controller interruption after that point must be handled by exact retained-evidence inspection or poll-only
recovery. It must never be handled by rerunning the Queue admission.

## Accepted transient boundary

Recovery may tolerate at most one unsafe delivery only when that row is the exact retained smoke identity and is
not yet terminal sent/mirrored. Any additional unsafe row, any unrelated active lock, any Controlled UAT drift or
any terminal smoke row accompanied by another unsafe row fails closed.

## Completion boundary

Closeout requires two total sent/mirrored deliveries: the retained Controlled UAT and the Runtime Smoke delivery.
It also requires two sent Notification Log rows, the smoke AI Run marked sent, stable sent timestamp/message hash,
zero duplicate delivery, zero recovery Queue admission, Runtime Worker unchanged at 100%, active Settings retained,
Automation/Schedule zero and Production blocked.
