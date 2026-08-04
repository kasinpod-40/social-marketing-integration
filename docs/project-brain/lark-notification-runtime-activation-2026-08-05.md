# Lark Notification Runtime Activation — 2026-08-05

## Current verified baseline

The Controlled Executive Notification UAT and Runtime Activation are both closed as `PASS`.

```text
main SHA                    5833c558d70efcfca08d476a30449b72d8555213
active Worker version       958e183e-fb0d-4795-a547-d805111ca6fc
Worker traffic              100%
runtime enabled             true
send enabled                true
mirror enabled              true
runtime mode                runtime
active Report Settings      4
retained real messages      1
additional delivery rows    0
additional message sends    0
D1 delivery rows            1
Notification Log rows       1
controlled UAT stable       true
Queue admission             0
notification producer       false
Automation / Schedule       0 / 0
rollback                    available
Production                  BLOCKED
```

The original Controlled UAT, Mirror Recovery and Runtime Activation commands are permanently closed and
must not be rerun.

## Active boundary

The Integration Workspace now has Worker-side delivery readiness only:

```text
D1 exact-once consumer     active
Lark chat transport        active
Lark delivery mirror       active
Exact Executive Settings   active for 1D/3D/7D/30D
Queue producer/admission   not approved
Lark Automation            not approved
Notification Schedule      not approved
Webhook                    not approved
Production                 blocked
```

The next gate is `notification_admission_requires_separate_approval`. Runtime Activation does not imply or
authorize Queue admission, producer, Automation, Schedule, Webhook or Production.

## Permanent mode rule

Notification Worker activation must always declare one explicit mode:

```text
disabled
controlled_uat
runtime
```

`controlled_uat` accepts only the controlled-UAT trigger and `notification-uat:*` identities.
`runtime` accepts only the reviewed runtime trigger and rejects every `notification-uat:*` identity.

The active Worker is in `runtime` mode. Do not switch it back to Controlled UAT mode.

## Active Settings authority

The active Settings scope comes from the latest exact Executive Preview rows for:

```text
1D / 3D / 7D / 30D
```

Exactly four source Report Settings have `ai_enabled` and `notification_enabled` active. Every row resolves
to the reviewed destination hash. No other Report Setting is authorized by this activation.

## Report Finalizer preservation rule

The canonical Report Settings seed remains all-false by design, but the Report Runtime Finalizer must not use that
static seed to deactivate the live exact four Settings.

Before any Settings reconciliation, the Finalizer must classify current canonical state as exactly one of:

```text
inactive / 0 active Settings
active   / 4 exact Executive Settings
```

For `active/4`, it must resolve the same authority used by Runtime Activation:

```text
latest Executive Preview 1D/3D/7D/30D
→ source Report IDs
→ exact Report Snapshots
→ exact Report Setting keys
→ reviewed destination hash
```

Only those four rows may retain `ai_enabled=true`, `notification_enabled=true` and the reviewed destination.
Every other canonical row must remain false. Mixed flags, a fifth active Setting, duplicates, ambiguous previews,
missing Snapshots, table drift or destination drift must block the Finalizer before Settings mutation.

The Finalizer public evidence may expose only state/count. The raw destination remains private. Notification
Admission, Queue producer, Automation, Schedule, Webhook and Production remain unapproved.

Contract:

```text
docs/tasks/report-finalizer-notification-runtime-preservation-v1.md
```

## No-admission proof

Runtime activation sent no Queue message and contains no direct Lark message call. The existing Worker crons
remain unchanged and `scheduled-jobs.js` contains no notification producer.

The bounded live observation proved:

```text
delivery rows unchanged          1 -> 1
Notification Log rows unchanged  1 -> 1
retained message count unchanged 1 -> 1
additional delivery rows         0
additional message sends         0
Queue admission                  0
```

## Rollback

Rollback authority remains available but requires explicit instruction. It first deploys the all-false Safe
Worker, then restores the exact four Report Settings false. It performs no Queue admission and preserves all
retained D1/Lark delivery evidence.

Authoritative task:

```text
docs/tasks/lark-notification-runtime-activation-v1.md
```