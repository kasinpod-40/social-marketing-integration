# Current Task — Report Metric Migration Growth-Safe Boundary v1

## Status

```text
TASK_STATUS                   = IMPLEMENTATION_COMPLETE_CI_PASS
CURRENT_PROGRAM               = REPORT_METRIC_MIGRATION_GROWTH_SAFE_BOUNDARY_V1
BRANCH                        = fix/metric-migration-record-bound-v1
EXACT_BASE                    = 33bbb142b5a74584628e5236bc9b838d662b6003
VERIFIED_CODE_HEAD            = 093959198db19f4b285c91d7ad67fbbccd3bd5be
VERIFIED_DOC_HEAD             = b7304ba7cb8a29376cd71419568e7e3a607d55e6
PR                            = 525
BRANCH_VERIFICATION_RUN       = 31141011519
BRANCH_VERIFICATION_NUMBER    = 2267
FAILED_STAGE                  = report-metric-value-field-migration-preview
FAILED_CODE                   = REPORT_RUNTIME_FINALIZE_METRIC_FIELD_MIGRATION_UNSAFE
LIVE_RECORD_COUNT             = 642
OBSOLETE_TOTAL_RECORD_BOUND   = 500
LIVE_MIGRATION_COUNT          = 0
LIVE_PENDING_MIGRATION_COUNT  = 0
REMOTE_ACTION_AFTER_FAILURE   = 0
NOTIFICATION_ADMISSION        = false
SCHEDULE_ENABLED              = false
PRODUCTION                    = BLOCKED
```

Full contract:

```text
docs/tasks/report-metric-migration-growth-safe-boundary-v1.md
```

## Goal

Remove total Report Metric table size from migration admission. Customer data growth must not make the Finalizer fail merely because the table contains more rows.

## Root cause

`report-metric-value-field-migration.js` contained a hard-coded `MAX_RECORDS = 500` guard before migration state analysis. The post-PR #523 Finalizer therefore rejected a 642-row table even though the live plan had `migrationCount=0` and `pendingMigrationCount=0`.

This guard conflated two different concerns:

- total business table size;
- bounded mutation size for a real value-preserving migration.

The former must not be a release/runtime admission limit.

## Implementation result

PR #525 changes the existing migration implementation only:

- removes the total-table record-count ceiling;
- retains complete source/canonical value analysis and SHA-256 fingerprints;
- retains exact record-count/source-fingerprint drift checks during a real migration;
- performs actual canonical backfill writes in deterministic batches of at most 500 records;
- re-reads migration state after every batch and requires the pending count to decrease exactly by that batch size;
- preserves every legacy value and performs zero delete;
- adds regression proving 2,501 already-converged rows are admitted;
- adds regression proving a 1,201-row real backfill executes as `500 + 500 + 201` rather than failing on table size.

Branch Verification #2267 / run `31141011519` passed on exact Head `b7304ba7cb8a29376cd71419568e7e3a607d55e6`:

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

## Permanent architecture rule

Do not reintroduce `MAX_RECORDS`, `maxRecords`, row-count ceilings or equivalent total-table admission gates for Report Metric field migration.

Safety must be attached to the action being performed:

- read/verify paths scale with the complete paginated table;
- mutations are bounded per request/batch;
- source identity and fingerprints are revalidated between mutation batches;
- partial migration remains resumable and value-preserving;
- business table growth is not an error condition.

A transport/API batch-size constant is allowed because it limits one write request, not the number of records a customer may own.

## Prohibited actions

- rerun the failed Finalizer evidence root;
- run Chatwoot 1D continuation before a new exact-main Finalizer passes;
- use a larger total-table hard limit such as 2,000 as the fix;
- delete Report Metric business rows to get below a limit;
- disable legacy-value, source-fingerprint or drift checks;
- mutate Remote D1/Lark, send Queue, deploy Worker or close the Chatwoot incident during Repository implementation.

## Acceptance criteria

1. A converged Report Metric table with more than 500 and more than 2,000 rows has zero migration size blocker.
2. A real migration with more than 500 pending rows is processed in bounded write batches and converges without deleting legacy values.
3. Exact source fingerprint and record count remain stable across each real migration batch.
4. Existing partial-resume/conflict/window-ownership behavior remains fail closed.
5. Focused tests, full Unit/Workers, Report reliability, dependency audit, Wrangler dry-run and diff hygiene pass on the exact PR Head.
6. Repository implementation performs zero Remote action.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-metric-value-field-migration.test.js
node --test tests/scripts/report-metric-dashboard-compatibility-record-bound.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. create a new Finalizer evidence root; never reuse `outputs/chatwoot-post-523-33bbb142`;
3. run the current-head Report Runtime Finalizer;
4. require zero migration blockers and zero schema/settings drift;
5. only then create a new immutable Chatwoot 1D exact-continuation evidence root and run the incident continuation once;
6. run fresh SELECT-only Chatwoot readiness;
7. continue only remaining 3D/7D/30D under a separate reviewed root;
8. keep Notification Admission/Schedule disabled and Production blocked.
