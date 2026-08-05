# Current Task — Report Queue Consumer Hydration Hotfix v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_CI_PASS
CURRENT_PROGRAM                     = REPORT_QUEUE_CONSUMER_HYDRATION_V1
BRANCH                              = hotfix/queue-consumer-hydration-v1
EXACT_BASE                          = 3d28aebd228446dcbd780006f337c0b3a4ca4be5
VERIFIED_IMPLEMENTATION_HEAD        = 4743e864da2f5a05af946929dc802f9bcc392dc0
PR                                  = 517
BRANCH_VERIFICATION_RUN             = 31025681936
BRANCH_VERIFICATION_NUMBER          = 2247
META_END_TO_END_RUN                 = 31025683031
META_END_TO_END_NUMBER              = 452
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

## Implementation result

Implemented on Draft PR #517 without Remote execution:

- retained the existing Queue inventory, Worker-version barrier, Report Finalizer and continuation operator;
- List Queue Consumers now requires exactly one non-empty `consumer_id` rather than mandatory optional fields;
- added exact GET Queue Consumer hydration for optional identity/settings fields;
- retained Queue-list embedded Consumer data as an additional exact source;
- rejects any explicit Consumer ID, type, queue name, script name, settings or DLQ disagreement;
- diagnostics expose only booleans/counts and never credentials or unrestricted API bodies;
- preserved the Report 120-second activation barrier and Notification 30-second restore barrier;
- preserved the existing Meta Ads job identity and exact three-DLQ continuation contract;
- added regression coverage for sparse List response, exact detail hydration, explicit drift and identity mismatch;
- Repository Remote actions: zero.

Exact implementation Head `4743e864da2f5a05af946929dc802f9bcc392dc0` passed:

```text
Branch Verification #2247 / run 31025681936
Install locked dependencies                 PASS
Syntax architecture and hygiene             PASS
Focused Report source readiness tests       PASS
Focused Meta history finalizer tests         PASS
Focused Woo completed-state race tests       PASS
Focused Chatwoot final UAT tests              PASS
Focused staged TikTok tests                  PASS
Unit and Workers runtime tests               PASS
Report reliability regression               PASS
Dependency audit                             PASS
Wrangler dry run                             PASS
Diff whitespace check                        PASS

Meta End-to-End #452 / run 31025683031
Diff hygiene                                 PASS
Syntax architecture and repository hygiene  PASS
Focused Meta workstream tests                PASS
Unit and Workers runtime tests               PASS
Report reliability regression               PASS
Dependency audit                             PASS
Wrangler dry run                             PASS
```

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
