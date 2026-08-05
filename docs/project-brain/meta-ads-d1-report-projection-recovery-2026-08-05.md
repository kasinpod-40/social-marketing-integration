# Project Brain — Meta Ads D1 Report Projection Recovery

Date: `2026-08-05`

## Locked runtime truth

The exact Meta Ads 3D configuration-DLQ recovery on merged
`main@5b35861553d2a3074409635458d323b33641d994` submitted the retained job once. The Worker accepted and attempted
the job six times, but every `dashboard_performance_report` Sync Run failed with
`D1_ADS_REPORT_READ_FAILED` before any Report materialization or Lark write.

```text
Report ID         integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
Recovery start    1785938483493
Failed runs       6
Materialization   0
Work/Lock         0 / 0
Original DLQ      terminal:e408707c9c2d383e04a3e213a7be45a0
New DLQ           dlq:2f292f08f5bdc4f12c91b68ceff71e1b
Baseline          restored Notification Runtime
```

The new DLQ is a Queue retry-exhaustion record. Both DLQs remain open forensic evidence. Neither is authorized for
generic redrive, deletion or closure.

## Repository finding

The Shared `D1AdsReportSource` broad-read path used `SELECT *` for the Ads fact, entity and Coverage tables. The
fact table includes large retained source JSON fields that are not consumed by Report metrics or Top Ads.

The correction uses explicit minimum projections only. Stable keys, bounded limits, query filters, ordering,
Coverage selection, aggregate-before-ratio semantics and Top Ads remain unchanged.

## Root-cause classification

Current classification:

```text
LEADING_HYPOTHESIS = D1_RESULT_PROJECTION_TOO_BROAD_FOR_META_ADS_3D
PROVEN              = false
```

Why it leads:

- 1D passed through the same reader;
- 3D failed six times at the same D1-read stage;
- no target write occurred;
- the larger period can return substantially more detailed rows and retained JSON bytes.

The classification becomes proven only after read-only row/byte evidence or successful exact continuation on the
projected reader.

## Continuation authority

The old recovery evidence root must never be repeated. A new continuation must first bind the new DLQ's exact
message, payload hash, operation metadata, historical work key, generation and attempt counts. It may then send only
the exact original Meta Ads 3D job once under a reviewed Active Report window.

Replay, baseline restore and closure of both forensic DLQs occur only after D1/Lark integrity proof. No replacement
Report identity, Provider refresh or manual D1/Lark repair is permitted.

## Safety state

```text
Provider request                0
Notification Admission         false
Schedule                        false
Production                      BLOCKED
Current Worker baseline         Notification Runtime active
Active Report Work/Lock         0 / 0
```

## Remaining Dashboard defect

`__mkt_legacy_display_name_single_select_v2` remains a separate Shared Lark writer/backfill defect. It is not fixed
by Report materialization recovery and must be repaired after all ready-channel windows close.
