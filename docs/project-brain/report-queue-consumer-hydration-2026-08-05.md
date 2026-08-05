# Project Brain — Report Queue Consumer Hydration

Date: `2026-08-05`

## Verified incident

The first Meta Ads 3D Queue-activation continuation v2 root stopped during read-only Cloudflare preflight:

```text
consumerCount               1
reviewedMatchCount          0
activeDeploymentAttempted   false
Queue send                  0
Remote mutation             0
Provider request            0
```

No new DLQ, Sync Run, Work, lock or materialization was created. The Worker baseline was never changed.

## Root cause

PR #515 correctly added a Queue-consumer inventory gate, but its first version treated optional Cloudflare Consumer
fields as mandatory in the List response. Cloudflare's Consumer model permits `type`, `queue_name`, `script_name` and
`settings` to be omitted, while the exact GET Consumer endpoint can provide the same Consumer detail.

## Locked correction

- require one listed Consumer ID;
- hydrate the exact ID through GET Consumer;
- use Queue-list embedded metadata only as an additional exact source;
- reject any explicit identity or topology disagreement;
- keep exact Worker name, settings and DLQ requirements;
- retain the 120-second Report activation barrier;
- retain the 30-second Notification baseline restore barrier.

## Safety

The failed preflight root is immutable and cannot be rerun. Repository implementation performs no Remote Worker,
Queue, Provider, D1 or Lark action. Notification Admission and schedules remain false. Production remains blocked.
