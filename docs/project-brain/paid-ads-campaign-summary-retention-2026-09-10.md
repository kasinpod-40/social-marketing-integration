# Paid Ads Campaign Summary and bounded Daily retention — 2026-09-10

## Contract

Customer PROD D1 is the complete historical authority. `MKT_Ads_Campaign_Summary` is a derived Lark projection
for current-month Campaign performance and `MKT_Ads_Daily` is a bounded Lark cache. This scope does not authorize
changes to Organic data, other Ads tables, D1 source facts, Queue/DLQ state, or the protected TikTok incident.

`MKT_Ads_Campaign_Summary` has exactly 21 fields. Its primary and idempotency key is
`campaign_summary_key = <platform>:<account_id>:<campaign_id>:mtd:<YYYY-MM>`. Supported platform values are
`meta_ads`, `google_ads`, and `tiktok_ads`. Its exact Views are:

- `📊 Overview` — platform is not empty;
- `🔵 Meta` — `platform=meta_ads`;
- `🔴 Google` — `platform=google_ads`;
- `⚫ TikTok` — `platform=tiktok_ads`.

Provisioning is idempotent and scoped to this one new table. Existing unrelated fields and tables are never
deleted or renamed. A live schema or View mismatch is a conflict, not an invitation to rewrite customer schema.

## Materialization and reconciliation

The operator aggregates current-month campaign facts from `ads_daily_facts` in Customer PROD D1. Meta uses the
canonical ad-grain facts and Google/TikTok use canonical campaign-grain facts, preventing mixed-grain double
counting. Lark writes use stable-key planning and explicit nullable-field clearing. After execution, the same D1
projection is planned again against live Lark; completion requires zero creates, zero updates, all rows skipped,
and zero duplicate input keys. Running the materializer again must also make zero changes.

## Retention safety

The policy targets 90 days of Lark history, starts pressure trimming at 17,000 records, aims for 15,000, and can
delete at most 500 rows per invocation, oldest first. Every candidate must contain a parseable `ads_daily_key`
whose platform/account/entity/date components agree with the visible Lark fields and an exact
`ads_daily_facts` identity for the same Customer. Unproven or malformed records are preserved. Any active sync
lock blocks retention. D1 is never mutated, and post-delete readback must prove the deleted stable keys are absent.

## Controlled Production execution

The one-command operator first checks exact Customer account, Worker, D1 database ID, profile, Base token and
Paid Daily table ID. It requires clean reviewed `main`, uploads an isolated Preview-only Worker version with no
routes, schedules, assets or Queues, confirms Production traffic remains on the original version, and restores
Preview URLs disabled in `finally`. Execution order is schema, Views, MTD materialization, retention, readback,
and idempotency rerun. Runtime flags remain default-off until live reconciliation succeeds and the reviewed
Production deployment explicitly enables them.
