# Lark Notification Runtime Smoke Test — 2026-08-05

## Current verified baseline

The Controlled Executive Notification UAT and Runtime Activation are closed as `PASS`.

```text
main SHA                    e7963c6a1493354df5586f6a8d83a4062e6e2789
active Worker version       958e183e-fb0d-4795-a547-d805111ca6fc
Worker traffic              100%
runtime enabled             true
send enabled                true
mirror enabled              true
runtime mode                runtime
active Report Settings      4
retained real messages      1
D1 delivery rows            1
Notification Log rows       1
Queue admission             0
notification producer       false
Automation / Schedule       0 / 0
Production                  BLOCKED
```

The original Controlled UAT, Mirror Recovery and Runtime Activation commands are permanently closed.

## Approved boundary

The user approved one Runtime Smoke Test with one new identity and one manual Queue admission.

```text
new smoke AI identity       approved
one manual Queue admission  approved
one real group message      approved
second/replay admission     not approved
Worker deployment           not approved
Report Settings mutation    not approved
automatic producer          not approved
Lark Automation             not approved
Notification Schedule       not approved
Webhook                     not approved
Production                  blocked
```

## Permanent identity rule

The smoke test must derive a fresh deterministic identity from the exact post-merge repository Head and latest
reviewed Executive `1D` Preview:

```text
notification-runtime-smoke:<sha256>
```

It must use trigger `lark_notification_runtime` and must never reuse `notification-uat:*`.

The retained Preview is immutable. The smoke test creates a separate eligible AI Run through the existing Lark
repository and `TableSyncEngine`.

## One-admission rule

The operator persists private attempt evidence before the Queue POST and performs one Queue REST admission only.
After attempt evidence exists, blind rerun and automatic resend are forbidden even when the local transport result
is uncertain.

The Controlled UAT already proved exact replay deduplication. Runtime smoke duplicate protection is therefore
verified through a bounded no-admission observation after the first delivery, not through a second Queue send.

## Active-state preservation

This smoke test uses the already active Worker and Settings. It does not deploy or toggle them.

Successful closeout must retain:

```text
active Worker version       958e183e-fb0d-4795-a547-d805111ca6fc
Worker traffic              100%
runtime mode                runtime
active Report Settings      4
notification producer       false
Automation / Schedule       0 / 0
Production                  BLOCKED
```

## Expected business proof

```text
Queue admission             exactly 1
D1 delivery rows            1 -> 2
new group messages          exactly 1
Notification Log rows       1 -> 2
smoke delivery              sent / mirrored
smoke AI Run                marked sent
duplicate delivery rows     0
retained Controlled UAT     unchanged
```

Passing this smoke test does not approve automatic Notification Admission. The next gate remains a separately
reviewed admission/producer decision.

Authoritative task:

```text
docs/tasks/lark-notification-runtime-smoke-test-v1.md
```
