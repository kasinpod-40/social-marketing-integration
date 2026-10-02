# TikTok Ads source/data-model contract — proposed 2026-10-02

Status: **PROPOSED — live report proof pending**. The user authorized proceeding with the safe base-metric scope; this document does not authorize connector writes or Report activation until the source contract is accepted after live proof.

## Scope and existing destinations

Use the existing Customer Production OAuth connection, encrypted access token, advertiser mapping, Cloudflare Worker/D1/Queue, and shared Paid Ads canonical model. No new Lark Base or table, TikTok Organic work, or other connector changes. D1 `ads_entity_state` is the master; `ads_daily_facts` is the durable daily history; `data_coverage_runs` and `sync_jobs` are the sync log. `ads_conversion_daily_facts` remains empty until an event-specific conversion contract is proven. Existing `MKT_Ads_Campaigns`, bounded `MKT_Ads_Daily`, and `MKT_Ads_Campaign_Summary` are Lark projections. Existing Report materializations/alerts are consumers, not source truth. No TikTok Ads raw Lark mirror.

## Proposed source read

Use official Marketing API v1.3 `GET /report/integrated/get/` with the validated advertiser ID and encrypted token inside the Worker. Candidate request: `report_type=BASIC`, `data_level=AUCTION_CAMPAIGN`, `dimensions=[campaign_id,stat_time_day]`, account-local `start_date=end_date`, bounded pagination. Confirm these exact enum/metric values with one guarded GET-only Production probe before any write; TikTok's SDK lists the endpoint and parameters but does not itself prove this advertiser's report access or metric availability. Never put the access token in the URL or logs. Read `campaign/get/` for campaign names/status/objective and reconcile IDs; the existing one-row probe proves read access, not full pagination.

The first source proof requests only `spend`, `impressions`, and `clicks`. Treat TikTok's `Conversions` as *the selected optimization event*, not necessarily purchases or orders. Leave `conversions`, `reach`, `conversion_value_micros`, `video_views`, and event-specific conversion facts `null` until each metric's source, business meaning, grain, and additivity are proven. Do not populate purchase revenue or ROAS from a generic conversion count. Derived CTR/CPC/CPM may use known base components; unknown denominators remain `null`.

## Canonical mapping

| Destination | Type / identity | Required mapping and semantics |
| --- | --- | --- |
| `ads_entity_state` | campaign master; `tiktok_ads:{account_key}:campaign:{campaign_id}` | `customer_key`, `account_key`, `source_account_id`, source campaign ID/name/status/objective, account currency/timezone, source availability and audit/coverage IDs. Never mark missing after a partial page. |
| `ads_daily_facts` | campaign-day; `tiktok_ads:{account_key}:campaign:{campaign_id}:{metric_date}:none:none` via shared key factory | `report_level=campaign`, `entity_type=campaign`, `breakdown_key=none`, `segment_key=none`, `ad_channel=tiktok_ads`, account-local date/currency/timezone. Spend is integer micros; impressions/clicks nonnegative integers; conversions nullable nonnegative number. Unknown metrics are SQL `NULL`, not zero. |
| `data_coverage_runs` | one dataset/account/date/run | `metric_semantics=period`; expected/observed campaign count, paging completion, status, failures and source watermark. A page failure cannot produce `complete` coverage. |
| `sync_jobs` / Queue | shared catalog job and stable account/date scope | Exact customer/advertiser lock, bounded pages/date windows, classified retry, idempotent replay and readback. Remain disabled until UAT. |
| Lark | existing Paid Ads tables | Campaign identity joins Daily by platform/account/campaign ID. Campaign Summary key is `<platform>:<account_id>:<campaign_id>:mtd:<YYYY-MM>`; D1 is history authority, Daily Lark is 90-day bounded cache. Existing TikTok View/permissions and field types require read-only schema check before writes. |

Example (illustrative only, **not** customer data): account key `demo_account`, advertiser `123`, campaign `456`, date `2026-10-01`, spend `12.34` account-currency units maps to `12_340_000` micros and key `tiktok_ads:demo_account:campaign:456:2026-10-01:none:none`; if revenue is unavailable, `conversion_value_micros=NULL`, so ROAS is `NULL`.

The currently planned TikTok Report adapter expects account-grain summary plus ad-grain Top Ads, whereas the approved Campaign Summary/D1 retention path expects campaign-grain facts. Do **not** flip that adapter active as-is: first make its summary selection campaign-grain and Top Ads unavailable/explicitly not observed, or obtain separately proven ad-grain source data. Do not sum campaign `reach` across campaigns because unique audiences overlap.

## Acceptance and gates before connector implementation

1. First delivery uses only proved spend, impressions, clicks and their derived rates. Conversion count, purchase value and ROAS stay blank until an event-specific source and business metric contract is approved.
2. Guarded, one-day GET-only report proof confirms advertiser permission, exact dimensions/metrics, pagination metadata, timezone/currency, and at least one source row or a trustworthy empty result. Return only sanitized booleans/counts and metric-availability flags.
3. Review this source contract and reflect approval in `docs/current-task.md` before connector coding, per `AGENTS.md` section 5.
4. After approval: focused parser/normalization, empty/partial/retry, stable-key/rerun, currency and null-semantic tests; full repo gates; reviewed deployment; one-day D1-only UAT and source↔D1/Coverage reconciliation before Lark, Report, and schedule activation.

Official sources: [TikTok Business API SDK ReportingApi](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/ReportingApi.md); [TikTok Ads Manager metric definitions](https://ads.tiktok.com/help/article/basic-data?lang=en).
