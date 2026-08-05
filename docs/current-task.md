# Current Task — Report D1 Read Retry & Diagnostics Hotfix v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = REPORT_D1_READ_RETRY_DIAGNOSTICS_V1
BRANCH                              = hotfix/d1-read-retry-diagnostics-v1
EXACT_BASE                          = 392673893e390019019f04b299185782214d965d
PRIOR_FACEBOOK_REUSE_FIX            = MERGED
LATEST_RUN_ALL_RESULT               = FACEBOOK_COMPLETED_THEN_STOPPED_BEFORE_INSTAGRAM_DEPLOY
INSTAGRAM_FAILURE_STAGE             = lark-and-instagram-d1-preflight
INSTAGRAM_ACTIVE_DEPLOYMENT         = false
INSTAGRAM_QUEUE_ACTION              = 0
INSTAGRAM_REMOTE_WRITE              = 0
PROVIDER_REQUEST_COUNT              = 0
NOTIFICATION_ADMISSION_ENABLED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/report-d1-read-retry-diagnostics-v1.md
```

## Goal

Make the existing shared Report D1 read path resilient to bounded transient `wrangler d1 execute --remote --json`
failures while preserving the exact final command diagnostics needed to distinguish Cloudflare/CLI failures from
SQL defects. No Queue, Worker, D1 write, Lark write, Provider or Schedule action is part of this Repository hotfix.

## Confirmed incident

The exact-head Run All on `main@392673893e390019019f04b299185782214d965d` passed the pre-Run readiness gates.
Facebook executed first. Run All then stopped before Instagram deployment while executing the same Instagram
SELECT-only D1 preflight query that had passed during readiness.

```text
stage                       lark-and-instagram-d1-preflight
activeDeploymentAttempted   false
baselineRestoreVerified     false
remoteWriteCount            0
queueActionCount             0
workerDeploymentCount       0
providerRequestCount        0
production                  BLOCKED
```

The shared command runner surfaced only the generated command and numeric exit code. It discarded `stderr`, so the
result cannot yet distinguish a transient Cloudflare/CLI failure from a persistent SQL error. The correct response
is not to rerun the old Run All block and not to add an Instagram-specific wrapper.

## Root correction

Update only `createReviewedStateRuntime().readD1Rows()`:

- retry failed SELECT-only D1 command execution up to three bounded attempts;
- use a fixed short delay between attempts;
- do not retry after a successful command returns invalid JSON;
- after the final failed attempt, throw `REPORT_RUNTIME_CLOSEOUT_D1_READ_FAILED`;
- retain only bounded `sourceCode`, `sourceSignal`, `stderr` and `stdout` diagnostics;
- never include the SQL command text or environment secrets in the new error details;
- keep all D1 writes, backups and migrations outside this retry path.

## Acceptance criteria

1. Two transient command failures followed by success return the exact D1 row.
2. Permanent command failure stops after the configured bounded attempt count.
3. Final failure exposes compact command diagnostics without propagating SQL text.
4. Invalid JSON after a successful command fails immediately as
   `REPORT_RUNTIME_CLOSEOUT_D1_RESPONSE_INVALID`.
5. Existing Report readiness, closeout, recovery and reliability tests continue to pass.
6. Post-merge resume begins with a new exact-head Finalizer and SELECT-only readiness for Facebook and Instagram.
7. Existing materializations are reused; no old handoff or old evidence directory is reused.
8. Notification Admission, Schedule and Production remain blocked.

## Implementation result

Implemented on the branch above:

- added three-attempt bounded retry to the shared D1 SELECT reader;
- added sanitized final `stderr/stdout` diagnostics;
- added regression tests for transient success, permanent failure and invalid JSON;
- no Remote action was performed.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-closeout-reviewed-state.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Post-merge boundary

1. synchronize clean exact `main`;
2. rerun Report Runtime Finalizer for the new Head;
3. run Facebook and Instagram SELECT-only readiness first;
4. require zero Work/Lock/DLQ and exact D1/Lark integrity for all existing windows;
5. run readiness for the remaining channels and build a new exact-head retained handoff;
6. resume Run All once under a new evidence root;
7. never rerun `outputs/report-live-resume-392673893e39`.
