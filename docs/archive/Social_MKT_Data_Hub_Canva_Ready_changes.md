# DEPRECATED — Historical Canva-ready schema notes

> เอกสารนี้อธิบาย Data Model รุ่นเก่าก่อน Canonical Ads v2 และ YouTube Blueprint v0.10.2 ห้ามใช้เป็น Current schema contract. ให้ใช้อ้างอิงประวัติเท่านั้น.

# Social MKT Data Hub Canva Ready Base

Generated from: `Social MKT Data Hub.base`
Output: `Social_MKT_Data_Hub_Canva_Ready.base`

## Applied fixes

- Removed duplicate fields `platform Copy` and `platform Copy 2` from `MKT_Accounts`.
- Renamed table `📐MKT_Metric_Definitions` to `📐 MKT_Metric_Definitions`.
- Removed unused `Parent items` from `MKT_Metric_Definitions`.
- Added Ads platform options to `MKT_Metric_Definitions.platform`: `meta_ads`, `tiktok_ads`, `google_ads`.
- Added `unit` options in `MKT_Metric_Definitions`: `count`, `percent`, `seconds`, `currency`, `ratio`, `text`.
- Filled options for course/content classification fields in `MKT_Content`.
- Added `ad_channel` to `MKT_Ads_Campaigns`, `MKT_Ads_AdGroups`, `MKT_Ads_Creatives`, and `MKT_Ads_Daily`.
- Filled options for course/theme/funnel fields in Ads tables.
- Removed unused `organic_post_id` from `MKT_Ads_Creatives`; kept `organic_content_id`.
- Added Organic platform options to `MKT_Report_Snapshots.platform`: `facebook`, `instagram`, `tiktok`, `youtube`.
- Filled `MKT_Report_Snapshots.report_type` and `comparison_mode` options.
- Reworked `MKT_AI_Report_Runs` for Canva-style AI summaries: report type, period range, compare range, platforms, course filter, metric JSON, insights, strengths, weaknesses, recommendations, sent status and sent time.

## Added / confirmed option sets

### Organic platforms
`facebook`, `instagram`, `tiktok`, `youtube`

### Ads platforms
`meta_ads`, `tiktok_ads`, `google_ads`

### Ads channels
`facebook_ads`, `instagram_ads`, `tiktok_ads`, `youtube_ads`, `google_search_ads`, `google_display_ads`

### Report types
`weekly_organic_report`, `monthly_organic_report`, `ads_performance_report`, `course_campaign_report`, `top_content_report`, `platform_strength_weakness_report`, `executive_summary_report`, `yoy_report`

### Comparison modes
`none`, `previous_period`, `year_over_year`, `custom_range`

## Verification

Decoded output base successfully. Table count: 20.


## v0.4.0 code foundation note

Release `v0.4.0-multi-channel-foundation` ไม่มีการเพิ่ม/ลบ/เปลี่ยน Field ใน Lark Base

- เพิ่มเฉพาะ Connector Catalog, Runtime feature flags, Queue job catalog/schema และ Customer profile ใน Source code
- Facebook, Instagram, YouTube, WooCommerce และ Chatwoot ยังเป็น `planned` และไม่เขียนข้อมูลลง Base
- ก่อน Implement Connector ใหม่ ต้องออกแบบ Table/Field/Key/Metric definition/Relation/Formula/Lookup และทำ Blueprint แยกก่อน


## v0.5.0 reliability layer note

Release `v0.5.0-reliability-layer` ไม่เพิ่ม/ลบ/เปลี่ยน Field ใน Lark Base และใช้ตารางเดิมดังนี้:

- `MKT_Sync_Log` — Upsert ด้วย `sync_id`; ใช้ `platform`, `sync_type`, `status`, `records_pulled`, `records_written`, `error_message`
- `MKT_System_Alerts` — Upsert ด้วย `alert_id`; ใช้ `severity`, `platform`, `alert_message`, `status`

รายละเอียด Operational ที่ Base ไม่มี Field เช่น created/updated/skipped แยกกัน, retry count, lock, DLQ payload และ reconciliation metadata จะเก็บใน Cloudflare D1 ผ่าน `migrations/0002_reliability.sql` จึงไม่ต้องแก้ Base ของผู้พัฒนาหรือ Blueprint ลูกค้ารอบนี้

## v0.7.1 Report Reliability Hardening

- Corrected report `failed` vs `partial_success` classification.
- Bound scheduled snapshot/report dates to the original scheduled event.
- Unified and bounded Top Content limit and neutralized stale ranks.
- Hardened distributed/local lease handling and Lark batch failure classification.
- Added DEV Workers Logs/Traces example configuration.
- Report schedule remains disabled pending Lark schema and Live DEV UAT.
