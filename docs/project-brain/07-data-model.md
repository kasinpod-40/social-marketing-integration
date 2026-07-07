# 07 — Data Model

## Required main tables
- MKT_Accounts
- MKT_Content
- MKT_Content_Daily
- MKT_Ads_Accounts
- MKT_Ads_Campaigns
- MKT_Ads_AdGroups
- MKT_Ads_Creatives
- MKT_Ads_Daily
- MKT_Sync_Log
- MKT_System_Alerts
- MKT_AI_Report_Runs
- MKT_Report_Settings

## Required raw/native tables
- RAW_TikTok_Creator_Videos
- RAW_TikTok_Business_Campaigns
- RAW_TikTok_Business_AdGroups
- RAW_TikTok_Business_Ads
- RAW_Google_Ads_Campaigns
- RAW_Google_Ads_Customer_Lists

## Snapshot keys
- MKT_Content: platform + account_id + external_content_id
- MKT_Content_Daily: platform + account_id + external_content_id + metric_date
- MKT_Ads_Daily: platform + ads_account_id + campaign_id + ad_group_id + ad_id + metric_date

## Null rule
Unsupported metrics must be null/N/A, not zero.
