# Project Brain — Organic Dashboard Window Integrity — 2026-07-30

## Decision

Organic rolling-window KPI totals must never contain a numeric partial delta for existing content
that lacks a valid pre-period cumulative baseline.

```text
actual baseline available        => end - baseline
content published in period      => end - 0
old content baseline unavailable => null / partial
```

Observed zero remains `0`. Missing remains `null`. Negative provider corrections remain permitted
when supported by actual cumulative observations.

## Incident evidence

```text
TikTok Organic 3D Views             193,722
TikTok Organic 7D Views               5,309
3D baseline coverage                  0.9990
7D baseline coverage                  0.0015
```

The prior values represented only subsets with usable observations and were unsuitable as customer
KPIs. Any affected aggregate must become unavailable until valid baseline coverage exists.

## Permanent preset contract

```text
1D / 3D / 7D / 9D / 15D / 30D / 90D / CUSTOM_RANGE
```

1D is included in Dashboard settings and the Lark Dashboard blueprint. 30D remains rolling completed
days, not a calendar month. The canonical active Report Setting count is 58.

## Operational boundary

- Fresh exact 1D/30D materializations use the guarded Report closeout path.
- Existing deterministic 3D/7D rows are regenerated through the normal Queue and shared D1/Lark
  stable-key upsert path; they are never manually edited, deleted or duplicated.
- The reviewed one-command sequence is `3D refresh -> 7D refresh -> 1D fresh -> 30D fresh` after the
  Schema/Settings finalizer succeeds on the exact merged `main` HEAD.
- Every window verifies D1/Lark metric-key and value parity.
- When `coverageRate < 1`, all six aggregate period KPI values must be null in both D1 and Lark.
- Each active Report-only deployment is automatically restored to all-false before the next window.
- Connector calls, AI, schedules, Production and customer LIVE actions remain outside this repair.

## Repository status

PR #255 merged to `main` as `29555867f867dd9f3d3ace15b74930838a0f353a`, establishing the
strict-null formula and 1D/30D targeting foundation. The follow-up repair operator is implemented on
a separate review branch and must merge before the one Terminal command is run.
