# Current Task — Report Queue Consumer Hydration Hotfix v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = REPORT_QUEUE_CONSUMER_HYDRATION_V1
BRANCH                              = hotfix/report-queue-consumer-hydration-v1
EXACT_BASE                          = 3d28aebd228446dcbd780006f337c0b3a4ca4be5
PLATFORM                            = meta_ads
WINDOW                              = 3D
REPORT_ID                           = integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
FAILED_PREFLIGHT_ROOT               = outputs/meta-ads-3d-queue-activation-continuation-3d28aebd2284
FAILED_PREFLIGHT_STAGE              = repository-finalizer-and-retained-evidence
FAILED_PREFLIGHT_CODE               = REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID
CONSUMER_COUNT                      = 1
REVIEWED_MATCH_COUNT                = 0
ACTIVE_DEPLOYMENT_ATTEMPTED         = false
QUEUE_MESSAGE_SENT                  = false
REMOTE_MUTATION_COUNT               = 0
PROVIDER_REQUEST_COUNT              = 0
OPEN_REPORT_DLQ                     = 3
TARGET_MATERIALIZATION_COUNT        = 0
NOTIFICATION_ADMISSION_ENABLED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/report-queue-consumer-hydration-v1.md
```

## Goal

Correct the Shared Cloudflare Queue-consumer verifier after the first Queue-activation continuation v2 root stopped
before any deployment or Queue send. The API returned exactly one Consumer, but the verifier required optional fields
to be present in the List response and therefore produced zero reviewed matches.

## Verified boundary

The stopped root proves:

```text
consumerCount                1
reviewedMatchCount           0
activeDeploymentAttempted    false
baselineRestoreVerified      false
providerRequestCount         0
scheduleEnabled              false
notificationAdmissionEnabled false
production                   BLOCKED
```

No Worker deployment, Queue message, D1/Lark mutation or Provider request occurred. The existing three DLQs and empty
Meta Ads 3D materialization target remain unchanged.

## Root cause

Cloudflare documents `type`, `queue_name`, `script_name` and `settings` on Queue Consumer responses as optional. The
PR #515 verifier required all three identity fields in the List response itself. A valid one-consumer inventory can
therefore fail before the exact Consumer detail is read.

## Implementation

- retain the existing Queue inventory, Worker-version barrier, Report Finalizer and continuation operator;
- use the Queue Consumer List only to require exactly one non-empty `consumer_id`;
- call the exact GET Consumer endpoint with that ID to hydrate optional identity and settings fields;
- also retain the exact Queue-list embedded Consumer as a fallback source;
- require all non-empty IDs, types and queue names returned by any source to agree;
- still require exact Worker script name, batch size, concurrency, retries, wait time and DLQ;
- emit only sanitized mismatch booleans/counts;
- keep the 120-second Report activation barrier and 30-second Notification restore barrier unchanged.

## Prohibited actions

- rerun `outputs/meta-ads-3d-queue-activation-continuation-3d28aebd2284`;
- send or redrive a Queue message during implementation;
- deploy a Worker or mutate D1/Lark;
- change the Meta Ads Report identity, requested-at or retained three-DLQ contract;
- enable Notification Admission, AI, Schedule or Production;
- start Dashboard display-name backfill.

## Acceptance criteria

1. Exactly one listed Consumer with a non-empty ID is required.
2. Optional List fields may be hydrated from exact Consumer detail or Queue-list embedded data.
3. Explicit type, queue, script, ID, settings or DLQ drift remains fail-closed.
4. The existing 120-second Report Queue activation barrier remains unchanged.
5. Existing three-DLQ Meta Ads continuation tests continue to pass.
6. Full Unit/Workers, Report reliability, Meta End-to-End, audit and Wrangler dry-run gates pass.
7. Repository implementation performs zero Remote action.

## Implementation result

Repository implementation is in progress. No Remote action has been performed by this branch.

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

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. create a completely new Finalizer/continuation evidence root;
3. run the exact Meta Ads 3D continuation once;
4. never repeat that new root after its first Queue send;
5. run fresh SELECT-only readiness;
6. continue only remaining windows through a new exact handoff.
