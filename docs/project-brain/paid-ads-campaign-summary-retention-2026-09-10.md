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

The first post-merge Preview attempt failed before Lark access because the generated-config Wrangler subprocess
fell back to the default OAuth identity, which could read deployment state but received Cloudflare `403/10000`
when uploading a Worker version. Preview URLs were restored disabled and Production traffic stayed unchanged. All
Wrangler auth, version-upload, and deployment-status commands in this operator must explicitly use the reviewed
`chemistry-k-prod` profile.

PR `#812` merged the exact profile repair at `main@3977e14d`; both Branch Verification runs `34437649026` and
`34437667371` passed. The subsequent isolated upload created Preview version
`84235de8-f73d-41a9-9bdf-f563cb477f2c`, but the newly generated alias initially returned HTTP `404` while it was
propagating. No operator request reached the handler, Preview URLs were restored disabled, and Production traffic
remained unchanged. Before any business POST, the operator must therefore poll only the exact route with GET and
accept only the dedicated `405/METHOD_NOT_ALLOWED` response. The business POST is sent exactly once, including in
execute mode, so an uncertain mutation response cannot trigger a second retention batch.

The first exact execute created live table `tbl7YIG4sbcUbJOV`; the following read-only plan found all 21 fields and
four Views with zero drift. Execution then stopped before retention mutation on Lark code `1254018 InvalidFilter`.
The official record-filter contract requires a DateTime target as `["ExactDate","<epoch-ms>"]` for `isLess`;
the original request sent only the epoch. The repaired candidate query uses the official shape while preserving
the exact D1 identity proof, oldest-first order, active-lock gate, and maximum 500 deletes.

## Live closeout

PR `#815` merged the filter repair as code-release `main@9d97ad0d` after Branch Verification runs
`34461982572` / job `102821699707` and `34462011703` / job `102821790412` passed. Isolated Preview version
`13141e4c-4b32-4e88-bc83-e292cb876c74` then completed the exact operator and restored Preview URLs disabled;
Production traffic did not move during the controlled operator.

The final live result proves:

- `MKT_Ads_Campaign_Summary=tbl7YIG4sbcUbJOV` and `MKT_Ads_Daily=tblTjWaxgSCwSj1P`;
- 21 exact Summary fields and four exact Views with zero remaining actions, conflicts, warnings, manual actions,
  protected-field actions, deletes, or schema record writes;
- MTD `2026-09-01..2026-09-10` has 45 campaigns: 37 `meta_ads`, 8 `google_ads`, and zero legitimate
  `tiktok_ads` rows because PROD D1 has no TikTok Ads facts for the period;
- all 45 Summary identities and values reconcile to D1 with zero duplicate stable keys. The final execution and
  the immediate idempotency rerun both returned `created=0`, `updated=0`, `skipped=45`;
- Daily retention returned `recordsBefore=5,209`, `recordsAfter=5,209`, cutoff `2026-06-13`, pressure false,
  candidates/verified/deleted all zero, and D1 mutations zero. The live Lark table is already below the soft limit;
- the independent post-deploy D1 proof returned 2,483 Meta facts / 37 campaigns and 33 Google facts / 8 campaigns,
  while the full source remains 19,509 facts over `2026-06-19..2026-09-09`. All checks were read-only with
  `changed_db=false`, `rows_written=0`, and zero active locks.

Customer Worker version `2f3322d2-fb44-411d-8bc1-6857f7d4e40b` is active at 100% from code-release
`main@9d97ad0d` with Summary and retention enabled, live table mapping installed, and limits fixed at
`90 / 17,000 / 15,000 / 500`. Main Queue batch/concurrency remains `1/1`; generic DLQ redrive and automatic
recovery remain disabled. The runtime hook remains Paid-only and runs after a completed supported Paid Ads sync;
it does not mutate Organic data, unrelated Ads tables, or D1 source facts.
