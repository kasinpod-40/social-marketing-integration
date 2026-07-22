# Lark Full View Audit v0.13.5

## Status

- **Mode:** `AUDIT_ONLY_NO_APPLY`
- **Repository HEAD:** `573926448717ba9fd9b9ae3013a339c845b13bb9` (`main`)
- **Target:** developer-owned DEV / `dev_ft_pumkin`
- **Lark mutation:** none
- **Business Record read/write:** none
- **Source export:** `Social MKT Data Hub.base`
- **Prompt:** `Codex_Full_Lark_View_Audit_Prompt_v0.13.5.md`
- **Generated:** 2026-07-22 Asia/Bangkok

ไฟล์นี้เป็นผลลัพธ์รอบแรกตาม Prompt. ก่อนเริ่มงานไม่พบไฟล์ `Lark_Full_View_Audit_v0.13.5.md` เดิมใน Desktop, working tree หรือ Git history จึงไม่มี prior audit document ให้เทียบ; ใช้ Repository contracts, approved workbook metadata, `.base` export และ Live Lark read-only list/get เป็นหลักฐานแทน.

## Executive result

| Gate | Result |
|---|---:|
| Physical tables | 42 |
| Views | 133 |
| Views with Filter | 25 |
| Views without Filter | 108 |
| Contract-matched and correct | 25 |
| Known contract requiring Filter change | 17 |
| All/default Filter correct; Sort/Hidden contract partial | 36 |
| Specialized Views with no repository contract | 55 |
| Live ↔ export matched Views | 133/133 |
| Live ↔ export Filter differences | 0 |
| Live ↔ export Hidden-field differences | 0 |

ผลที่ต้องใช้ตัดสินใจ: 25 Views ตรง executable contract, 17 Google Ads Views มี contract ชัดแต่ยังไม่มี Filter, 36 All/default Views ไม่ต้องเพิ่ม Filter ตาม scope ของ Promptแต่ยังไม่มี per-View Sort/Hidden contract ครบ, และ Specialized อีก 55 Views ต้องเป็น `CONTRACT_MISSING` ห้ามเดาจากชื่อ.

## Evidence and method

1. อ่าน `.base` ด้วย schema-only parser `packages/shared/src/lark/lark-base-export.js`; ใช้เฉพาะ Table/Field/View metadata, Filter, Sort และ hidden-column metadata ไม่อ่าน Cell values.
2. อ่าน Live Lark DEV ด้วย `listTables`, `listFields`, `listViews` และ `getView` เท่านั้น. ไม่เรียก create/update/delete หรือ Record endpoint.
3. Live และ export ตรงกัน: 42 tables, 133 Views, 25 filtered Views, 7 Views ที่มี hidden fields; ชื่อ View, Filter และ Hidden fields ตรงกันครบ 133/133.
4. Sort/Automatic-sort ตรวจจาก `.base` export เพราะ Live View normalizer ที่ใช้อยู่คืน Filter/Hidden แต่ไม่คืน Sort. พบ Sort เฉพาะ Report Views 6 รายการและตรง current source contract.
5. Contract sources: Shared-table 17 Views, current Report 6 Views และ Google Ads 19 Views. Google contract ยังอยู่ที่ `origin/work/google-ads-schema-apply` และถูกอ้างโดย current-task closeout; ระบุ provenance นี้ทุกแถว.
6. Workbook `Social_MKT_Data_Hub_TikTok_Report_Blueprint_v0.7.0.xlsx` มี historical Client View plan ที่ชื่อไม่ตรงกับ View ปัจจุบันหลายรายการ; ไม่ map ข้ามชื่อและไม่ใช้เดา Filter. Workbook multi-channel v0.10.2 ไม่มี per-View Lark contract เพิ่มเติม.

## Classification

### 1. Correct — contract match (25)

- Shared-table Views 17/17: Filter conjunction/conditions ตรง `view-plan.csv`; Hidden fields ว่างตาม contract.
- Report Views 6/6: Filter, `rank asc` Automatic sort และ hidden fields ตรง `lark-report-views.js`.
- Google Views 2/19: `Google Ads Accounts` และ `YouTube Ads Campaigns` ตรง Google contract.

### 2. Needs change — known Google contract (17)

- Google explicit Views 4: `Google Ads Daily 30D`, `YouTube Video Assets`, `Performance Max Asset Groups`, `Conversion Actions UAT`.
- Google RAW error Views 13: ต้องกรอง Primary stable-key field ด้วย `isEmpty` ตาม executable contract.
- `Google Ads Daily 30D` ยังต้องกำหนด rolling Last-30-days ใน Lark UI; Repository ระบุ requirement แต่ไม่มี durable OpenAPI/serialized UI contract จึงต้องยืนยัน UI condition ก่อน Apply.

### 3. Default/all Filter OK, contract partial (36)

Views กลุ่ม `All ...` ที่ไม่มี Filter สอดคล้องกับการเป็น All/default View ตาม Prompt จึงไม่เสนอ Filter เพิ่ม แต่ Repository ไม่มี Sort/Hidden contract ต่อ View ครบทุกแถว. ห้ามถือว่า presentation contract ผ่านครบจนกว่าจะอนุมัติ Sort/Hidden policy.

### 4. CONTRACT_MISSING (55)

Specialized Views เหล่านี้ไม่มี exact per-View contract ที่จับคู่ด้วย Table+View name ใน current Source, approved CSV หรือ workbook. ชื่อ View บอก intent ได้คร่าว ๆ แต่ Prompt ห้ามใช้ชื่อเป็นหลักฐาน Filter จึงไม่เสนอเงื่อนไข.

## Full per-View contract matrix

| # | Table | View | Intended purpose | Expected Filter | Actual Filter | Sort (contract / actual) | Hidden fields (contract / actual) | Evidence | Status |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | MKT_Account_Daily | 📋 All Account Daily | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 2 | MKT_Accounts | 📋 All Accounts | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 3 | MKT_Accounts | ✅ Connected Accounts | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 4 | MKT_Accounts | ⚠️ Connection Issues | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 5 | MKT_Ads_Accounts | ⚠️ Ads Connection Issues | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 6 | MKT_Ads_Accounts | 📋 All Ads Accounts | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 7 | MKT_Ads_Accounts | ✅ Connected Ads Accounts | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 8 | MKT_Ads_Accounts | 🏦 Google Ads Accounts | Google Ads account inspection | AND: platform is [google_ads] | AND: platform is [google_ads] | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | CORRECT_CONTRACT_MATCH |
| 9 | MKT_Ads_AdGroups | ✅ Active Ad Groups | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 10 | MKT_Ads_AdGroups | 📋 All Ad Groups | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 11 | MKT_Ads_AdGroups | 🔎 Google Ad Groups | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 12 | MKT_Ads_AdGroups | 🔵 Meta Ad Groups | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 13 | MKT_Ads_AdGroups | 🎵 TikTok Ad Groups | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 14 | MKT_Ads_Ads | 📋 All Ads | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 15 | MKT_Ads_AssetGroups | 📋 All Asset Groups | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 16 | MKT_Ads_AssetGroups | 🗂️ Performance Max Asset Groups | Performance Max Asset Group inspection | AND: platform is [google_ads] | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 17 | MKT_Ads_Campaigns | ✅ Active Campaigns | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 18 | MKT_Ads_Campaigns | 📋 All Campaigns | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 19 | MKT_Ads_Campaigns | 🔎 Google Ads Campaigns | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 20 | MKT_Ads_Campaigns | 🔵 Meta Ads Campaigns | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 21 | MKT_Ads_Campaigns | 🎵 TikTok Ads Campaigns | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 22 | MKT_Ads_Campaigns | 📺 YouTube Ads Campaigns | Google VIDEO / YouTube Ads campaign inspection | AND: platform is [google_ads]; ad_channel is [youtube_ads] | AND: platform is [google_ads]; ad_channel is [youtube_ads] | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | CORRECT_CONTRACT_MATCH |
| 23 | MKT_Ads_Creatives | 📋 All Creatives | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 24 | MKT_Ads_Creatives | 🔎 Google Creatives | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 25 | MKT_Ads_Creatives | 🔵 Meta Creatives | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 26 | MKT_Ads_Creatives | 🔗 Organic Linked Ads | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 27 | MKT_Ads_Creatives | 🎵 TikTok Creatives | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 28 | MKT_Ads_Creatives | 🎬 YouTube Video Assets | Google Ads video creative/asset inspection | AND: platform is [google_ads]; creative_type is [video] | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 29 | MKT_Ads_Daily | 📋 All Ads Daily | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 30 | MKT_Ads_Daily | 🔎 Google Ads Daily | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 31 | MKT_Ads_Daily | 📈 Google Ads Daily 30D | Google Ads daily performance for rolling 30 days; relative-date UI encoding requires approval | AND: platform is [google_ads] | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 32 | MKT_Ads_Daily | 🔥 High Spend Low ROAS | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 33 | MKT_Ads_Daily | 🔵 Meta Ads Daily | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 34 | MKT_Ads_Daily | 🎵 TikTok Ads Daily | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 35 | MKT_AI_Report_Runs | 📅 Daily Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 36 | MKT_AI_Report_Runs | 🕘 Latest Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 37 | MKT_AI_Report_Runs | 📆 Monthly Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 38 | MKT_AI_Report_Runs | 🗓️ Weekly Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 39 | MKT_AI_Report_Runs | 🧾 Yearly Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 40 | MKT_Classification_Dictionary | 📋 All Classification | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 41 | MKT_Content | 📋 All Content | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 42 | MKT_Content | 🔵 Facebook Content | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 43 | MKT_Content | 🟣 Instagram Content | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 44 | MKT_Content | 🎵 TikTok Content | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 45 | MKT_Content | ▶️ YouTube Content | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 46 | MKT_Content_Daily | 📋 All Content Daily | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 47 | MKT_Content_Daily | 🔵 Latest Facebook Metrics | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 48 | MKT_Content_Daily | 🟣 Latest Instagram Metrics | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 49 | MKT_Content_Daily | 🎵 Latest TikTok Metrics | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 50 | MKT_Content_Daily | ▶️ Latest YouTube Metrics | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 51 | MKT_Metric_Definitions | 💰 Ads Metrics | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 52 | MKT_Metric_Definitions | 📋 All Metrics | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 53 | MKT_Metric_Definitions | ✅ Comparable Metrics | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 54 | MKT_Metric_Definitions | 🔵 Facebook Metrics | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 55 | MKT_Metric_Definitions | 🟣 Instagram Metrics | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 56 | MKT_Metric_Definitions | ⚠️ Needs Mapping | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 57 | MKT_Metric_Definitions | 🎵 TikTok Metrics | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 58 | MKT_Metric_Definitions | ▶️ YouTube Metrics | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 59 | MKT_Report_Metric_Values | 📊 Client Metrics | Client-visible report metrics across supported periods | AND: client_visible is [true] | AND: client_visible is [true] | rank asc (automatic) / rank asc (automatic) | report_id, report_setting_key, customer_profile, account_id, metric_key, dimension_type, dimension_value, formula_version, source_snapshot_count, client_visible / account_id, client_visible, customer_profile, dimension_type, dimension_value, formula_version, metric_key, report_id, report_setting_key, source_snapshot_count | `packages/config/src/lark-report-views.js` | CORRECT_CONTRACT_MATCH |
| 60 | MKT_Report_Metric_Values | 📊 Daily Metrics | Client-visible daily organic report metrics | AND: report_type is [daily_organic_report]; client_visible is [true] | AND: report_type is [daily_organic_report]; client_visible is [true] | rank asc (automatic) / rank asc (automatic) | report_id, report_setting_key, customer_profile, account_id, metric_key, dimension_type, dimension_value, formula_version, source_snapshot_count, client_visible / account_id, client_visible, customer_profile, dimension_type, dimension_value, formula_version, metric_key, report_id, report_setting_key, source_snapshot_count | `packages/config/src/lark-report-views.js` | CORRECT_CONTRACT_MATCH |
| 61 | MKT_Report_Metric_Values | 📈 Weekly Metrics | Client-visible weekly organic report metrics | AND: report_type is [weekly_organic_report]; client_visible is [true] | AND: report_type is [weekly_organic_report]; client_visible is [true] | rank asc (automatic) / rank asc (automatic) | report_id, report_setting_key, customer_profile, account_id, metric_key, dimension_type, dimension_value, formula_version, source_snapshot_count, client_visible / account_id, client_visible, customer_profile, dimension_type, dimension_value, formula_version, metric_key, report_id, report_setting_key, source_snapshot_count | `packages/config/src/lark-report-views.js` | CORRECT_CONTRACT_MATCH |
| 62 | MKT_Report_Settings | ⛔ Disabled Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 63 | MKT_Report_Settings | ✅ Enabled Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 64 | MKT_Report_Snapshots | 💰 Ads Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 65 | MKT_Report_Snapshots | 📋 All Report Snapshots | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 66 | MKT_Report_Snapshots | 🕘 Latest Snapshots | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 67 | MKT_Report_Snapshots | 🗓️ Monthly Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 68 | MKT_Report_Snapshots | 🎬 Organic Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 69 | MKT_Report_Snapshots | 📅 Weekly Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 70 | MKT_Report_Snapshots | 📆 Yearly / YoY Reports | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 71 | MKT_Report_Top_Content | 🏆 Daily Top Content | Client-visible daily ranked content | AND: report_type is [daily_organic_report]; data_status isNot [no_data] | AND: report_type is [daily_organic_report]; data_status isNot [no_data] | rank asc (automatic) / rank asc (automatic) | report_id, report_setting_key, customer_profile, account_id, content_key / account_id, content_key, customer_profile, report_id, report_setting_key | `packages/config/src/lark-report-views.js` | CORRECT_CONTRACT_MATCH |
| 72 | MKT_Report_Top_Content | 🏆 Top Content | Client-visible ranked content across supported periods | AND: data_status isNot [no_data] | AND: data_status isNot [no_data] | rank asc (automatic) / rank asc (automatic) | report_id, report_setting_key, customer_profile, account_id, content_key / account_id, content_key, customer_profile, report_id, report_setting_key | `packages/config/src/lark-report-views.js` | CORRECT_CONTRACT_MATCH |
| 73 | MKT_Report_Top_Content | 🏅 Weekly Top Content | Client-visible weekly ranked content | AND: report_type is [weekly_organic_report]; data_status isNot [no_data] | AND: report_type is [weekly_organic_report]; data_status isNot [no_data] | rank asc (automatic) / rank asc (automatic) | report_id, report_setting_key, customer_profile, account_id, content_key / account_id, content_key, customer_profile, report_id, report_setting_key | `packages/config/src/lark-report-views.js` | CORRECT_CONTRACT_MATCH |
| 74 | MKT_Sync_Log | ❌ Failed Sync | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 75 | MKT_Sync_Log | 🕘 Latest Sync | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 76 | MKT_Sync_Log | ⚠️ Partial Success | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 77 | MKT_Sync_Log | ⏳ Running Jobs | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 78 | MKT_System_Alerts | 🔴 Critical Alerts | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 79 | MKT_System_Alerts | 🚨 Open Alerts | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 80 | MKT_System_Alerts | ✅ Resolved Alerts | CONTRACT_MISSING | CONTRACT_MISSING | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING | CONTRACT_MISSING |
| 81 | RAW_Ads_Daily | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 82 | RAW_Ads_Daily | 🔎 Google Ads Daily | Google performance | AND: platform is [google_ads] | AND: platform is [google_ads] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 83 | RAW_Ads_Daily | 🔵 Meta Ads Daily | Meta performance | AND: platform is [meta_ads] | AND: platform is [meta_ads] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 84 | RAW_Ads_Daily | 🎵 TikTok Ads Daily | TikTok performance | AND: platform is [tiktok_ads] | AND: platform is [tiktok_ads] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 85 | RAW_Ads_Entities | 📋 All Ad Groups | Cross-platform ad-group inventory | AND: entity_type is [ad_group] | AND: entity_type is [ad_group] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 86 | RAW_Ads_Entities | 📋 All Ads | Cross-platform ad inventory | AND: entity_type is [ad] | AND: entity_type is [ad] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 87 | RAW_Ads_Entities | 📋 All Creatives | Cross-platform creative inventory | AND: entity_type is [creative] | AND: entity_type is [creative] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 88 | RAW_Ads_Entities | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 89 | RAW_Ads_Entities | 🔎 Google Campaigns | Google campaign inventory | AND: platform is [google_ads]; entity_type is [campaign] | AND: platform is [google_ads]; entity_type is [campaign] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 90 | RAW_Ads_Entities | 🔵 Meta Campaigns | Meta campaign inventory | AND: platform is [meta_ads]; entity_type is [campaign] | AND: platform is [meta_ads]; entity_type is [campaign] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 91 | RAW_Ads_Entities | 🎵 TikTok Campaigns | TikTok campaign inventory | AND: platform is [tiktok_ads]; entity_type is [campaign] | AND: platform is [tiktok_ads]; entity_type is [campaign] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 92 | RAW_Google_Ads_Account_Links | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 93 | RAW_Google_Ads_Account_Links | 🚨 Google Ads RAW Errors - Account_Links | Technical audit for missing Primary stable identity; no secrets | AND: raw_account_link_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 94 | RAW_Google_Ads_Accounts | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 95 | RAW_Google_Ads_Accounts | 🚨 Google Ads RAW Errors - Accounts | Technical audit for missing Primary stable identity; no secrets | AND: raw_account_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 96 | RAW_Google_Ads_Ad_Assets | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 97 | RAW_Google_Ads_Ad_Assets | 🚨 Google Ads RAW Errors - Ad_Assets | Technical audit for missing Primary stable identity; no secrets | AND: raw_ad_asset_link_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 98 | RAW_Google_Ads_Ad_Groups | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 99 | RAW_Google_Ads_Ad_Groups | 🚨 Google Ads RAW Errors - Ad_Groups | Technical audit for missing Primary stable identity; no secrets | AND: raw_ad_group_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 100 | RAW_Google_Ads_Ads | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 101 | RAW_Google_Ads_Ads | 🚨 Google Ads RAW Errors - Ads | Technical audit for missing Primary stable identity; no secrets | AND: raw_ad_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 102 | RAW_Google_Ads_Asset_Group_Assets | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 103 | RAW_Google_Ads_Asset_Group_Assets | 🚨 Google Ads RAW Errors - Asset_Group_Assets | Technical audit for missing Primary stable identity; no secrets | AND: raw_asset_group_asset_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 104 | RAW_Google_Ads_Asset_Groups | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 105 | RAW_Google_Ads_Asset_Groups | 🚨 Google Ads RAW Errors - Asset_Groups | Technical audit for missing Primary stable identity; no secrets | AND: raw_asset_group_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 106 | RAW_Google_Ads_Assets | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 107 | RAW_Google_Ads_Assets | 🚨 Google Ads RAW Errors - Assets | Technical audit for missing Primary stable identity; no secrets | AND: raw_asset_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 108 | RAW_Google_Ads_Campaign_Budgets | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 109 | RAW_Google_Ads_Campaign_Budgets | 🚨 Google Ads RAW Errors - Campaign_Budgets | Technical audit for missing Primary stable identity; no secrets | AND: raw_campaign_budget_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 110 | RAW_Google_Ads_Campaigns | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 111 | RAW_Google_Ads_Campaigns | 🚨 Google Ads RAW Errors - Campaigns | Technical audit for missing Primary stable identity; no secrets | AND: raw_campaign_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 112 | RAW_Google_Ads_Conversion_Actions | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 113 | RAW_Google_Ads_Conversion_Actions | 🎯 Conversion Actions UAT | Owner-only conversion-action approval/UAT inspection | OR: status is [ENABLED]; status is [UNKNOWN] | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 114 | RAW_Google_Ads_Conversion_Actions | 🚨 Google Ads RAW Errors - Conversion_Actions | Technical audit for missing Primary stable identity; no secrets | AND: raw_conversion_action_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 115 | RAW_Google_Ads_Conversion_Daily | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 116 | RAW_Google_Ads_Conversion_Daily | 🚨 Google Ads RAW Errors - Conversion_Daily | Technical audit for missing Primary stable identity; no secrets | AND: raw_conversion_daily_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 117 | RAW_Google_Ads_Daily | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 118 | RAW_Google_Ads_Daily | 🚨 Google Ads RAW Errors - Daily | Technical audit for missing Primary stable identity; no secrets | AND: raw_ads_daily_key isEmpty | NONE | UNSPECIFIED / NONE | NONE / NONE | `origin/work/google-ads-schema-apply:packages/config/src/google-ads-lark-schema.js` (head `798e4c0`) | NEEDS_CHANGE |
| 119 | RAW_Meta_Organic_Accounts | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 120 | RAW_Meta_Organic_Accounts | 🔵 Facebook Pages | Facebook account/page inspection | AND: platform is [facebook] | AND: platform is [facebook] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 121 | RAW_Meta_Organic_Accounts | 🟣 Instagram Accounts | Instagram account inspection | AND: platform is [instagram] | AND: platform is [instagram] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 122 | RAW_Meta_Organic_Content | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 123 | RAW_Meta_Organic_Content | 🔵 Facebook Content | Facebook posts/reels/videos | AND: platform is [facebook] | AND: platform is [facebook] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 124 | RAW_Meta_Organic_Content | 🟣 Instagram Content | Instagram media | AND: platform is [instagram] | AND: platform is [instagram] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 125 | RAW_Meta_Organic_Metrics | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 126 | RAW_Meta_Organic_Metrics | 🔵 Facebook Account Metrics | Facebook Page Insights | AND: platform is [facebook]; entity_type is [account] | AND: platform is [facebook]; entity_type is [account] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 127 | RAW_Meta_Organic_Metrics | 🔵 Facebook Content Metrics | Facebook Post Insights | AND: platform is [facebook]; entity_type is [content] | AND: platform is [facebook]; entity_type is [content] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 128 | RAW_Meta_Organic_Metrics | 🟣 Instagram Account Metrics | Instagram Account Insights | AND: platform is [instagram]; entity_type is [account] | AND: platform is [instagram]; entity_type is [account] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 129 | RAW_Meta_Organic_Metrics | 🟣 Instagram Content Metrics | Instagram Media Insights | AND: platform is [instagram]; entity_type is [content] | AND: platform is [instagram]; entity_type is [content] | UNSPECIFIED / NONE | NONE / NONE | `docs/shared-table-blueprint-v0.12.1/view-plan.csv` | CORRECT_CONTRACT_MATCH |
| 130 | RAW_TikTok_Creator_Videos | 📋 All Records | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / SourceID | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 131 | RAW_YouTube_Analytics_Daily | 📋 All Analytics | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 132 | RAW_YouTube_Channels | 📋 All Channels | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |
| 133 | RAW_YouTube_Videos | 📋 All Videos | All/default complete-table inspection; Filter intentionally empty for this audit scope | NONE | NONE | CONTRACT_MISSING / NONE | CONTRACT_MISSING / NONE | User Prompt v0.13.5 + `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` | FILTER_OK_DEFAULT_CONTRACT_PARTIAL |

## Non-Apply remediation plan

1. Review and approve the 17 exact Google Filter contracts; confirm the Lark UI representation for rolling Last-30-days before touching `Google Ads Daily 30D`.
2. Write explicit contracts for the 55 `CONTRACT_MISSING` Specialized Views: purpose, conjunction, every condition, Sort, Hidden fields, audience and owner.
3. Complete Sort/Hidden policy for the 36 All/default Views; keep Filter empty unless a new approved contract says otherwise.
4. Resolve historical TikTok workbook names versus current six Report Views as an explicit migration/deprecation decision; do not silently create duplicate Views.
5. After contract approval, prepare a separate guarded Apply plan with exact action list. This audit does not authorize Lark mutation.
6. After any approved UI/API change, export Base again and rerun Live + offline audit; require 133/133 identity match and zero contract drift.

## Safety closeout

- No Table, Field, View or Record was created, updated, renamed or deleted.
- No connector, source API, Worker, Queue, D1, Cron, Schedule, advertisement or Production action was run.
- No credential, Table ID, Field ID, View ID, Record ID or business cell value is included in this report.

## Post-Apply result — 2026-07-22

User approved the four remediation steps after this first-pass audit. The resulting DEV-only work used `docs/lark-full-view-contract-v0.13.5.md` as the full technical-state contract:

- 55 Specialized Views became baseline-preservation contracts: no Filter/Sort/Hidden mutation and no business meaning inferred from their names.
- 36 All/default Views received an explicit preserve policy; the TikTok Native All Records View retains `SourceID` hidden.
- Guarded Google Filter Apply updated the exact 17 pending Views, created/deleted/renamed no View and wrote no Record.
- `Google Ads Daily 30D` was saved in Lark UI with `platform is google_ads AND metric_date is in the past 30 days`.
- Final managed Preview returned create/update/conflicts/warnings `0/0/0/0`.
- Final Full Live audit returned 42 tables, 133 Views, 42 filtered Views, 7 hidden-field Views and 133/133 identity match. The 17 Filter differences from the input export are exactly the approved Google changes; Hidden-field differences are zero.
- A fresh configuration-only export was later supplied at 2026-07-22 19:52:12 +0700. SHA-256: `704c10ea6fb1cd0790949cbc94a0865398521f00f7695a4f8ef5e8aa3c4c3ef2`.

## Fresh export offline verification — 2026-07-22

- Parser read Schema/View metadata only; no business cell value was inspected.
- Export structure: 43 snapshot blocks, 42 unique tables, one expected duplicate snapshot block and 133 Views.
- Presentation totals: 42 filtered Views, 6 sorted Views and 7 Views with hidden fields.
- Full identity comparison: expected/actual `133/133`, missing `0`, unexpected `0`.
- Contract comparison: Filter/Sort/Hidden differences `0/0/0`.
- All 17 Views classified `NEEDS_CHANGE` in the pre-Apply matrix now match the approved Google contract.
- `Google Ads Daily 30D` serialized as `AND: platform is [google_ads]; metric_date is [TheLastMonth]`, Sort `NONE`, Hidden `NONE`.

Result: the fresh export, approved v0.13.5 contract and prior post-Apply Live audit form a zero-drift handoff. Offline serialization audit is closed.

## Post-Formula export verification — 2026-07-22

- Fresh configuration-only export SHA-256: `3f177a1c2639da506c3e76e2d72bb9a018ccfb7ad29a38cbbca986b863d4b6c8`.
- Export contained 42 tables, 737 fields, 133 Views and zero Business Records, as expected for configuration-only scope.
- Formula/type/formatter contract matched `4/4` for `budget`, `all_conversion_value`, `cost_per_conversion` and `conversion_rate`.
- View identity missing/unexpected `0/0`; Filter/Sort/Hidden drift `0/0/0`; presentation totals remained 42 filtered, 6 sorted and 7 hidden-field Views.

Result: Formula UI and Full View Contract are both closed and offline-verified for developer-owned DEV.
