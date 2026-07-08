# Social Marketing Data Integration

A Cloudflare + Lark Base data integration project for social organic and ads reporting.

## Stack
- JavaScript ES Modules
- Cloudflare Workers
- Cloudflare D1
- Cloudflare Queues
- Lark Base / Lark OpenAPI / Lark Native Integrations

## Architecture
Clean Architecture + Monorepo + Modular Monolith.

```text
apps -> application -> domain
connectors/infrastructure implement application ports
```

## Current baseline
`v0.1.3-canva-report-data-model-support`

This baseline upgrades the TikTok Creator read/write flow so it fits the client's Canva-style reports:

```text
RAW_TikTok_Creator_Videos
        ↓
normalize / validate / classify / dedupe
        ↓
MKT_Content
MKT_Content_Daily
```

It also adds metric-definition seed support and a report snapshot structure for weekly/monthly/YoY payloads before AI summary generation.

## Local validation
This skeleton has no external dependencies for included tests.

```bash
npm test
npm run check
```

## Required Lark environment variables

```text
LARK_APP_ID
LARK_APP_SECRET
LARK_APP_TOKEN
LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS
LARK_TABLE_MKT_CONTENT
LARK_TABLE_MKT_CONTENT_DAILY
LARK_TABLE_MKT_METRIC_DEFINITIONS
TIKTOK_CREATOR_ACCOUNT_ID
```

The latest Canva-ready table IDs are in:

```text
packages/config/src/lark-table-config.js
wrangler.example.jsonc
```

## Queue jobs

TikTok Creator sync:

```json
{
  "type": "tiktok.creator.native.sync",
  "accountId": "tiktok-account-id",
  "metricDate": "2026-07-07"
}
```

Metric definition seed:

```json
{
  "type": "metric.definitions.seed"
}
```

## Canva-style report support added in v0.1.3

`MKT_Content` now receives rule-based fields:

```text
course_name
course_level
course_type
content_theme
funnel_stage
cta_type
cta_destination
promotion_type
urgency_level
classification_source
classification_confidence
manual_tag_note
```

`MKT_Metric_Definitions` seed rows protect dashboard semantics such as Reach vs Unique Viewers and Target ROAS vs Actual ROAS.

`MKT_Report_Snapshots` rows store computed metric/top-content/top-ads payloads as JSON before AI summaries are generated.

## Definition of Done
Code is not complete unless tests/regression pass and the Project Brain is updated.
