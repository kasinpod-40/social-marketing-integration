# Current Task — Retained Multichannel Report Handoff Builder v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = RETAINED_MULTICHANNEL_REPORT_HANDOFF_BUILDER_V1
BRANCH                              = hotfix/retained-multichannel-report-handoff-builder-v1
EXACT_BASE                          = 79ca79c0def08a4fdcc298ea1a75a530b442868e
FINALIZER                           = PASS_EXACT_MAIN
READY_CHANNEL_COUNT                 = 7
WAITING_PLANNED_COUNT               = 1
MATERIALIZATION_EXECUTED            = false
PROVIDER_REQUEST_APPROVED           = false
QUEUE_ACTION_APPROVED               = false
REMOTE_D1_MUTATION_APPROVED         = false
REMOTE_LARK_MUTATION_APPROVED       = false
WORKER_DEPLOYMENT_APPROVED          = false
SCHEDULE_ACTIVATION_APPROVED        = false
NOTIFICATION_ADMISSION_ENABLED      = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/retained-multichannel-report-handoff-builder-v1.md
```

## Goal

Add the missing reviewed builder between exact-head SELECT-only readiness and the existing Run All Report
materialization terminal. The builder must create the retained sanitized all-channel handoff from existing
Finalizer, readiness, Meta Remote lock release and shared closeout authorities. Hand-written handoff JSON remains
forbidden.

## Confirmed exact-main evidence

User-run evidence on `main@79ca79c0def08a4fdcc298ea1a75a530b442868e` proves:

- Report Finalizer passes all Repository gates;
- Report Schema/Settings are converged with zero drift;
- Notification Runtime Settings and Worker baseline are preserved;
- Notification Admission remains false;
- Facebook, Instagram, YouTube, Meta Ads, Google Ads, WooCommerce and Chatwoot are all ready for exact
  `1D / 3D / 7D / 30D` `create_materialization`;
- TikTok Ads remains planned/skipped;
- Provider request, Remote mutation, Queue action and Worker deployment counts remain zero;
- Materialization has not executed.

## Confirmed implementation gap

The exact main tree contains:

- `scripts/report-channel-remote-readiness-reviewed-terminal.mjs`;
- `scripts/report-runtime-closeout-reviewed-multiwindow.mjs`;
- `scripts/report-all-ready-channels-terminal.mjs`;
- retained handoff validators.

It does not contain the retained all-channel handoff builder required by the prior Post-merge boundary. The earlier
handoff name `scripts/build-retained-multichannel-report-handoff.mjs` was not present and must not be treated as an
existing executable authority until this PR is reviewed and merged.

## In scope

- pure retained handoff builder using existing validators;
- guarded terminal with plan-only default;
- exact clean `main == origin/main` gate;
- exact Finalizer Head gate;
- immutable merged Meta PR #421 ancestry gate;
- exact readiness for every reviewed non-planned channel;
- per-channel existing shared closeout authority;
- private mode-0600 sanitized output;
- focused regression tests and task documentation.

## Out of scope

- Provider request;
- Queue send;
- Remote D1/Lark mutation;
- Worker deployment;
- Report materialization execution;
- Schedule or Notification Admission activation;
- Production;
- new Report, Reliability, Queue, D1, Lark or Coverage framework.

## Acceptance criteria

1. Plan-only performs zero external/Remote action.
2. Execute requires exact confirmation.
3. Dirty, detached, stale or non-main Repository state fails closed.
4. Finalizer evidence must match current exact main Head.
5. Meta Remote lock authority must equal merged PR #421 commit and be an ancestor of current main.
6. Seven non-planned channel readiness summaries must pass existing reviewed validators at exact Head.
7. TikTok Ads must be skipped only because its source status remains `planned`.
8. Output must pass existing Run All selection and retained handoff validators.
9. Output must be sanitized and written privately.
10. Builder performs zero Provider, Queue, Remote D1/Lark, deployment, Schedule and Production action.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/retained-multichannel-report-handoff.test.js
node --test tests/scripts/report-all-ready-channels.test.js
node --test tests/scripts/report-runtime-closeout-reviewed-binding.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Post-merge boundary

Builder merge alone authorizes no Remote materialization. After exact merged-main CI and a successful retained
handoff build, the existing `report-all-ready-channels-terminal.mjs --execute` remains the separately guarded
Remote mutation authority. Schedules, Notification Admission and Production remain blocked.
