# Organic Dashboard Window Integrity Hotfix v1

## Status

```text
WORKSTREAM                       = ORGANIC_DASHBOARD_WINDOW_INTEGRITY_V1
BRANCH                           = hotfix/organic-dashboard-window-integrity-v1
IMPLEMENTATION_BASE_MAIN         = 527cdceda2d4661c82dc000380705d1078343bdf
ALIGNED_MAIN                     = 67a82551749569d74b9e4b66a32c82e5715b1d40
DRAFT_PR                         = #255
BRANCH_VERIFICATION              = #1092 / 30489571353 / PASS
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
WORKER_DEPLOYMENT                = NOT_RUN
QUEUE_MESSAGE                    = NOT_SENT
REMOTE_D1_MUTATION               = NONE
REMOTE_LARK_MUTATION             = NONE
SCHEDULE_MUTATION                = NONE
PRODUCTION                       = BLOCKED
```

## Incident

The live TikTok Organic Dashboard materializations showed:

```text
3D Views = 193,722
7D Views = 5,309
3D baseline coverage ~= 0.9990
7D baseline coverage ~= 0.0015
```

Both windows used the same period end. For non-negative cumulative Organic counters, a longer complete
window cannot be lower than its nested shorter window unless a proven provider correction occurred.
The 7D result was not a valid complete-window total.

## Confirmed root cause

`calculateOrganicPeriodMetrics()` used the first observation inside the requested period as a
`partial_first_snapshot` baseline when an older pre-period baseline was missing. It then subtracted
that in-period observation from the latest observation and included the partial delta in aggregate
KPI totals.

This produced a small numeric value that looked like a complete 7D total even though most tracked
content had no valid 7D baseline.

## Correction contract

- Actual pre-period baseline: calculate the cumulative delta normally.
- Content published inside the period: retain the reviewed zero-baseline rule.
- Existing content without a pre-period baseline: every period delta is `null`, never a fabricated
  partial number and never observed zero.
- Aggregate Views/Likes/Comments/Shares/Engagement use strict null propagation. One uncovered old
  content row makes the affected aggregate KPI unavailable.
- Latest cumulative totals, tracked-content count and baseline coverage remain available for
  diagnostics.
- `data_status=partial` remains visible.
- Provider corrections may remain negative; the implementation does not clamp or force longer
  windows to equal shorter windows.

## Dashboard presets

Canonical rolling presets are now:

```text
1D / 3D / 7D / 9D / 15D / 30D / 90D
```

The Dashboard settings count becomes:

```text
2 TikTok compatibility settings
+ 7 platform scopes x (7 rolling presets + 1 custom range)
= 58 active canonical settings
```

30D already existed in the period resolver and settings contract. This workstream adds the missing
1D Dashboard setting/blueprint contract and keeps 30D explicitly targetable.

## Guarded fresh materialization targeting

The existing Report closeout operator can target a fresh exact window by environment variable.
Each execution uses a separate private evidence directory because automatic repetition inside one
evidence directory remains blocked.

```bash
MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS=1 \
MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR=outputs/report-runtime-closeout-1d \
CONFIRM_REPORT_RUNTIME_CLOSEOUT=EXECUTE_REPORT_RUNTIME_CLOSEOUT \
node scripts/report-runtime-closeout.mjs --execute
```

```bash
MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS=30 \
MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR=outputs/report-runtime-closeout-30d \
CONFIRM_REPORT_RUNTIME_CLOSEOUT=EXECUTE_REPORT_RUNTIME_CLOSEOUT \
node scripts/report-runtime-closeout.mjs --execute
```

The operator still fails closed when that exact report identity already exists. Existing 3D/7D
materializations are not deleted, duplicated or overwritten by this fresh-only selector. Refreshing
an existing deterministic materialization remains a separately guarded operational step after this
formula hotfix is merged.

## Validation

```text
Focused Organic/Dashboard tests       33/33 PASS
Branch Verification                   #1092 / 30489571353 PASS
Install locked dependencies           PASS
Syntax / architecture / hygiene       PASS
Focused staged TikTok regression      PASS
Unit and Workers runtime              PASS
Report reliability regression         PASS
Dependency audit                       PASS
Wrangler dry-run                       PASS / no deployment
```

## Safety boundary

Implementation and CI did not deploy a Worker, send Queue/DLQ messages, mutate Remote D1 or Lark,
change a Schedule or Secret, run Live UAT, alter Production traffic, delete Business facts or merge
the implementation PR.
