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
`v0.1.6-local-lark-run-tools`

This baseline makes the codebase client-neutral:

```text
client Cloudflare env
        ↓
resolve Lark Base table IDs
        ↓
load MKT_Classification_Dictionary from Lark
        ↓
normalize / classify / upsert report rows
```

No real Lark table IDs are hardcoded in source code. Each client deploys the same code to their own Cloudflare project and provides their own Lark Base table IDs through environment variables.

## Local validation
This skeleton has no external dependencies for included tests.

```bash
npm test
npm run check
```


## Local Lark live run tools

Create a local secret file from the example and fill real Lark values:

```bash
cp .dev.vars.example .dev.vars
```

Validate real Lark data without writing to report tables:

```bash
npm run validate:tiktok
```

Write TikTok Creator rows into `MKT_Content` and `MKT_Content_Daily` only after validation looks correct:

```bash
CONFIRM_WRITE=YES npm run sync:tiktok
```

Seed metric definitions into `MKT_Metric_Definitions`:

```bash
CONFIRM_WRITE=YES npm run seed:metrics
```

Optional runtime inputs:

```bash
METRIC_DATE=2026-07-10 SAMPLE_LIMIT=10 npm run validate:tiktok
METRIC_DATE=2026-07-10 CONFIRM_WRITE=YES npm run sync:tiktok
```

`.dev.vars` must never be committed. It contains client secrets and table IDs.

## Required Lark environment variables

Global Lark app/base secrets:

```text
LARK_APP_ID
LARK_APP_SECRET
LARK_APP_TOKEN
MKT_ENV
MKT_CUSTOMER_PROFILE
```

Required for TikTok Creator sync:

```text
LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS
LARK_TABLE_MKT_CONTENT
LARK_TABLE_MKT_CONTENT_DAILY
LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY
```

Required for metric seed:

```text
LARK_TABLE_MKT_METRIC_DEFINITIONS
```

Other table IDs are kept in `wrangler.example.jsonc` / `.dev.vars.example` for future flows, but they are not required by every job.

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

## Lark classification dictionary

`📚 MKT_Classification_Dictionary` is the source of truth for business-specific mapping such as course names, course levels, content themes, funnel stages, CTAs, promotions, and urgency.

The code reads these columns:

```text
rule_key
target_field
output_value
aliases
match_type
platform
applies_to
priority
confidence
enabled
note
```

If no enabled dictionary rule matches a content row, the mapper leaves business fields empty and writes:

```text
manual_tag_note = manual_review: no enabled dictionary rule matched
classification_confidence = 0.2
```

This prevents the system from guessing Chemistry K-specific values for other clients.

## Definition of Done
Code is not complete unless tests/regression pass and the Project Brain is updated.


## v0.1.5 Live sync validation

New queue job for non-mutating Lark validation before the first write:

```json
{
  "type": "tiktok.creator.native.validate",
  "metricDate": "2026-07-09",
  "sampleLimit": 5
}
```

This job reads the real `RAW_TikTok_Creator_Videos` and `MKT_Classification_Dictionary` tables, normalizes rows in memory, and logs a dry-run summary. It does not write to `MKT_Content` or `MKT_Content_Daily`. Use it before running the write job:

```json
{
  "type": "tiktok.creator.native.sync",
  "metricDate": "2026-07-09"
}
```

The actual sync use case also supports `dryRun: true` for tests or manual validation code paths.
## Core synchronization architecture

All connectors must normalize rows and pass them to `TableSyncEngine`. The engine reads each destination table once, indexes stable keys in memory, skips unchanged rows, and performs sequential batch create/update operations through a thin storage repository. Lark authentication, pagination, request pacing, and bounded retry live in `LarkBitableClient`.


### Lark write safety

The Lark repository discovers the live destination table schema before writing. Normalized rows are serialized and validated by field type, then passed to the universal sync engine. URL fields use Lark's `{ link, text }` payload format, and invalid mappings fail before batch writes with table/key/field context.

### Lark pagination safety

Lark collection reads use one guarded paginator. It follows `has_more`, rejects missing or repeated next tokens, and enforces a maximum page count. A terminal response may still contain a stale `page_token`; that token is intentionally ignored when `has_more` is false.

## Runtime Environment และ Customer Profile

เลือก Dev/Production ผ่าน Environment Variable โดยไม่แก้ source code:

```env
# Dev: ใช้ Lark Base และ TikTok @ft.pumkin ของผู้พัฒนา
MKT_ENV=development
MKT_CUSTOMER_PROFILE=dev_ft_pumkin
```

```env
# Production: ใช้ทรัพยากรในองค์กรของลูกค้า Chemistry K
MKT_ENV=production
MKT_CUSTOMER_PROFILE=chemistry_k
```

ข้อมูลลับยังคงตั้งผ่าน `.dev.vars`, Cloudflare secrets หรือ Secret Manager ของลูกค้า ห้าม commit ลง Git
