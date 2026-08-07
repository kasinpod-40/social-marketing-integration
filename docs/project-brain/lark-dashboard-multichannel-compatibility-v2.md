# Lark Dashboard Multichannel Compatibility v2

## Current verified decision

Reviewed Multichannel Report materialization is closed for Facebook, Instagram, YouTube, Meta Ads, Google Ads, WooCommerce and Chatwoot across 1D/3D/7D/30D. Dashboard compatibility remains a separate presentation-layer gate.

Latest exported Integration Workspace Base proves two independent gaps:

1. Organic Dashboard Statistics still depend on the preserved Display V2 SingleSelect, while the permanent compatibility writer was TikTok-only. The exact reviewed Organic target is now `4 platforms x 17 KPI x 4 windows = 272` rows, with 204 missing Display V2 cells.
2. Executive, Paid Ads, Commerce and Customer Service Dashboard blocks retain stale Metric filters such as `period_spend`, `period_clicks`, `order_count`, `first_response_time` and copied cross-domain filters. Some broad `contains` filters can also sum summary plus ranked dimension rows.

## Locked correction

- extend the existing Display V2 compatibility map/writer/backfill to Facebook, Instagram, TikTok and YouTube Organic;
- update only the preserved Display V2 Record cell on the 204 missing target rows;
- preserve all canonical Metric values, Report IDs and N/A/null semantics;
- use exact target-matrix validation and immutable fingerprints, never total table size as an admission contract;
- keep public Dashboard PATCH retired because Lark previously rejected the reviewed Block mutation path with unchanged readback;
- correct stale Dashboard filters manually in Lark UI from the exact checklist in `docs/tasks/lark-dashboard-multichannel-compatibility-v2.md`;
- require `dimension_type=summary` for summary KPI blocks to prevent dimension-rank double counting;
- do not invent `average_order_value`, `new_customer` or `new_leads` metrics because no canonical materialized metric currently exists for those labels.

## Executive Organic headline supersession

The later live UI check exposed one presentation-only contradiction in the original compatibility checklist. The Executive headline `Organic Views` Statistic was bound to strict `period_views`. When that reviewed period metric is legitimately `null` because baseline coverage is incomplete, Lark Statistics renders the empty result as visible `0`. That violates the existing Native Dashboard null/N/A invariant and hides the already-materialized current-total Organic value.

The locked correction is:

```text
Executive headline label: Organic Total Views
Matching: All
metric_key contains :latest_total_views
metric_scope is current_total
availability_status is available
dimension_type is summary
Value: current_value -> Sum
```

`Organic Views by Window` does **not** use this fallback. It remains strict period performance:

```text
Matching: All
metric_key contains period_views
metric_scope is period_delta
dimension_type is summary
X = window_days
Y = current_value -> Sum
```

An incomplete period baseline may therefore leave the by-window chart empty/N/A. Do not fabricate zero, synthesize history, mutate `current_value` or rerun reviewed Report windows to force a chart value.

The detailed authority is `docs/tasks/executive-organic-current-total-binding-v1.md`. This supersedes only the Executive headline Organic-view binding; all other Multichannel Dashboard Compatibility v2 corrections remain unchanged.

## Safety

Repository implementation performs no Remote action. Post-merge Record-only Apply remains separately authorized and must stop after the 204 Display V2 cells. No Report window rerun, D1 mutation, Queue send, Worker deployment, Provider request, Schedule activation or Production action is part of this workstream.
