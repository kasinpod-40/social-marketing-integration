# API / Native Integration Discoveries

## TikTok For Creator — Lark Native Integration

Status: Confirmed for MVP usage.

Findings:
- Lark Native Integration creates a sync-managed table automatically.
- The sync-managed table can be renamed to `RAW_TikTok_Creator_Videos` and moved into `🧪 Raw Integration Tables` without breaking sync.
- Manual sync updates existing rows and does not create duplicate records.
- Initial sync returned 20 records from a TikTok account with 21 videos.
- The missing video had removed audio, so the missing record is likely due to video eligibility/content availability rather than a confirmed 20-row pagination limit.

Confirmed useful fields:
- Video ID
- Published time
- Video description
- Shareable URL
- Thumbnail URL
- Video duration
- Views
- Likes
- Comments
- Shares
- Average video play duration
- Total video play duration
- Percentage watched completely
- Unique viewers
- Traffic sources
- Audience country/region breakdown

Rule:
- `RAW_TikTok_Creator_Videos` is the official raw source for TikTok Organic video analytics.
- Reporting must use `MKT_Content` and `MKT_Content_Daily`, not the raw table directly.
- Missing metrics stay `null`, not `0`.
- Unique viewers must not be renamed as Reach automatically.

## Google Ads — Lark Native Integration

Status: Master-data only from observed fields.

Observed sources:
- Customer List
- Campaign List

Conclusion:
- Native Google Ads is useful for customer/audience lists and campaign master/config fields.
- It does not currently provide confirmed daily performance metrics such as spend, impressions, clicks, conversions, conversion value, or ROAS.
- Google Ads Performance Reporting still needs custom Google Ads API / GAQL unless another native source is found.
