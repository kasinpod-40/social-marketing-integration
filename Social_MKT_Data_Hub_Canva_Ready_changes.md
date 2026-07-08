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

