# Lark Dashboard Multichannel Compatibility v2

## Objective

ปิดช่องว่างระหว่าง Report materialization ที่ผ่าน Reviewed Multichannel Report Chain แล้ว กับ Dashboard UI ที่ยังอิง Legacy Display V2, Metric filter รุ่นเก่า และค่าเงินแบบ micros ที่ไม่พร้อมแสดงลูกค้า

งานนี้ไม่แก้ canonical Business facts และไม่สร้างตัวเลขปลอมจากข้อมูลที่ไม่มีจริง

## Reviewed authority

Latest exported Integration Workspace Base reviewed on 2026-08-07 after the 7-channel Report closeout.

Report state:

```text
Reviewed non-planned channels              7
Reviewed 1D/3D/7D/30D Report chain         CLOSED
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

The total table size is evidence only. It is not an admission limit for compatibility or display-value backfill.

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

Reviewed pre-backfill state:

```text
TikTok target rows              68 / 68 populated
Facebook target rows             0 / 68 populated
Instagram target rows            0 / 68 populated
YouTube target rows              0 / 68 populated
Target pending backfill              204
Target current_value=null rows       140
Preserved Window Select target      272 / 272 converged
```

The 140 null metric values are valid N/A facts and must remain unchanged. Display V2 backfill may update only the preserved Display V2 field.

## Root cause B — stale Dashboard Metric filters

The exported Base proves several Dashboard blocks still filter legacy/nonexistent metric names. Lark Dashboard Block PATCH is outside the proven public API boundary and remains frozen. These corrections must be applied in the Lark Dashboard UI, then verified from a fresh exported Base.

Every summary KPI block sourced from `MKT_Report_Metric_Values` must retain:

```text
dimension_type = summary
```

unless the block intentionally displays a ranked dimension collection.

## Root cause C — canonical money is micros, but Dashboard requires display units

Paid Ads and Commerce canonical Report metrics intentionally keep integer micros in `current_value`:

```text
spend_micros
cpc_micros
cpm_micros
cpa_micros
conversion_value_micros
net_sales_micros
gross_sales_micros
refund_micros
...
```

Binding these values directly to Lark Statistics/Charts makes customer-facing money 1,000,000 times too large.

The permanent correction is additive:

```text
display_value
```

Rules:

```text
unit=currency AND metric_key ends _micros
  -> display_value = current_value / 1,000,000, rounded only to 4 display decimals
all other numeric metrics
  -> display_value = current_value rounded only to 4 display decimals
current_value=null
  -> display_value=null
```

`current_value` remains the canonical Business fact and is never rewritten by this compatibility layer. Future Lark Report writes emit `display_value`; existing Report Metric rows are repaired by one guarded Record-only backfill with immutable non-display fingerprint verification.

## Executive Marketing Overview — client handoff binding

| Block | Required binding | Value field | Client handoff rule |
|---|---|---|---|
| Organic Total Views | `metric_key contains :latest_total_views` + `metric_scope=current_total` + `availability_status=available` + summary | `current_value` | visible |
| Organic Views by Window | `metric_key contains period_views` + `metric_scope=period_delta` + summary | `current_value` | show only when Period rows are available; otherwise hide/label Baseline pending, never show fake 0 |
| Orders | `metric_key = woocommerce:recognized_orders` + summary | `current_value` | visible |
| Net Sales | `metric_key = woocommerce:net_sales_micros` + summary | `display_value` | visible; 2-decimal Dashboard format |
| Net Sales by Window | same Net Sales key + summary | `display_value` | visible; group by window |
| Ad Spend | `metric_key contains :spend_micros` + summary | `display_value` | visible; 2-decimal Dashboard format |
| Ad Spend by Window | same Spend key + summary | `display_value` | visible; group by window |
| New Leads | no canonical Lead metric | none | hide from client; never leave visible `0` |
| Open Alerts | direct System Alerts source | direct count only after client-safe current-alert scope is verified | otherwise remove from Executive and keep Operations-only |

The headline is intentionally `Organic Total Views`, not `Organic Views`. Current totals are observed facts and remain useful while strict rolling Period deltas can still be N/A because pre-period baselines are incomplete.

## Organic Performance

The 17 Statistics blocks intentionally remain on preserved Display V2 because Dashboard PATCH is not supported. After the 204-cell backfill they render all four Organic platforms through the existing platform/window slicers.

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

Period-delta blocks must preserve `availability_status=baseline_incomplete` and numeric null semantics. A client-facing block must not translate missing history to observed zero.

## Paid Ads Performance

| Block | Required binding | Value field |
|---|---|---|
| Clicks | `metric_key contains :clicks` + summary | `current_value` |
| CPM | `metric_key contains :cpm_micros` + summary | `display_value` |
| Spend | `metric_key contains :spend_micros` + summary | `display_value` |
| Impressions | `metric_key contains :impressions` + summary | `current_value` |
| CTR | `metric_key contains :ctr` + summary | `current_value` |
| CPC | `metric_key contains :cpc_micros` + summary | `display_value` |
| Spend by Platform | `metric_key contains :spend_micros` + summary; group by platform | `display_value` |
| Clicks by Platform | `metric_key contains :clicks` + summary; group by platform | `current_value` |

Existing Daily trend blocks source `MKT_Ads_Daily` and are outside this Metric-key/display-value correction.

## Commerce & Conversion

| Block | Required binding | Value field | Client handoff rule |
|---|---|---|---|
| Orders | `metric_key = woocommerce:recognized_orders` + summary | `current_value` | visible |
| Orders by Window | same Orders key + summary | `current_value` | visible |
| Net Sales | `metric_key = woocommerce:net_sales_micros` + summary | `display_value` | visible |
| Refunds | `metric_key = woocommerce:refund_micros` + summary | `display_value` | visible |
| Gross Sales | `metric_key = woocommerce:gross_sales_micros` + summary | `display_value` | visible |
| Gross Sales by Window | same Gross Sales key + summary | `display_value` | visible |
| Average Order Value | no canonical materialized metric in current Report contract | none | hide until a reviewed AOV business contract is added |
| New Customers | no canonical materialized metric in current Report contract | none | hide until customer-acquisition semantics are defined |

Missing metrics must not be replaced with nearby values only to fill a card.

## Customer Service & Leads

| Block | Required binding | Value field | Client handoff rule |
|---|---|---|---|
| Resolved Conversations | `metric_key = chatwoot:resolved_conversations` + summary | `current_value` | visible |
| New Conversations by Window | `metric_key = chatwoot:new_conversations` + summary | `current_value` | visible |
| First Response Time | `metric_key = chatwoot:average_first_response_seconds` + summary | `current_value` | visible |
| New Conversations | `metric_key = chatwoot:new_conversations` + summary | `current_value` | visible |
| Resolved Conversations by Window | `metric_key = chatwoot:resolved_conversations` + summary | `current_value` | visible |
| Open Conversations | `metric_key = chatwoot:open_conversations_end` + summary | `current_value` | visible |
| Resolution Time | `metric_key = chatwoot:average_resolution_seconds` + summary | `current_value` | visible |
| New Leads | no canonical Lead metric | none | hide; never expose fake zero |

The summary guard is mandatory for Chatwoot because ranked Agent/Inbox dimensional rows share some business metric suffixes and must not be added into summary KPI totals.

## Client handoff closure sequence

The Dashboard is not client-ready until this sequence is complete in order:

1. merge the exact verified repository change containing Report schema v6 and permanent `display_value` writer;
2. from clean exact merged `main`, run Report schema Preview and require additive `display_value` only for this scope;
3. apply schema through the existing guarded Report schema installer;
4. run `node scripts/report-metric-display-value-backfill.mjs` in Preview and inspect pending/display counts;
5. authorize exactly one Record-only `display_value` execution; require `pendingRecordUpdateCount=0`, unchanged non-display fingerprint, `current_value` mutation 0, Record create/delete 0;
6. apply the exact manual Dashboard bindings in this document: money uses `display_value`, counts/ratios use canonical `current_value`, Executive Organic headline uses `latest_total_views`;
7. hide client blocks that have no canonical business metric (`New Leads`, `Average Order Value`, `New Customers`) rather than showing zero/substitutes;
8. hide or explicitly label unavailable Period-delta charts until their real `availability_status` becomes `available`;
9. keep unverified all-history System Alert totals out of Executive; Operations page remains the internal alert surface;
10. export a fresh `.base` and rerun the static Dashboard binding audit;
11. close client handoff only when every visible block resolves a canonical/display-ready value with no unit inflation, stale key, ranked-dimension double counting, or unavailable-as-zero presentation.

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

Post-merge display-value Apply is additive/Record-only. It must not rerun reviewed Report windows or mutate canonical `current_value` facts.
