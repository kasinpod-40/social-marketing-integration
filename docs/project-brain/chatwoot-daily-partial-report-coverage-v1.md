# Chatwoot Daily Partial Report Coverage v1

## Authority

```text
Program          CHATWOOT_DAILY_PARTIAL_REPORT_COVERAGE_V1
Exact base       7a64a84654f0e106c89ca44d2904edf7d354e98c
Environment      Integration Workspace / development only
Production       BLOCKED
```

## Retained live boundary

The reviewed Chatwoot multiwindow closeout root below is immutable and must never be rerun, deleted, reset or cleaned:

```text
outputs/chatwoot-post-533-3720f3a1/chatwoot-1d-3d-7d-30d-final-closeout
```

Retained facts from that attempt:

```text
1D                              reuse verified / Queue 0
3D first Queue                  sent exactly once
3D D1 materialization          1
3D retained data_status        source_unavailable
3D retained Sync               success
3D active lock                 0
3D new DLQ                     0
3D replay                      not sent
7D / 30D                       not started
Worker active window           attempted
Worker baseline restore        verified
Provider requests              0
Production                     BLOCKED
```

## Confirmed contract mismatch

`prepareChatwootAnalyticsSync()` intentionally writes Conversation Daily, Agent Daily, Inbox Daily and Account Daily rows with:

```text
data_status = partial
```

After every required sink succeeds, `finalizeChatwootCoverageRuns()` finalizes the corresponding Coverage runs to `complete`, sets `written_rows`, keeps `failed_rows=0` and records `completed_at`. It does not rewrite the already persisted daily fact rows from `partial` to `complete`.

The D1 Chatwoot Report source previously accepted fact-row statuses only from:

```text
complete
completed
no_data_confirmed
```

Therefore valid writer-native `partial` daily rows made `coverage.complete=false` even when the exact required Coverage datasets were finalized, watermarked and failure-free. The period calculator then truthfully emitted `source_unavailable` and null Business metrics. The shared closeout completion gate correctly rejected that materialization.

## Permanent rule

For Chatwoot Report source reads:

- writer-native daily fact `partial` is an admissible row state;
- period completeness is still governed by the exact finalized required Coverage datasets;
- both `chatwoot.conversation_daily` and `chatwoot.account_daily` must be selected;
- both required Coverage watermarks must exist;
- each selected Coverage status must remain accepted by the existing contract;
- total failed rows must remain zero;
- timezone drift and bounded-read guards remain unchanged;
- missing/failed Coverage must keep the Report unavailable;
- `source_unavailable` must never be added to the global closeout success-status set.

## Retained materialization repair rule

When current source readiness is valid, an existing materialization with:

```text
data_status = source_unavailable
```

must not be classified as `reuse_or_idempotent_verify` merely because its retained D1/Lark rows are internally consistent. It is classified as `refresh_or_repair_materialization` and repaired through the existing shared multiwindow closeout path using the same Report identity.

No replacement Report ID, new Report engine, new Coverage writer, new Queue framework or channel-specific closeout engine is introduced.

## Expected post-merge readiness

After current-head Finalizer and fresh SELECT-only readiness, the retained boundary is expected to classify as:

```text
1D   refresh_or_repair_materialization
3D   refresh_or_repair_materialization
7D   create_materialization
30D  create_materialization
```

The exact observed readiness remains the authority; this expectation does not authorize blind execution.

Notification Admission and Schedule stay disabled and Production stays blocked.
