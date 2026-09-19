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
  Lark batch size remain bounded and resumable. The validated latest-completed `metricDate` is passed through
  to both the durable Content observation and Coverage writer; the later processing timestamp remains separate.
- Scheduled Instagram uses `full_inventory_current` for Content inventory and Content insights only. It pages
  every currently available media item and records the Provider's current/lifetime metrics against the latest
  completed Bangkok report date. Account insights retain the exact one-day range.
- Manual/history Instagram operations retain `report_range`. Facebook and TikTok semantics are unchanged.
- The non-default Instagram mode participates in the stable operation fingerprint. A durable generation cannot
  switch from range scope to full inventory after work begins.
- D1 is the historical authority. `MKT_Content_Daily` remains a bounded cache with the existing retention job;
  increasing daily completeness does not authorize a larger table or deletion outside the reviewed retention plan.
- Live sizing found 1,929 Instagram media identities. Production therefore uses a 2,500-unit operation ceiling and
  five sequential provider units per invocation. Every unit is checkpointed before the next one; Queue concurrency
  remains one, the global per-invocation default remains one, and the hard per-invocation maximum is 25.

## Historical boundary

This repair improves snapshots from the first successful run of the new contract onward. It cannot reconstruct
Instagram or TikTok daily values for dates when the system did not observe those values. Current cumulative values
must not be copied backward or replaced with zero.

## Release boundary

PR `#863` merged and Worker version `6a34a6ee-4b11-41ee-a01f-bfe592d2e628` received 100% Production traffic with
unchanged ownership, bindings and schedules. Read-only D1 validation then found the pre-existing YouTube Content
history writer defaulted to the run date even though the scheduler and end-to-end contract had already validated
the latest completed date. The follow-up must merge/deploy before the next YouTube schedule. Live completion still
requires one new-generation scheduled run for each affected connector, D1/Lark stable-key reconciliation,
Dashboard 1/3/7/30-day readback, and no-regression checks for Facebook and TikTok. The controlled Instagram
generation is `instagram-organic-full-inventory-repair-20260918-v1`; it must resume rather than be replayed.
