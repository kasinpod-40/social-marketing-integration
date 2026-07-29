# Project Brain — Organic Dashboard Window Integrity — 2026-07-30

## Decision

Organic rolling-window KPI totals must never contain a numeric partial delta for existing content
that lacks a valid pre-period cumulative baseline.

```text
actual baseline available       => end - baseline
content published in period     => end - 0
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

The 7D value represented only the subset with usable observations and was unsuitable as a customer
KPI. It must become unavailable until valid baseline coverage exists.

## Permanent preset contract

```text
1D / 3D / 7D / 9D / 15D / 30D / 90D / CUSTOM_RANGE
```

1D is added to Dashboard settings and the Lark Dashboard blueprint. 30D remains rolling completed
days, not a calendar month.

## Operational boundary

- Fresh exact 1D/30D materializations may use the guarded Report closeout operator after merge.
- Existing deterministic 3D/7D rows must be refreshed through a separately reviewed upsert path;
  they must not be manually edited, deleted or duplicated in Lark.
- Until refreshed, customer-facing filters must not treat the old 7D numeric value as valid.
- No Worker deployment, Queue message, Remote D1/Lark write, Schedule or Production action occurred
  during repository implementation.
