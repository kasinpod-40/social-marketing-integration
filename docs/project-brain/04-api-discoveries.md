# 04 — API Discoveries

## TikTok For Creator — Lark Native Integration

Status: Live POC passed for MVP usage.

Confirmed live behavior:
- Lark TikTok For Creator can request TikTok profile, public videos, user analytics, and video analytics permissions.
- Lark creates a sync-managed table automatically.
- The sync-managed table can be renamed to `RAW_TikTok_Creator_Videos` and moved into `🧪 Raw Integration Tables` without breaking sync.
- The table still exposes `Sync Data`, `Edit Configuration`, and `Remove Sync` after rename/move.
- Manual sync updates existing rows instead of creating duplicates.
- Initial sync returned 20 records.
- The TikTok account has 21 videos; the missing video has removed audio. This suggests video eligibility/content availability is the likely cause of the missing record, not a confirmed pagination limit.

Confirmed video analytics fields:
- Unique identifier of the video
- Date and time the video was published
- Total number of times the video was shared
- Total number of comments the video received
- Total number of likes the video received
- Video duration in seconds, rounded to three decimal places
- Total video views
- Video description
- Embeddable link for this TikTok video
- Shareable URL for this TikTok video
- Temporary URL for video content thumbnail
- Average video play duration based on all views
- Total video play duration based on all views
- Percentage of video watched completely
- Total number of viewers who watched the video (deduplicated)
- Different sources of video exposure, arranged by exposure percentage
- Breakdown percentage data of audience country/region

Decision:
- Use `RAW_TikTok_Creator_Videos` as the official raw source for TikTok Organic video analytics.
- Use Lark Native Integration as primary source for TikTok Organic in the MVP.
- Continue to normalize raw rows into `MKT_Content` and `MKT_Content_Daily`.
- Do not use raw/native tables directly for dashboards.
- Treat videos with removed audio/restricted availability/unavailable analytics as possible native omissions.

Current implementation:
- `creator-native.adapter.js` maps observed Lark field labels into canonical fields.
- `normalize-tiktok-creator-video.js` converts one raw row into `MKT_Content` and `MKT_Content_Daily` rows.
- `normalize-tiktok-creator-video-batch.js` converts batches in O(n), dedupes by upsert key, and isolates bad rows as skipped rows.
- Completion rate is normalized to decimal ratio.
- Missing unsupported fields stay null.
- Unique viewers must not be renamed as reach.

Remaining checks:
1. Observe the next automatic scheduled sync cycle.
2. Confirm whether newly posted valid videos appear in the raw table.
3. Confirm whether removed-audio/restricted videos remain omitted.

## TikTok For Business — Lark Native Integration

Status: inspected, not yet live POC in this repo phase.

Discovery:
- Native integration exposes Campaign List, Ad Group List, and Ads List.
- Fields are mainly master/configuration data: campaign objective, bidding strategy, target ROAS, targeting settings, creative/video/post IDs, CTA, landing page, catalog/product references, and tracking URLs.
- It does not appear to expose daily performance metrics such as spend, impressions, clicks, conversions, conversion value, and actual ROAS.

Decision:
- Use Lark native integration for TikTok Ads master data.
- Use custom TikTok Reporting API only for ads performance when access is available.

## Google Ads — Lark Native Integration

Status: inspected.

Discovery:
- Native integration exposes Customer List and Campaign List.
- Customer List is audience/user-list style data.
- Campaign List is campaign master/configuration data: id, name, status, serving status, channel type, budget reference, bidding strategy type, network targeting flags, and target CPA.
- It does not expose daily performance report metrics in the observed field list.

Decision:
- Use native integration for Google campaign/customer-list master data only.
- Use Google Ads API / GAQL for performance reporting if required.
