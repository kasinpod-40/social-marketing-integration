# Current Task — Chatwoot Daily Partial Report Coverage v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = CHATWOOT_DAILY_PARTIAL_REPORT_COVERAGE_V1
BRANCH                              = hotfix/chatwoot-daily-partial-report-coverage-v1
EXACT_BASE                          = 7a64a84654f0e106c89ca44d2904edf7d354e98c
FAILED_CLOSEOUT_ROOT                = outputs/chatwoot-post-533-3720f3a1/chatwoot-1d-3d-7d-30d-final-closeout
CHATWOOT_1D_REUSE_VERIFIED          = true
CHATWOOT_3D_FIRST_QUEUE_SENT        = true
CHATWOOT_3D_REPLAY_SENT             = false
CHATWOOT_7D_STARTED                 = false
CHATWOOT_30D_STARTED                = false
CHATWOOT_3D_D1_MATERIALIZATION      = 1
CHATWOOT_3D_DATA_STATUS             = source_unavailable
CHATWOOT_3D_SYNC_STATUS             = success
CHATWOOT_3D_ACTIVE_LOCK             = 0
CHATWOOT_3D_NEW_DLQ                 = 0
BASELINE_RESTORE_VERIFIED           = true
PROVIDER_REQUEST_COUNT              = 0
NOTIFICATION_ADMISSION              = false
SCHEDULE_ENABLED                    = false
PRODUCTION                          = BLOCKED
```

## Incident

After PR #533 fixed mapped handoff authority consumption, the reviewed Chatwoot multiwindow closeout reached real execution.

The retained attempt proved:

```text
1D                           reuse verified / Queue 0
3D first Queue               sent exactly once
3D Report ID                 retained / one D1 materialization
3D Sync                      success
3D active lock               0
3D new DLQ                   0
3D data_status               source_unavailable
3D replay                    not sent
7D / 30D                     not started
Worker baseline restore      verified
```

The closeout correctly stopped with:

```text
REPORT_RUNTIME_CLOSEOUT_COMPLETION_INCOMPLETE
```

Do not rerun, delete, reset or clean the failed evidence root. Do not blindly resend the retained 3D first job.

## Confirmed root cause

The Chatwoot ingestion writer and Report reader disagreed about daily fact state.

`prepareChatwootAnalyticsSync()` intentionally persists Conversation/Agent/Inbox/Account Daily rows as:

```text
data_status = partial
```

After all required sinks succeed, `finalizeChatwootCoverageRuns()` finalizes Coverage runs to `complete`; it does not rewrite the daily fact rows.

`D1ChatwootReportSource` previously accepted only:

```text
complete
completed
no_data_confirmed
```

for daily rows. Therefore finalized required Coverage plus valid writer-native `partial` facts still produced `coverage.complete=false`. `calculateChatwootPeriodMetrics()` then emitted `source_unavailable` with null Business metrics.

The shared closeout completion gate is correct and must not be weakened to accept `source_unavailable`.

## Correction

Reuse the existing Chatwoot D1 source, Coverage contract, readiness classifier and reviewed multiwindow closeout.

### Chatwoot D1 source

Admit writer-native `partial` daily fact/snapshot rows while retaining every existing finalized-Coverage requirement:

- exact required datasets `chatwoot.conversation_daily` and `chatwoot.account_daily`;
- both required Coverage rows selected;
- both watermarks present;
- accepted finalized Coverage status;
- `failed_rows=0`;
- existing bounded read and timezone guards.

`partial` row state alone must never make a period complete.

### Readiness

When current source readiness is valid, an existing D1 materialization with:

```text
data_status = source_unavailable
```

must classify as:

```text
refresh_or_repair_materialization
```

not `reuse_or_idempotent_verify`, even when the retained D1/Lark projection is internally stable.

No replacement Report ID, new recovery engine, new Coverage writer, new Queue framework or global status alias is allowed.

## Regression requirements

- writer-native `partial` Conversation/Account Daily rows plus both finalized Coverage datasets => source `coverage.complete=true`;
- missing required Coverage dataset => incomplete;
- any required Coverage `failed_rows>0` => incomplete;
- existing `source_unavailable` materialization + stable D1/Lark parity => repair;
- existing `complete` materialization + same stable D1/Lark parity => reuse;
- global closeout completion continues rejecting `source_unavailable`;
- existing Chatwoot, WooCommerce, Meta, TikTok and shared Report regressions remain green.

## Required verification

```bash
npm ci
npm run check
node --test tests/connectors/d1-chatwoot-report-partial-daily-coverage.test.js
node --test tests/connectors/d1-chatwoot-report-source.test.js
node --test tests/scripts/report-channel-remote-readiness-materialization-status.test.js
node --test tests/scripts/report-channel-remote-readiness.test.js
node --test tests/application/chatwoot-report-materialization.test.js
node --test tests/application/chatwoot-report-materialization-source.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. run current-head Finalizer under a brand-new evidence root;
3. run fresh SELECT-only readiness for all reviewed non-planned channels;
4. require Chatwoot readiness to derive actions from current retained D1/Lark state, expected `1D repair / 3D repair / 7D create / 30D create`;
5. build a brand-new retained multichannel handoff from those exact-head readiness files;
6. run the existing reviewed Chatwoot multiwindow closeout under a brand-new immutable root;
7. preserve the exact existing Report IDs; do not manually delete or replace 1D/3D materializations;
8. require successful repair/fresh materialization, replay, stable D1/Lark integrity and verified Worker baseline restore;
9. run fresh Chatwoot readiness and require all `1D/3D/7D/30D` to become `reuse_or_idempotent_verify`;
10. keep Notification Admission and Schedule disabled and Production blocked.
