# TikTok For Creator POC

## Current result

Status: Live POC passed for MVP usage.

Observed result in Lark:
- Lark TikTok For Creator created a sync-managed table automatically.
- The sync-managed table was renamed to `RAW_TikTok_Creator_Videos` and moved to `🧪 Raw Integration Tables`.
- Rename/move did not break sync.
- The table still shows `Sync Data`, `Edit Configuration`, `Remove Sync`, and `Last synced`.
- Manual sync updates existing records and does not create duplicate rows.
- Initial sync returned 20 records.
- The TikTok account has 21 videos; the missing video is a video with removed audio, so the missing item is likely video eligibility/content availability rather than a confirmed pagination limit.

## Production interpretation

`RAW_TikTok_Creator_Videos` is now the official raw source for TikTok Organic video analytics.

Rules:
- Do not delete this table.
- Do not click `Remove Sync` unless intentionally disconnecting the native source.
- Do not use this raw table directly for dashboards.
- Normalize into `MKT_Content` and `MKT_Content_Daily` before reporting.
- Videos with removed audio, restricted availability, non-public status, or unavailable analytics may be missing from the native sync.

## Confirmed fields

The connector can provide the following video analytics fields:
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

## Sync behavior

Confirmed:
- Manual sync updates existing rows.
- Duplicate rows were not created during the observed manual sync.
- 1-hour schedule is useful for POC.

Production target:
- Use 24-hour sync for production daily reporting unless the client explicitly requires faster refresh.

## Next implementation step

Map `RAW_TikTok_Creator_Videos` into:
- `MKT_Content`
- `MKT_Content_Daily`

Current code support:
- `creator-native.adapter.js` maps observed Lark field names into canonical TikTok Creator fields.
- `normalize-tiktok-creator-video.js` converts one raw row into content and daily snapshot rows.
- `normalize-tiktok-creator-video-batch.js` converts a batch in O(n), dedupes by upsert key, and collects invalid rows without failing the whole batch.
