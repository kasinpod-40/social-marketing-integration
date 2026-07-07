# TikTok For Creator Native Integration POC

## Objective
Validate Lark TikTok For Creator native integration before writing any custom TikTok Organic connector.

## Target table
`RAW_TikTok_Creator_Videos`

## Required checks
1. Connect the TikTok account through Lark TikTok For Creator.
2. Select `TikTok Account Video Data`.
3. Sync into `RAW_TikTok_Creator_Videos`.
4. Confirm field availability:
   - video id
   - published time
   - description
   - shareable URL
   - thumbnail URL
   - duration
   - views
   - likes
   - comments
   - shares
   - average play duration
   - total play duration
   - completion rate
   - unique viewers
   - traffic sources
   - country/region breakdown
5. Confirm whether sync updates existing rows or creates duplicates.
6. Confirm whether more than 20 videos can be synced.
7. Confirm automatic sync schedule, error logs, retry behavior, and historical range.

## Mapping result
`RAW_TikTok_Creator_Videos` is normalized into:
- `MKT_Content`
- `MKT_Content_Daily`

## Hard rules
- Do not use `RAW_*` tables directly for dashboard reporting.
- Missing unsupported metrics must remain `null`, not `0`.
- Completion rate is normalized as a decimal ratio, for example `45%` becomes `0.45`.
- Unique viewers must not be renamed as reach unless the platform definition supports it.
- Daily reporting must use `MKT_Content_Daily`, not native rows that may be overwritten.
