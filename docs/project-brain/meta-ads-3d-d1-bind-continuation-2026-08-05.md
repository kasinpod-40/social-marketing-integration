# Project Brain — Meta Ads 3D D1 Bind Continuation

Date: `2026-08-05`

## Proven live root cause

SELECT-only D1 inspection proved the exact reason Meta Ads 1D succeeded while 3D failed six times:

```text
1D unique Ads / bindings   77 / 80
3D unique Ads / bindings  102 / 105
Reviewed D1 ceiling             100
Classification          ENTITY_BIND_LIMIT_CONFIRMED
```

The old Shared `D1AdsReportSource` used one `ads_entity_state` query containing three fixed bindings plus every
unique ranking Ad ID. PR #513 merged deterministic 97-ID chunks into `main@2f87f7f342847a5dcd0cf794cd0a74e55ab76068`.
PR #512 had already removed broad unneeded Paid Ads projections. Together they correct both identified D1-read risks.

## Retained runtime truth

The first exact recovery submitted the original Meta Ads 3D job once. Cloudflare attempted it six times and all six
runs failed with `D1_ADS_REPORT_READ_FAILED` before D1 materialization or Lark write. It then created the exact
Queue retry-exhaustion DLQ below. Notification Runtime baseline was restored and no Work/Lock remains.

```text
Original configuration DLQ  terminal:e408707c9c2d383e04a3e213a7be45a0
Retry-exhaustion DLQ        dlq:2f292f08f5bdc4f12c91b68ceff71e1b
Prior successful runs       2
Failed recovery runs        6
Materialization             0
Active Work/Lock            0 / 0
Notification Admission      false
Schedule                    false
Production                  BLOCKED
```

Both DLQs remain open forensic evidence until exact continuation succeeds.

## Continuation authority

The failed recovery root and prior Run All handoff are immutable and must never be repeated. The continuation operator
is bound to:

- exact merged fixed Head;
- exact-head Report Finalizer;
- retained failed-recovery attempt;
- retained 102-Ad/105-binding inspector;
- both exact DLQ rows and operation metadata;
- original Report ID, job hash, requested-at, period and source watermark;
- six failed runs, two prior successes and empty D1/Lark target.

It sends the original job once, verifies D1/Lark, sends one exact replay, restores Notification Runtime and only then
closes both retained DLQs. It reuses existing Shared Report, Queue, deployment, D1/Lark integrity and closure helpers.

## Remaining Report work

After continuation passes, fresh SELECT-only readiness must classify the remaining Meta Ads 7D/30D windows and all
later channels. Do not rerun the old all-channel root. The separate
`__mkt_legacy_display_name_single_select_v2` Dashboard compatibility backfill remains pending after 28-window closure.
