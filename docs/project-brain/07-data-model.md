# Data Model

## Lark Base
Base name: `Social MKT Data Hub`

## Main reporting tables
- `MKT_Accounts`
- `MKT_Content`
- `MKT_Content_Daily`
- `MKT_Ads_Accounts`
- `MKT_Ads_Campaigns`
- `MKT_Ads_AdGroups`
- `MKT_Ads_Ads`
- `MKT_Ads_Creatives`
- `MKT_Ads_Daily`
- `MKT_Sync_Log`
- `MKT_System_Alerts`
- `MKT_AI_Report_Runs`
- `MKT_Report_Settings`

## Raw integration tables
- `RAW_TikTok_Creator_Videos` — official TikTok For Creator native sync table.
- `RAW_YouTube_Channels` — YouTube channel identity and cumulative public statistics; Blueprint only until Apply/UAT.
- `RAW_YouTube_Videos` — YouTube video metadata and cumulative public statistics; Blueprint only until Apply/UAT.
- `RAW_YouTube_Analytics_Daily` — OAuth owner-analytics period metrics; never overwrites cumulative snapshots.
- `RAW_TikTok_Business_Campaigns`
- `RAW_TikTok_Business_AdGroups`
- `RAW_TikTok_Business_Ads`
- `RAW_Google_Campaigns`
- `RAW_Google_Customer_Lists`

## TikTok Creator keys
- `content_key = platform:account_id:external_content_id`
- `content_daily_key = platform:account_id:external_content_id:metric_date`

## Canonical Organic keys

- `content_key = platform:account_id:external_content_id`
- `content_daily_key = platform:account_id:external_content_id:metric_date`
- TikTok and YouTube reuse this identity/row contract; each adapter retains its own source parsing and account-identity guard.

## Canonical Ads keys and metrics

- `entity_key = platform:account_id:entity_type:external_entity_id`
- `ads_daily_key = entity_key:metric_date`
- Delivery hierarchy: Account → Campaign → Ad group/Ad set → Ad → Daily metrics.
- Creative เป็น reusable asset ที่ Ad อ้างถึงและไม่ใช้แทน Ad ID.
- Raw money source of truth: `spend_micros`, `conversion_value_micros` เป็น non-negative safe integers; `spend`/`conversion_value` เป็น derived display fields.
- Other raw metrics: impressions, reach, clicks และ conversions.
- Derived metrics are calculated centrally; zero denominator or missing components return `null`.
- `target_roas` is never treated as `actual_roas`; `platform` and client-facing `ad_channel` are separate dimensions.

## TikTok Creator read/write flow
```text
RAW_TikTok_Creator_Videos
        ↓
normalizeTikTokCreatorVideoBatch
        ↓
MKT_Content upsert by content_key
MKT_Content_Daily upsert by content_daily_key
```

## Rules
- Raw tables are staging/landing sources only.
- Dashboards and AI summaries must use `MKT_*` tables.
- Daily reporting must use snapshot tables, not latest values only.
- Missing unsupported metrics are `null`.
- Target ROAS is not Actual ROAS.
- Unique viewers is not automatically Reach.


## Canva-style report additions

### Added main tables
- `MKT_Metric_Definitions` — metric semantics by platform. Primary key: `metric_key`.
- `MKT_Report_Snapshots` — computed weekly/monthly/YoY report payloads before AI summary. Primary key: `report_id`.

### Added `MKT_Content` classification fields
- `course_name`
- `course_level`
- `course_type`
- `content_theme`
- `funnel_stage`
- `cta_type`
- `cta_destination`
- `promotion_type`
- `urgency_level`
- `classification_source`
- `classification_confidence`
- `manual_tag_note`

### Ads reporting dimensions
Ads tables use `platform` for API/source family and `ad_channel` for the channel shown in client reports.

Examples:
- `platform = google_ads`, `ad_channel = youtube_ads`
- `platform = meta_ads`, `ad_channel = facebook_ads`
- `platform = meta_ads`, `ad_channel = instagram_ads`

### Metric-definition rule
Cross-platform dashboards must use `MKT_Metric_Definitions` before comparing metrics. For example, TikTok `unique_viewers` is not automatically the same as Facebook/Instagram `reach`.
