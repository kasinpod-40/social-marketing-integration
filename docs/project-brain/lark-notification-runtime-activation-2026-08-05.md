# Lark Notification Runtime Activation — 2026-08-05

## Current verified baseline

The Controlled Executive Notification UAT is closed as `PASS`:

```text
retained real messages     1
additional recovery sends  0
D1 delivery                sent
Lark mirror                mirrored
Notification Log rows      1
AI Run sent marker         true
Worker flags               all false after closeout
Report Settings            false after closeout
Automation / Schedule      0 / 0
Production                 BLOCKED
```

Both the original UAT command and its Mirror Recovery command are permanently closed.

## Approved next boundary

The user approved `LARK_NOTIFICATION_RUNTIME_ACTIVATION_V1`.

Approval means Worker-side delivery readiness only:

```text
D1 exact-once consumer     approved
Lark chat transport        approved
Lark delivery mirror       approved
Exact source Settings      approved
Queue producer/admission   not approved
Lark Automation            not approved
Notification Schedule      not approved
Webhook                    not approved
Production                 blocked
```

## Permanent mode rule

Notification Worker activation must always declare one explicit mode:

```text
disabled
controlled_uat
runtime
```

`controlled_uat` accepts only the controlled-UAT trigger and `notification-uat:*` identities.
`runtime` accepts only the reviewed runtime trigger and rejects every `notification-uat:*` identity.

Do not leave a permanently active Worker in Controlled UAT mode.

## Activation authority

The source Settings scope comes from the latest exact Executive Preview rows for:

```text
1D / 3D / 7D / 30D
```

The activation resolves their exact source Report IDs, Report Snapshots and Report Setting keys. It may toggle
only `ai_enabled` and `notification_enabled` for those exact enabled Settings, and every row must resolve to the
reviewed destination hash.

## No-admission proof

Runtime activation itself sends no Queue message and contains no direct Lark message call. The existing Worker
crons remain unchanged and `scheduled-jobs.js` must contain no notification producer.

Successful activation therefore requires a bounded observation proving:

```text
delivery rows unchanged
Notification Log rows unchanged
retained message count unchanged
additional message sends 0
```

## Rollback

Rollback first deploys the all-false Safe Worker, then restores the exact Report Settings false. It performs no
Queue admission and must preserve all retained D1/Lark delivery evidence.

Authoritative task:

```text
docs/tasks/lark-notification-runtime-activation-v1.md
```
