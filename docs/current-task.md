# Current Task — Report Metric Total-Row Ceiling Eradication v2

## Status

```text
TASK_STATUS                    = IMPLEMENTATION_COMPLETE_CI_PASS
CURRENT_PROGRAM                = REPORT_METRIC_TOTAL_ROW_CEILING_ERADICATION_V2
BRANCH                         = fix/report-metric-total-row-ceilings-v2
EXACT_BASE                     = 91792d0d2e31af1774746ad24c58f1462fa2672e
VERIFIED_CODE_HEAD             = da642ba24add3246b7a3efd961e78ffdc2d9593f
PR                             = 526
BRANCH_VERIFICATION_RUN        = 31143871367
BRANCH_VERIFICATION_NUMBER     = 2270
FAILED_STAGE                   = report-metric-value-field-migration-preview
FAILED_CODE                    = REPORT_RUNTIME_FINALIZE_METRIC_FIELD_MIGRATION_UNSAFE
LIVE_RECORD_COUNT              = 642
LIVE_FIELD                     = display_name
OBSOLETE_TOTAL_RECORD_BOUND    = 500
LIVE_MIGRATION_COUNT           = 0
LIVE_PENDING_MIGRATION_COUNT   = 0
REMOTE_ACTION_AFTER_FAILURE    = 0
NOTIFICATION_ADMISSION         = false
SCHEDULE_ENABLED               = false
PRODUCTION                     = BLOCKED
```

Full contract:

```text
docs/tasks/report-metric-total-row-ceiling-eradication-v2.md
```

## Goal

Remove total customer/business row-count ceilings from the complete executable Report Metric Finalizer chain and Dashboard Compatibility Freeze. Table growth itself must never make migration/readiness fail.

## Root cause

PR #525 fixed the base migration module, but the real Finalizer entrypoint imports `report-metric-value-field-migration-recovery-v4.js`, which delegates through recovery v3 and v2 before the base migration.

Historical guards remained in all three recovery layers:

```text
recovery-v2  MAX_RECORDS=500
recovery-v3  MAX_RECORDS=500
recovery-v4  MAX_RECORDS=500
```

Dashboard Compatibility Freeze independently retained a 2,000-row total-table ceiling. The second exact-main Finalizer therefore stopped at 642 rows from recovery v4 despite zero pending migration.

## Implementation result

Draft PR #526 changes the existing chain in place:

- removes total-row admission from recovery v2;
- removes total-row admission from recovery v3;
- removes total-row admission from recovery v4;
- removes the 2,000-row total-table ceiling from Dashboard Compatibility Freeze;
- keeps the base growth-safe migration from PR #525;
- reuses `LarkBitableClient.listRecords()` pagination;
- reuses `LarkBitableClient.batchUpdateRecords()` request chunking and partial-write progress handling;
- adds no migration engine, batching engine, writer or wrapper;
- retains exact Field identity, Number/Select parity, canonical/Legacy value checks, source fingerprints and record-count drift checks;
- preserves legacy values and deletes nothing.

Branch Verification #2270 / run `31143871367` passed on exact code Head `da642ba24add3246b7a3efd961e78ffdc2d9593f`:

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

## Regression

- Compatibility Freeze accepts 2,501 exact compatible rows with full parity.
- Exact recovery-v4 path used by the Finalizer accepts 2,501 exact compatible rows with pending migration 0 and Remote mutation 0.
- Static source audit rejects reintroduction of:
  - `MAX_RECORDS`;
  - `MAX_REPORT_METRIC_RECORDS`;
  - `REPORT_METRIC_FIELD_MIGRATION_RECORD_BOUND_EXCEEDED`;
  - `REPORT_METRIC_COMPATIBILITY_FREEZE_RECORD_BOUND_EXCEEDED`.
- Existing v2/v3/v4 migration, conflict, archive, parity and value-preservation regressions remain required.

## Permanent architecture rule

Total customer/business table size is not a migration, Finalizer or Dashboard compatibility admission contract.

Safety is attached to the operation:

- full reads: shared pagination;
- writes: shared bounded request chunks;
- partial writes: shared progress handling;
- migration identity: exact Field/source fingerprints;
- source drift: fail closed;
- Business/Legacy delete: forbidden.

Do not replace the removed ceilings with a larger number.

## Immutable failed evidence

Never rerun or delete:

```text
outputs/chatwoot-post-523-33bbb142
outputs/chatwoot-post-525-91792d0d
```

## Prohibited actions

- run another Finalizer before PR #526 is merged;
- run Chatwoot 1D continuation before a new exact-main Finalizer succeeds;
- close/redrive the retained Chatwoot DLQ/Alert;
- add another migration/batching framework;
- delete Report Metric rows to reduce table size;
- weaken identity, parity, fingerprint or source-drift checks;
- mutate Remote D1/Lark, send Queue, deploy Worker or enable Schedule/Production during Repository implementation.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-metric-total-row-ceiling-regression.test.js
node --test tests/scripts/report-metric-dashboard-compatibility-record-bound.test.js
node --test tests/scripts/report-metric-dashboard-compatibility-freeze.test.js
node --test tests/scripts/report-metric-value-field-migration-recovery.test.js
node --test tests/scripts/report-metric-value-field-migration-recovery-v3.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. create a brand-new Finalizer evidence root;
3. run current-head Report Runtime Finalizer;
4. require zero migration blockers and zero schema/settings drift;
5. run the exact Chatwoot 1D incident continuation once under a brand-new immutable root;
6. require D1 `1`, Lark Snapshot `1`, Metrics `139`, duplicate `0`, exact integrity and exact DLQ/Alert closure;
7. run fresh SELECT-only Chatwoot readiness;
8. continue only remaining 3D/7D/30D under a separate reviewed root;
9. keep Notification Admission/Schedule disabled and Production blocked.
