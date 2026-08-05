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
Worker runtime/send/mirror       true / true / true
active Executive Report Settings 4
ai_enabled                       true on exact four Settings
notification_enabled             true on exact four Settings
Automatic Queue admission        false
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
Settings and erase their destination value.

The existing Report readiness and closeout path also treated Safe Worker state as every execution flag false.
The now-correct live baseline has three reviewed Notification Runtime flags true. Old readiness would block that
Worker, and old closeout restoration would deploy an all-false Worker after Report materialization, silently
turning off Notification Runtime.

No Finalizer or Report closeout was run after these conflicts were discovered. No Lark, D1, Queue, Worker,
Schedule or Production action occurred from this incident.

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

Report Worker windows separately assumed the pre-activation all-false Worker baseline and did not retain the
exact Notification Runtime flags or its required Table mappings.

## Correction

### Settings authority

- inspect every canonical Integration Workspace Report Setting before planning reconciliation;
- accept only one of two states:
  - every canonical AI/notification pair false (`inactive/0`), or
  - exactly four matching AI/notification pairs true (`active/4`);
- for `active/4`, resolve authority through the existing Executive Preview → Snapshot → Setting chain;
- require active keys, shared Table identities and destination to match the reviewed authority;
- overlay `ai_enabled=true`, `notification_enabled=true` and the existing destination only on those four rows;
- keep every other canonical row AI/notification false;
- reject mixed flags, a fifth active row, duplicate keys, missing snapshots, ambiguous previews, Table drift or
  destination drift;
- verify preview, apply and readback retain the same `active/4` or `inactive/0` state;
- expose only state/count publicly; raw destination, Setting keys and Table IDs remain private.

### Worker baseline authority

- retain private exact-head Notification Runtime evidence beside the Finalizer summary;
- active baseline contains only the exact three reviewed true flags:
  - `MKT_NOTIFICATION_RUNTIME_ENABLED`;
  - `MKT_NOTIFICATION_LARK_SEND_ENABLED`;
  - `MKT_NOTIFICATION_LARK_MIRROR_ENABLED`;
- retain mode `runtime` and exact AI Runs, Report Snapshots, Report Settings and Notification Log mappings;
- require shared Report/Notification Table mappings to match;
- Readiness verifies the current Worker against that retained baseline instead of requiring all-false;
- Report Active config equals the retained Notification baseline plus only the channel’s approved Report flags;
- success and failure paths restore the retained Notification baseline, not all-false;
- inactive Finalizer state continues to use the prior all-false baseline;
- Notification Admission, automatic producer, Automation, Schedule, Webhook and Production remain disabled.

## Safety boundary

```text
Implementation Worker deploy         0
Notification Admission               false
Automatic Queue producer/send        0
Additional notification send         0
Remote D1 mutation                    0
Schedule / Automation / Webhook      0 / 0 / 0
Production                            BLOCKED
```

This hotfix does not rerun Notification Controlled UAT, Mirror Recovery, Runtime Activation or Runtime Smoke
Test. It does not add a Report, Notification, Queue, Reliability or Lark writer. It extends existing Settings
reconciliation and wraps the existing reviewed Report config builder with retained baseline authority.

## Acceptance

- active exact four Settings plan as skipped, not updated;
- inactive canonical Settings retain the old all-false behavior;
- unauthorized active Settings scope fails closed;
- Finalizer summary records `notificationRuntimeState` and
  `preservedNotificationRuntimeSettingCount`;
- Finalizer private evidence binds exact Worker baseline and mappings to the current repository Head;
- Finalizer keeps `notificationAdmissionEnabled=false`;
- active readiness accepts exactly three Notification true flags and rejects any drift;
- Report Active windows contain baseline flags plus only Report flags;
- every closeout restores the baseline and records `restoredBaseline=true`;
- post-merge Finalizer produces zero canonical Setting updates before SELECT-only readiness resumes.
