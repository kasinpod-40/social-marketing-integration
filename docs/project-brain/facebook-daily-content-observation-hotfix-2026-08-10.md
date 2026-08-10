# Facebook Daily Content Observation Hotfix — 2026-08-10

## Incident

After Lark rolling Report current-slot retention converged, Facebook Organic Dashboard 7D still showed zero for all 17 content KPIs.

A live read-only Lark audit proved the Dashboard binding was no longer the blocker:

- Facebook 7D Report Metric rows: 25
- non-null current values: 5
- non-zero current values: 1 (`account_followers=181448`)
- `tracked_content_count=0`
- `latest_total_views=null / not_observed`
- Report Snapshot `source_snapshot_count=0`
- `MKT_Content` Facebook rows: 28
- `MKT_Content_Daily` Facebook rows: 0

No mutation occurred during the audit.

## Root cause

The scheduled Meta Organic job uses the previous completed Bangkok day as its report range. `processMetaEndToEndSync()` forwarded that same range to Facebook content inventory discovery and then fetched content insights only for IDs returned by that publication-range inventory.

On a day with no newly published Facebook post, the content inventory returned zero IDs. The source pipeline therefore skipped content insights for all 28 already-tracked posts and wrote no Organic content daily observations. The Shared Report correctly emitted `not_observed`/null content metrics and `source_snapshot_count=0`; Lark KPI cards rendered those missing values visually as zero.

This is a source-observation defect, not a Dashboard selector defect.

## Correction

For Facebook only:

- a one-day source range is treated as a **daily observation boundary**;
- Facebook content inventory is read without publication-date filters so existing tracked/current Page posts can be observed;
- content/account insight calls remain bound to the requested one-day metric range;
- multi-day history inventory remains publication-range bounded and keeps the reviewed exclusive Provider `until` translation;
- existing source pagination, source-unit/page/row limits, stable D1/Lark keys and Reliability flow remain unchanged.

Instagram remains period-bounded; this hotfix does not reintroduce the previously rejected full-account Instagram inventory behavior.

## Safety

- historical Facebook R2 operation is immutable and must not be replayed;
- no Provider/D1/Lark/Queue/Worker action occurs in repository implementation;
- missing metrics stay null; no zero fabrication;
- Production remains blocked.

## Post-merge live gate

Use a brand-new controlled Facebook daily operation for the latest completed day. Require:

1. source content inventory > 0;
2. content insight entities > 0;
3. D1 and Lark content-daily observations > 0;
4. same-operation replay/idempotency creates no duplicate stable keys;
5. rematerialize only Facebook current 1D/3D/7D/30D report slots;
6. Report Snapshot `source_snapshot_count > 0` and `tracked_content_count > 0`;
7. Dashboard Facebook 7D reads observed metrics or explicit N/A, never fabricated zero.
