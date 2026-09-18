# Organic Daily growth completeness — 2026-09-18

## Problem

- Scheduled YouTube used `syncMode=auto`. If the previous full run completed less than 24 hours earlier, the
  next valid daily generation became an incremental latest-100 snapshot. Older videos could gain views without
  receiving a Daily observation for that report date.
- Scheduled Instagram passed its one-day report range into `/me/media`. Because that endpoint is filtered by
  publication date in the adapter, only posts published on that date were observed. Older posts with new
  cumulative engagement were absent from Daily.

## Reviewed contract

- Scheduled YouTube always requests `full`. The existing source pagination, durable phases, D1 batch size and
  Lark batch size remain bounded and resumable.
- Scheduled Instagram uses `full_inventory_current` for Content inventory and Content insights only. It pages
  every currently available media item and records the Provider's current/lifetime metrics against the latest
  completed Bangkok report date. Account insights retain the exact one-day range.
- Manual/history Instagram operations retain `report_range`. Facebook and TikTok semantics are unchanged.
- The non-default Instagram mode participates in the stable operation fingerprint. A durable generation cannot
  switch from range scope to full inventory after work begins.
- D1 is the historical authority. `MKT_Content_Daily` remains a bounded cache with the existing retention job;
  increasing daily completeness does not authorize a larger table or deletion outside the reviewed retention plan.

## Historical boundary

This repair improves snapshots from the first successful run of the new contract onward. It cannot reconstruct
Instagram or TikTok daily values for dates when the system did not observe those values. Current cumulative values
must not be copied backward or replaced with zero.

## Release boundary

Repository completion does not equal Customer Production completion. Production still requires reviewed merge,
deploy with unchanged ownership/bindings, one natural scheduled run for each affected connector, D1/Lark stable-key
reconciliation, Dashboard 1/3/7/30-day readback, and no-regression checks for Facebook and TikTok.
