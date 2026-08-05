# Report Queue Consumer Hydration Hotfix v1

## Objective

Make the Shared Report Queue-consumer verifier compatible with Cloudflare's documented optional Consumer response
fields without reducing any identity or topology check.

## Incident

The first post-PR #515 Meta Ads 3D Queue-activation continuation root stopped before deployment:

```text
stage                       repository-finalizer-and-retained-evidence
code                        REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID
consumerCount               1
reviewedMatchCount          0
activeDeploymentAttempted   false
Queue send                  0
Remote mutation             0
Provider request            0
```

Evidence root:

```text
outputs/meta-ads-3d-queue-activation-continuation-3d28aebd2284
```

That root is immutable and must not be rerun.

## Root cause

The List Queue Consumers API can omit `type`, `queue_name`, `script_name` or `settings`. The existing verifier required
all of those fields in the List object and therefore classified one real Consumer as zero reviewed matches.

## Contract

1. List Queue Consumers must return exactly one Consumer with one non-empty `consumer_id`.
2. GET Queue Consumer must read the exact same ID.
3. Queue-list embedded Consumer metadata may supplement either response.
4. Every explicit ID must equal the listed ID.
5. Every explicit type must be `worker`.
6. Every explicit queue name must be `social-mkt-sync-jobs`.
7. The resolved script name must be `social-mkt-sync-worker`.
8. Resolved settings must remain:
   - batch size `10`;
   - max concurrency `1`;
   - max retries `5`;
   - max wait `30000ms`;
   - DLQ `social-mkt-sync-dlq`.
9. Missing optional fields may be filled only from another exact Cloudflare response for the same Consumer ID.
10. Diagnostics must not expose credentials, raw IDs or unrestricted response bodies.

## Out of scope

- changing Queue topology;
- deploying a Worker;
- sending/redriving Queue messages;
- changing Report/DLQ identities;
- D1/Lark repair;
- Notification Admission, Schedule or Production activation.

## Verification

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
