# TikTok Organic Recovery — Exact Terminal Work Reactivation

Date: 2026-07-24  
Environment: Integration Workspace only  
Production: blocked  
Schedules: disabled  
Lark business writes: none

## Live evidence

The first recovery delivery reached the main Queue and exhausted six attempts because of the confirmed D1 observation-read bind-limit defect. The failed recovery then reached the DLQ and correctly terminalized the original durable Work.

Exact retained state:

```text
work_key            = tiktok:f59b852f00634005c7ff4da51afee964
lifecycle_status    = terminal
terminal_reason     = QUEUE_RETRY_EXHAUSTED
audit_reference     = dlq:06f7660b796808ebca3b8cd2e7780894
generation          = 1784829780000
requested_at        = 1784829780000
nextSequence        = 2
unitsCompleted      = 2
content durable     = 1000
observation durable = 1000
coverage durable    = 1000
```

The generation fence still points to the exact original Work. Both the original bootstrap DLQ and failed-recovery DLQ remain open. Business facts and the durable checkpoint are unchanged.

## Contract gap

The existing guarded resume operator required `lifecycle_status=active`. The deployed Worker also treats terminal Work as superseded when durable execution begins. Sending another Queue message without first reactivating the exact Work would therefore be unsafe and ineffective.

## Correction

A new two-phase local operator is added:

```text
reactivate
→ exact read-only terminal evidence guard
→ one incident-scoped operational UPDATE from terminal to active
→ exact active-state verification
→ save terminal-reactivate.json
→ zero Queue messages

resume
→ require passed reactivation evidence
→ exact read-only active-state guard
→ push the existing stable recovery payload once
→ save terminal-resume.json
```

The reactivation SQL is fail-closed and updates only `sync_work_runs` for the immutable incident identity. It requires the exact terminal reason and failed-recovery DLQ audit reference, unchanged phase checkpoint, unchanged generation fence, both expected DLQ rows, original recovery metadata, six recorded main Queue attempts and an absent/expired lock.

It does not delete, restore, zero or rewrite business facts. It does not modify the phase checkpoint, generation fence, DLQ rows, recovery metadata, Coverage or Lark.

## Execution boundary

This source PR performs no Remote action. After merge and Branch Verification, rollout remains sequential:

1. Run only `reactivate` with its exact confirmation.
2. Stop and inspect `terminal-reactivate.json`.
3. Only after approval, run `resume` once.
4. Stop and inspect `terminal-resume.json`.
5. Continue with read-only Work/Coverage/DLQ reconciliation.

No Worker deployment is required for this correction because the currently deployed recovery runtime already accepts the original Work when its lifecycle is active and contains the D1 bind-limit fix.
