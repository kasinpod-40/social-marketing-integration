# Current Task — Queue Consumer Optional Script Identity Hotfix v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = QUEUE_CONSUMER_OPTIONAL_SCRIPT_IDENTITY_V1
BRANCH                              = hotfix/queue-consumer-script-name-optional-v1
EXACT_BASE                          = 7a05c64f1ea98ce672fda7a79ad356875c0841b2
PLATFORM                            = meta_ads
WINDOW                              = 3D
REPORT_ID                           = integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
FAILED_PREFLIGHT_ROOT               = outputs/meta-ads-3d-queue-consumer-hydration-7a05c64f1ea9
FAILED_PREFLIGHT_STAGE              = GET-only Queue Consumer hydration
FAILED_PREFLIGHT_CODE               = REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID
CONSUMER_COUNT                      = 1
CONSUMER_IDENTITY_MATCHED           = true
TYPE_MATCHED                        = true
QUEUE_NAME_MATCHED                  = true
SCRIPT_NAME_PRESENT                 = false
DETAIL_HYDRATED                     = true
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
docs/tasks/queue-consumer-optional-script-identity-v1.md
```

## Goal

Correct the Shared Queue-consumer verifier after Cloudflare returned one exact Worker Consumer with matching ID, type,
queue and settings but omitted optional `script_name` from both List and exact GET responses. The stopped preflight ran
before Evidence-root creation, Worker deployment, Queue send or Remote mutation.

## Source authority

Cloudflare's current Queue Consumer response schema marks `consumer_id`, `type`, `queue_name`, `script_name`, settings
and DLQ fields as optional. Therefore absence of `script_name` cannot be treated as an identity mismatch. Explicit values
must still agree with `social-mkt-sync-worker`; the exact deployed Worker version, flags and bindings remain mandatory
before Queue send.

## Implementation

- retain the existing Queue inventory, exact Consumer GET, deployment verifier and 120-second activation barrier;
- collect every explicit `script_name` across Cloudflare response sources;
- reject any explicit value other than `social-mkt-sync-worker`;
- when all API sources omit the optional field, preserve the reviewed Worker contract name and expose authority as
  `reviewed_worker_contract`;
- return `cloudflare_consumer_response` authority when at least one exact response includes the matching name;
- preserve exact one-Consumer, ID, type, queue, batch, concurrency, retry, wait and DLQ checks;
- preserve the exact Meta Ads job and three-DLQ continuation contract;
- perform zero Remote action during implementation.

## Prohibited actions

- rerun any stopped evidence root;
- send/redrive Queue messages during implementation;
- deploy Worker or mutate D1/Lark;
- change Report identity, requested-at or three-DLQ contract;
- enable Notification Admission, AI, Schedule or Production;
- start Dashboard legacy display-name backfill.

## Acceptance criteria

1. Missing `script_name` alone is accepted only when all other exact Consumer topology checks pass.
2. Any explicit conflicting script name remains fail-closed.
3. Explicit script names from multiple response sources must all match.
4. Exact Worker deployment/version/flags/bindings remain mandatory before Queue send.
5. Existing 120-second Report activation and 30-second Notification restore barriers remain unchanged.
6. Full Unit/Workers, Report reliability, Meta End-to-End, audit and Wrangler dry-run gates pass.
7. Repository implementation performs zero Remote action.

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
2. run GET-only Queue Consumer preflight under a new non-persistent preflight path;
3. create a new Finalizer/continuation evidence root only after preflight passes;
4. run exact Meta Ads 3D continuation once;
5. never repeat that root after its first Queue send;
6. run fresh SELECT-only readiness.
