# Meta Ads 3D Queue Activation Continuation v2

Date: `2026-08-05`

## Objective

Recover the exact Meta Ads 3D Report job after its post-bind-fix attempt was terminalized before `sync_runs` because
the Queue consumer did not observe the reviewed Report execution window. Preserve the original Report identity,
requested-at, source watermark and payload hash.

## Retained evidence

```text
Report ID
integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1

Job SHA-256
cb25578b3e5f6034425ae10772adf1a85efc20634dcdc7470377bf143340102d

Original DLQ
terminal:e408707c9c2d383e04a3e213a7be45a0

D1 retry-exhausted DLQ
dlq:2f292f08f5bdc4f12c91b68ceff71e1b

Queue activation DLQ
terminal:228fecb8afc03a3339313a85fbb5c45c
```

The latest continuation boundary is:

```text
continuationRequestedAt  1785943887248
successful Sync Runs     0
failed Sync Runs         0
active Sync Runs         0
active locks             0
materialization          0
latest DLQ attempts      1
baseline restored        true
```

## Root correction

### Queue consumer authority

Before any Report Queue send, read the Cloudflare Queue consumer inventory and require:

- exactly one consumer identity;
- explicit type, when present, is `worker`;
- explicit queue name, when present, is `social-mkt-sync-jobs`;
- resolved script is `social-mkt-sync-worker`;
- batch size `10`;
- max concurrency `1`;
- max retries `5`;
- max wait `30000ms`;
- dead-letter queue `social-mkt-sync-dlq`.

The List response locks the one non-empty `consumer_id`. The exact GET Consumer response and Queue-list embedded
Consumer may hydrate Cloudflare fields documented as optional. Every explicit identity returned by any source must
agree; missing fields alone are not treated as drift. Persist only consumer identity/settings fingerprints, never raw
auth or account identifiers.

### Activation barrier

A Report execution deployment must remain the exact same version with exact true flags, D1 binding, Queue binding and
Lark mappings for three samples over 120 seconds:

```text
sample 1  0s
sample 2  60s
sample 3  120s
```

A Notification baseline restore is not a Report execution window and keeps the existing three-sample/30-second
barrier.

## Exact continuation

The existing Meta Ads continuation operator is extended rather than replaced. It must:

1. use a new evidence root;
2. bind the latest failed attempt and all three DLQs;
3. require zero Work/lock and empty D1/Lark target;
4. deploy the reviewed Report window;
5. pass the 120-second Queue activation barrier;
6. send the original job once;
7. verify one complete D1/Lark materialization;
8. send one exact replay;
9. prove stable Report ID, payload checksum and Lark rows;
10. restore Notification Runtime;
11. close all three exact DLQs only after every prior proof passes.

## Pre-send Consumer-hydration incident

The first post-PR #515 v2 root stopped before any deployment because one valid Consumer was returned but optional List
fields were absent:

```text
root                       outputs/meta-ads-3d-queue-activation-continuation-3d28aebd2284
consumerCount              1
reviewedMatchCount         0
activeDeploymentAttempted  false
Queue send                 0
Remote mutation            0
Provider request           0
```

That root is immutable and cannot be rerun. It created no new DLQ or Report runtime state, so the exact retained
three-DLQ continuation contract remains unchanged.

## Failure semantics

- Before Queue send: safe to correct Repository/config and start a new evidence root.
- After Queue send: the evidence root is immutable and must not be repeated.
- A new exact DLQ terminates polling immediately.
- A retryable Sync failure remains in the bounded poll window until success or exact DLQ.
- Baseline restore runs in `finally` after any active deployment attempt.

## Out of scope

- generic Queue redrive;
- old root replay;
- source refresh or Provider access;
- manual D1/Lark writes;
- remaining Report windows;
- Dashboard legacy display-name backfill;
- Notification Admission, AI, Schedule or Production.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-queue-activation-barrier.test.js
node --test tests/scripts/report-runtime-meta-ads-3d-d1-bind-continuation.test.js
node --test tests/connectors/d1-ads-report-source.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
