# Lark Dashboard Multichannel Compatibility v2

## Objective

ปิดช่องว่างระหว่าง Report materialization ที่ผ่าน Reviewed Multichannel Report Chain แล้ว กับ Dashboard UI ที่ยังอิง Legacy Display V2 และ Metric filter รุ่นเก่า

งานนี้ไม่สร้าง Report ใหม่ ไม่ rerun Report window และไม่แก้ Business facts ที่ปิดไปแล้ว

## Reviewed authority

Latest exported Integration Workspace Base reviewed on 2026-08-07 after the 7-channel Report closeout.

Report state:

```text
Reviewed non-planned channels              7
Reviewed 1D/3D/7D/30D Report chain         CLOSED
Report-window rerun required                0
Provider / Queue / Worker action            0
Production                                  BLOCKED
```

Dashboard Metric table observed state:

```text
Report Metric records                       1,254
metric_key populated                        1,254
canonical display_name populated            1,254
legacy Display V2 populated                    86
legacy Display V2 blank                     1,168
```

The total table size is evidence only. It is not an admission limit for this compatibility operation.

## Root cause A — Organic Display V2 compatibility remained TikTok-only

The permanent writer and Record-only backfill contract were originally scoped to TikTok Organic. The Organic Dashboard still has 17 Statistics blocks filtering the preserved field:

```text
__mkt_legacy_display_name_single_select_v2
```

The same 17 canonical Organic metrics now exist for:

```text
facebook
instagram
tiktok
youtube
```

Reviewed target matrix:

```text
4 platforms x 17 KPIs x 4 windows = 272 target rows
```

Current state:

```text
TikTok target rows              68 / 68 populated
Facebook target rows             0 / 68 populated
Instagram target rows            0 / 68 populated
YouTube target rows              0 / 68 populated
Target pending backfill              204
Target current_value=null rows       140
Preserved Window Select target      272 / 272 converged
```

The 140 null metric values are valid N/A facts and must remain unchanged.

### Correction

Extend the existing compatibility mapping and writer to the four reviewed Organic platforms while preserving the same 17 Dashboard labels.

The backfill may update only the preserved Display V2 Record cell. It must not mutate:

```text
metric_key
current_value
display_name
window_days
Report IDs
Dashboard Blocks
Fields/schema
records create/delete
D1
Queue
Worker
Schedule
Production
```

Target matrix completeness, exact target state and immutable before/after fingerprint are the safety contract. Unrelated table growth must not block execution.

## Root cause B — stale Dashboard Metric filters

The latest exported Base proves several Dashboard blocks still filter legacy/nonexistent metric names. Lark Dashboard Block PATCH is outside the proven public API boundary and remains frozen. These corrections must be applied in the Lark Dashboard UI, then verified from a fresh exported Base.

For every `MKT_Report_Metric_Values` block below, add or retain:

```text
dimension_type = summary
```

unless the block intentionally displays a ranked dimension collection.

## Executive Marketing Overview

| Block | Current filter | Required binding |
|---|---|---|
| Organic Views by Window | `metric_key contains period_spend` | `metric_key contains period_views` + summary |
| Orders | Woo + `order_count` | `metric_key = woocommerce:recognized_orders` + summary |
| Net Sales by Window | Woo + `net_sales` | `metric_key = woocommerce:net_sales_micros` + summary |
| Ad Spend by Window | `metric_key contains period_views` | `metric_key contains :spend_micros` + summary |
| Ad Spend | `metric_key contains period_spend` | `metric_key contains :spend_micros` + summary |
| Organic Views | `metric_key contains period_views` | keep `period_views` + summary |
| Net Sales | Woo + `net_sales` | `metric_key = woocommerce:net_sales_micros` + summary |
| New Leads | `metric_key = new_leads` | **No canonical Lead metric; keep unavailable until a Lead business contract exists** |

## Organic Performance

The 17 Statistics blocks intentionally remain on preserved Display V2 because Dashboard PATCH is not supported. After the 204-cell backfill they must render all four Organic platforms through the existing platform/window slicers.

Reviewed labels:

```text
Views
Likes
Comments
Shares
Engagement
Engagement rate
Latest total views
Latest total likes
Latest total comments
Latest total shares
Latest total engagement
Latest engagement rate
New content
Tracked content
Baseline coverage
Baseline Missing Content
Baseline Coverage Rate
```

## Paid Ads Performance

| Block | Current key | Required binding |
|---|---|---|
| Clicks | `period_clicks` | `metric_key contains :clicks` + summary |
| CPM | `period_cpm` | `metric_key contains :cpm_micros` + summary |
| Spend | `period_spend` | `metric_key contains :spend_micros` + summary |
| Impressions | `period_impressions` | `metric_key contains :impressions` + summary |
| CTR | `period_ctr` | `metric_key contains :ctr` + summary |
| CPC | `period_cpc` | `metric_key contains :cpc_micros` + summary |
| Spend by Platform | `period_spend` | `metric_key contains :spend_micros` + summary; group by platform |
| Clicks by Platform | `period_clicks` | `metric_key contains :clicks` + summary; group by platform |

Existing Daily trend blocks source `MKT_Ads_Daily` and are outside this Metric-key correction.

## Commerce & Conversion

| Block | Current key | Required binding |
|---|---|---|
| Orders | `order_count` | `metric_key = woocommerce:recognized_orders` + summary |
| Orders by Window | `order_count` | `metric_key = woocommerce:recognized_orders` + summary |
| Net Sales | contains `net_sales` | `metric_key = woocommerce:net_sales_micros` + summary |
| Refunds | `refund` | `metric_key = woocommerce:refund_micros` + summary |
| Gross Sales | contains `gross_sales` | `metric_key = woocommerce:gross_sales_micros` + summary |
| Gross Sales by Window | contains `gross_sales` | `metric_key = woocommerce:gross_sales_micros` + summary |
| Average Order Value | `average_order_value` | **No canonical materialized metric; do not substitute another metric** |
| New Customers | `new_customer` | **No canonical materialized metric; do not substitute another metric** |

`Refunds` uses a 2-decimal Dashboard format and is treated as refund amount, not refunded-order count.

## Customer Service & Leads

| Block | Current key | Required binding |
|---|---|---|
| Resolved Conversations | contains `resolved_conversations` | `metric_key = chatwoot:resolved_conversations` + summary |
| New Conversations by Window | copied Woo `gross_sales` filter | `metric_key = chatwoot:new_conversations` + summary |
| First Response Time | `first_response_time` | `metric_key = chatwoot:average_first_response_seconds` + summary |
| New Conversations | contains `new_conversations` | `metric_key = chatwoot:new_conversations` + summary |
| Resolved Conversations by Window | copied Woo `order_count` filter | `metric_key = chatwoot:resolved_conversations` + summary |
| Open Conversations | contains `open_conversations` | `metric_key = chatwoot:open_conversations_end` + summary |
| Resolution Time | `resolution_time` | `metric_key = chatwoot:average_resolution_seconds` + summary |
| New Leads | contains `new_leads` | **No canonical Lead metric; keep unavailable until a Lead business contract exists** |

The summary guard is mandatory for Chatwoot because ranked Agent/Inbox dimensional rows share some business metric suffixes and must not be added into summary KPI totals.

## Safety boundary

Repository implementation and CI:

```text
Remote Lark mutation          0
Dashboard mutation            0
Report materialization        0
Remote D1                     0
Queue                         0
Worker deployment             0
Provider                      0
Schedule                      disabled
Production                    BLOCKED
```

Post-merge live sequence:

1. run Record-only Display V2 preview from exact clean `main`;
2. require target rows `272`, pending `204`, conflicts `0`, target N/A `140`;
3. separately authorize one Record-only execution;
4. require confirmed updates `204`, pending `0`, converged `272`, unrelated fingerprint unchanged;
5. apply the exact UI filter corrections above manually in the six locked Dashboard pages;
6. export a fresh `.base`;
7. rerun the static Dashboard binding audit against the fresh export;
8. close Dashboard compatibility only when all intended widgets resolve exact current metrics without ranked-dimension double counting.

Do not rerun any reviewed Report materialization window during this sequence.
