# Current Task — Chatwoot 1D Post-Projection Resume v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_CI_PASS
CURRENT_PROGRAM                     = CHATWOOT_1D_POST_PROJECTION_RESUME_V1
BRANCH                              = hotfix/chatwoot-1d-post-projection-resume-v1
EXACT_BASE                          = e4bf6353d2e095662d00ae1f1149977200ff6579
VERIFIED_CODE_HEAD                  = 5021eec0c7404391785ccafad803106e3c6790f0
BRANCH_VERIFICATION_RUN             = 31150997179
BRANCH_VERIFICATION_NUMBER          = 2280
D1_MATERIALIZATION_COUNT            = 1
LARK_SNAPSHOT_COUNT                 = 1
LARK_METRIC_COUNT                   = 139
LARK_TOP_CONTENT_COUNT              = 0
LARK_TOP_ADS_COUNT                  = 0
INCIDENT_CLOSURE_ATTEMPTED          = false
QUEUE_ACTION_COUNT                  = 0
WORKER_DEPLOYMENT_COUNT             = 0
PROVIDER_REQUEST_COUNT              = 0
NOTIFICATION_ADMISSION              = false
SCHEDULE_ENABLED                    = false
PRODUCTION                          = BLOCKED
```

## Goal

Resume the exact Chatwoot 1D incident after the retained D1 materialization has already been projected to Lark successfully. The prior failure was verifier-only: the old verifier misclassified valid dimensional rows because it used business `metric_key` instead of stable `report_metric_key`.

Immutable failed evidence:

```text
outputs/chatwoot-post-528-bc7a5375/chatwoot-1d-d1-lark-recovery
```

Do not rerun, delete, reset or clean that root. The existing 1 Snapshot + 139 Metric rows are retained valid projection evidence and must not be manually deleted or deduplicated.

## Correction

Keep the existing recovery operator and shared writer. Extend only its exact prestate/write-result contract:

```text
needs_projection   = D1 1 / Lark 0 + 0
already_projected  = D1 1 / Lark 1 + 139 / duplicate report_metric_key 0
```

The shared `TableSyncEngine` already plans by stable key and skips unchanged rows. For the already-projected resume, the writer result must be exactly:

```text
created = 0
updated = 0
skipped = 140
```

The only other allowed write shape remains the original first projection:

```text
created = 140
updated = 0
skipped = 0
```

Any partial create, any update, missing row or duplicate stable key blocks incident closure.

## Verification result

Branch Verification #2280 / run `31150997179` passed on exact code Head `5021eec0c7404391785ccafad803106e3c6790f0`:

```text
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
```

Regression coverage proves:

- exact Lark-empty state remains `needs_projection`;
- exact Lark 1/139 with zero stable duplicates is `already_projected`;
- partial Lark states still fail closed;
- first projection accepts only `created=140 / updated=0 / skipped=0`;
- post-projection resume accepts only `created=0 / updated=0 / skipped=140`;
- any update or partial create fails before incident closure;
- no Queue, Worker, Provider or Production path was added.

## Required result

```text
D1 materialization                  1
D1 payload/checksum                 unchanged
Retained Sync status                failed
Lark Snapshot                       1
Lark Metrics                        139
Duplicate report_metric_key         0
Resume Lark mutation                0
D1/Lark stable-key integrity        PASS
Retained DLQ                        closed/completed after integrity
Retained Critical Alert             resolved after integrity
Queue sends                         0
Worker deployments                  0
Provider requests                   0
Notification Admission              false
Schedule                            disabled
Production                          BLOCKED
```

## Prohibited actions

- rerun any failed evidence root;
- delete or manually deduplicate the existing 139 Lark rows;
- resend Queue work;
- deploy a Report Worker;
- mutate the retained D1 payload/checksum;
- create a replacement Report ID;
- accept partial create/update during resume;
- close DLQ/Alert before D1/Lark stable-key integrity passes;
- enable Notification Admission, Schedule or Production.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-chatwoot-1d-d1-lark-recovery.test.js
node --test tests/scripts/report-runtime-chatwoot-1d-d1-lark-recovery-source.test.js
node --test tests/scripts/report-runtime-closeout-stable-metric-integrity.test.js
node --test tests/scripts/report-runtime-closeout-reviewed-state.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. run current-head Finalizer under a new evidence root;
3. run the existing exact Chatwoot D1/Lark recovery under a new immutable root;
4. require writer result `created=0 / updated=0 / skipped=140`;
5. require D1 unchanged and Lark stable-key integrity PASS;
6. close/read back only the exact retained DLQ + Critical Alert;
7. run fresh SELECT-only Chatwoot readiness;
8. derive remaining 3D/7D/30D actions from fresh state only.
