# Lark Native AI Weekly Executive Quality

## Permanent authority

The primary executive Group-report experience is a **7-day marketing summary**. The AI layer must summarize validated business evidence, not translate system readiness fields into prose.

## Business-first rule

For every channel with validated Report evidence, AI should prioritize:

- current business metrics;
- previous-period comparison when proven;
- Top Content for organic channels;
- Top Ads for paid media;
- commerce rankings for Commerce;
- customer-service/agent/inbox evidence for Chatwoot when present.

Data quality and readiness remain supporting constraints only. They must not dominate the report when business evidence exists.

## Missing-data wording

Every expected business channel remains visible.

When no usable business evidence exists for the requested period, use natural Thai such as:

```text
ยังไม่พบข้อมูลสำหรับช่วงนี้
```

Do not expose internal control vocabulary in executive prose, including readiness/status field names or values.

Missing data is not negative performance and must never be converted to zero.

## Trend rule

Words that imply movement or trend — for example เพิ่มขึ้น, ลดลง, เติบโต, ดีขึ้น, แย่ลง — require proven comparison evidence for the same metric and compatible scope.

Without a baseline, AI may describe rank or current magnitude but not invent a trend.

## Channel analysis rule

A channel with data must receive an actual channel-level performance summary.

Example behavior:

```text
TikTok has validated Views/Likes/Engagement + Top Content
→ summarize those values and notable content
→ compare with previous 7D when available
```

It is insufficient to say only that TikTok data is available.

## Executive synthesis rule

Executive AI receives bounded evidence from all nine business channels:

```text
TikTok Organic
Facebook Organic
Instagram Organic
YouTube Organic
Meta Ads
Google Ads
TikTok Ads
WooCommerce
Chatwoot
```

`operations` is not a Marketing channel and must not be rendered as one.

Executive synthesis should:

1. summarize the strongest business signals;
2. compare channels only where evidence is comparable;
3. name important Content/Ad/product/service evidence when available;
4. keep missing channels visible with natural wording;
5. finish with evidence-backed next actions.

## 7D Group policy boundary

The 7D Executive AI Run is the intended primary input for the future weekly Lark Group Notification.

The 1D, 3D and 30D windows remain useful in Lark Dashboard/AI history but are not, by this rule alone, authorized for automatic Group delivery.

Notification Admission, schedule/trigger and Live AI generation remain separately controlled gates.

## Architecture

Reuse only:

```text
Central Report
→ MKT_Report_Snapshots
→ MKT_Report_Metric_Values
→ MKT_Report_Top_Content / MKT_Report_Top_Ads
→ MKT_AI_Report_Runs
→ Lark Native AI
→ Notification Runtime
```

Do not add an external AI provider, custom AI Worker, duplicate AI table, Raw-table read or another Report/Lark writer.
