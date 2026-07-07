# 07 — Data Model

## Lark Base
Base name: `Social MKT Data Hub`

## Sidebar groups
- `📊 Dashboards`
- `🧩 Master Data`
- `📱 Organic Social`
- `💰 Paid Ads`
- `🤖 AI Reports`
- `⚙️ Sync & System`
- `🧪 Raw Integration Tables`

## Required main tables
- `MKT_Accounts`
- `MKT_Content`
- `MKT_Content_Daily`
- `MKT_Ads_Accounts`
- `MKT_Ads_Campaigns`
- `MKT_Ads_AdGroups`
- `MKT_Ads_Creatives`
- `MKT_Ads_Daily`
- `MKT_Sync_Log`
- `MKT_System_Alerts`
- `MKT_AI_Report_Runs`
- `MKT_Report_Settings`

## Required raw/native tables
- `RAW_TikTok_Creator_Videos`
- `RAW_TikTok_Business_Campaigns`
- `RAW_TikTok_Business_AdGroups`
- `RAW_TikTok_Business_Ads`
- `RAW_Google_Campaigns`
- `RAW_Google_Customer_Lists`

## Table groups
### Master Data
- `MKT_Accounts`
- `MKT_Ads_Accounts`

### Organic Social
- `MKT_Content`
- `MKT_Content_Daily`

### Paid Ads
- `MKT_Ads_Campaigns`
- `MKT_Ads_AdGroups`
- `MKT_Ads_Creatives`
- `MKT_Ads_Daily`

### AI Reports
- `MKT_AI_Report_Runs`
- `MKT_Report_Settings`

### Sync & System
- `MKT_Sync_Log`
- `MKT_System_Alerts`

### Raw Integration Tables
- All `RAW_*` tables.

## Primary fields
Main table primary fields are fixed as follows:

- `MKT_Accounts` → `account_key`
- `MKT_Ads_Accounts` → `ads_account_key`
- `MKT_Content` → `content_key`
- `MKT_Content_Daily` → `content_daily_key`
- `MKT_Ads_Campaigns` → `campaign_key`
- `MKT_Ads_AdGroups` → `ad_group_key`
- `MKT_Ads_Creatives` → `creative_key`
- `MKT_Ads_Daily` → `ads_daily_key`
- `MKT_AI_Report_Runs` → `report_id`
- `MKT_Report_Settings` → `report_name`
- `MKT_Sync_Log` → `sync_id`
- `MKT_System_Alerts` → `alert_id`

Raw table primary fields:
- `RAW_TikTok_Creator_Videos` → `video_id`
- `RAW_TikTok_Business_Campaigns` → `campaign_id`
- `RAW_TikTok_Business_AdGroups` → `ad_group_id`
- `RAW_TikTok_Business_Ads` → `ad_id`
- `RAW_Google_Campaigns` → `campaign_id`
- `RAW_Google_Customer_Lists` → `customer_list_id`

## Snapshot keys
- `MKT_Accounts`: `platform + account_id`
- `MKT_Content`: `platform + account_id + external_content_id`
- `MKT_Content_Daily`: `platform + account_id + external_content_id + metric_date`
- `MKT_Ads_Campaigns`: `platform + ads_account_id + campaign_id`
- `MKT_Ads_AdGroups`: `platform + ads_account_id + ad_group_id`
- `MKT_Ads_Creatives`: `platform + ads_account_id + ad_id`
- `MKT_Ads_Daily`: `platform + ads_account_id + campaign_id + ad_group_id + ad_id + metric_date`

## View baseline completed
Views with emoji prefixes have been created for the main tables, including connected/issue views for accounts, platform views for content and ads, latest/failed views for sync logs, alert views, and report period views.

## Raw table rule
`RAW_*` tables are landing/staging tables for native integration and mapping only. They must not be used as the final reporting source.

## Reporting source rule
Dashboards and AI summaries must use normalized `MKT_*` tables and daily snapshots, not raw native tables directly.

## Null rule
Unsupported metrics must be null/N/A, not zero.
