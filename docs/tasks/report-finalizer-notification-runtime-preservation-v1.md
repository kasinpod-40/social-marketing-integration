# Report Finalizer Notification Runtime Preservation v1

Date: 2026-08-05

## Incident

PR `#496` merged the private exact-head Report Table environment bridge into
`main@3b02ac90b5912a8a1d2f4fd9b06a8ab1163ed7c4`. Before the required post-merge
Finalizer rerun, the current repository/runtime authority was re-read.

The Lark Notification Runtime had already closed successfully with:

```text
runtime mode                     runtime
Worker traffic                   100%
active Executive Report Settings 4
ai_enabled                       true on exact four Settings
notification_enabled             true on exact four Settings
Queue admission                  0
Automation / Schedule            0 / 0
Production                       BLOCKED
```

The canonical Report Settings seed intentionally defaults every row to:

```text
ai_enabled            false
notification_enabled  false
group_id              null
```

The existing Report Runtime Finalizer reconciled that seed as a full canonical row. Running it after
Notification Runtime activation would therefore plan four updates that disable the exact active Executive
Settings and erase their destination value. This would silently violate the closed Notification Runtime
baseline even though Report schema and materialization execution flags remained safe.

No Finalizer was run after this conflict was discovered. No Lark, D1, Queue, Worker, Schedule or Production
action occurred from this incident.

## Root cause

Report Settings reconciliation treated runtime-owned notification fields as static seed-owned fields. It had no
bridge to the already-reviewed Notification Runtime authority:

```text
latest Executive Preview 1D/3D/7D/30D
→ source Report IDs
→ exact Report Snapshots
→ exact Report Setting keys
→ one reviewed destination hash
```

The Notification Runtime activation operator already used this chain, but the Finalizer did not reuse it.

## Correction

- inspect every canonical Integration Workspace Report Setting before planning reconciliation;
- accept only one of two states:
  - every canonical AI/notification pair false (`inactive/0`), or
  - exactly four matching AI/notification pairs true (`active/4`);
- for `active/4`, resolve authority through the existing Executive Preview → Snapshot → Setting chain;
- require the active keys to equal the exact authority keys and the destination to match the reviewed hash;
- overlay `ai_enabled=true`, `notification_enabled=true` and the existing destination only on those four canonical
  rows before the shared `TableSyncEngine` plans changes;
- keep every other canonical row AI/notification false;
- reject mixed flags, a fifth active row, duplicate keys, missing snapshots, ambiguous previews, table identity
  drift or destination drift;
- verify preview, apply and readback retain the same `active/4` or `inactive/0` state;
- expose only state/count in public Finalizer output; raw destination and Table IDs remain private;
- preserve the private Finalizer Table environment contract from PR `#496`.

## Safety boundary

```text
Notification Runtime Worker deploy   0
Notification Admission               false
Queue producer/send                  0
Additional notification send         0
Remote D1 mutation                   0
Schedule / Automation / Webhook      0 / 0 / 0
Production                           BLOCKED
```

This hotfix does not rerun Notification Controlled UAT, Mirror Recovery or Runtime Activation. It does not add a
new Report, Notification, Queue, Reliability or Lark writer. It extends the existing Settings reconciliation and
reuses the existing Notification Runtime authority functions.

## Acceptance

- active exact four Settings plan as skipped, not updated;
- inactive canonical Settings retain the old all-false behavior;
- unauthorized active scope fails closed;
- Finalizer summary records `notificationRuntimeState` and
  `preservedNotificationRuntimeSettingCount`;
- Finalizer keeps `notificationAdmissionEnabled=false`;
- post-merge Finalizer produces zero canonical Setting updates and private environment evidence for the exact
  current `main` Head before SELECT-only readiness resumes.
