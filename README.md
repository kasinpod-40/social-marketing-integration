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
`v0.1.5-lark-live-sync-validation`

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

## Required Lark environment variables

Global Lark app/base secrets:

```text
LARK_APP_ID
LARK_APP_SECRET
LARK_APP_TOKEN
TIKTOK_CREATOR_ACCOUNT_ID
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
