# Queue Consumer Optional Script Identity Hotfix v1

Date: `2026-08-05`

## Incident

The GET-only Queue Consumer hydration preflight stopped with one exact Consumer and no Remote action:

```text
consumerCount             1
consumerIdentityMatched   true
typeMatched               true
queueNameMatched          true
scriptNamePresent         false
scriptNameMatched         false
detailHydrated            true
activeDeploymentAttempted false
Queue send                0
Remote mutation           0
```

The immutable stopped root is:

```text
outputs/meta-ads-3d-queue-consumer-hydration-7a05c64f1ea9
```

## Root cause

Cloudflare documents the Worker Consumer response fields, including `script_name`, as optional. In this tenant the
exact GET response omitted `script_name` while returning enough information to prove one Consumer, exact ID, Worker
type, Queue, settings and DLQ. The Shared verifier incorrectly converted absence into mismatch.

## Corrected authority

- Require exactly one listed Consumer with one stable `consumer_id`.
- Hydrate the exact Consumer GET response.
- Reject explicit ID, type, queue or script disagreement from every response source.
- If any explicit `script_name` exists, every value must equal `social-mkt-sync-worker`.
- If all responses omit the optional field, use the reviewed Worker contract name and record authority as
  `reviewed_worker_contract`.
- Before Queue send, continue to require the exact deployed `social-mkt-sync-worker` version, exact Report flags, D1
  binding, Queue producer binding and Lark mappings across the 120-second activation barrier.
- Keep exact batch size 10, concurrency 1, retries 5, wait 30000ms and DLQ `social-mkt-sync-dlq`.

## Exact continuation boundary

The Meta Ads 3D target remains empty with three retained open DLQs, zero active Work/lock and Notification Runtime
restored. This repository hotfix does not alter the retained payload, Report identity, requested-at, closure references
or continuation semantics.

## Failure semantics

- Missing optional `script_name` with otherwise exact topology: accepted.
- Any explicit non-matching script name: fail closed.
- Multiple Consumers, ID drift, non-Worker type, wrong Queue, settings drift or DLQ drift: fail closed.
- Repository implementation performs no Worker deployment, Queue action, D1/Lark mutation or Provider request.

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
