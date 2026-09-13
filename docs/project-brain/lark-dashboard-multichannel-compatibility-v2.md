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

## Safety

Repository implementation performs no Remote action. Post-merge Record-only Apply remains separately authorized and must stop after the 204 Display V2 cells. No Report window rerun, D1 mutation, Queue send, Worker deployment, Provider request, Schedule activation or Production action is part of this workstream.

## 2026-09-13 TikTok Period partial-coverage decision

TikTok cumulative content metrics may have near-complete baseline coverage when a newly discovered older video first
appears inside the selected period. The Dashboard must not turn the entire observed subtotal into a visible zero.

- Only TikTok may aggregate the period subtotal from rows with a proven baseline when the source read itself is
  complete and at least one content row is covered.
- The metric remains explicitly `coverage_incomplete`; coverage count/rate stay visible and no comparison or change is
  calculated from potentially different covered subsets.
- Facebook, Instagram and YouTube retain strict null semantics for the same baseline condition.
- Weekly AI may use a TikTok subtotal only when the existing high-coverage gate passes; it must keep comparison
  unavailable and must not describe the subtotal as complete.

Live Customer Production closure is complete on `main@c82522be7840b7bc00df289b98e8cbb962a378a2` and Worker
version `85f50869-3a7c-4d89-ab75-4e9994c7a8bd`. The Customer Lark Report metric schema now contains the additive
`coverage_incomplete` option. Serial 1D/3D/7D/30D materializations for period end `2026-09-12` passed D1/Lark
readback with 17 rows per report, six selected Period metrics per report and zero duplicate selected keys. The
1D/3D/7D coverage is `2075/2076`; 30D remains complete. Weekly Monday Report/Notification schedules remain enabled.
