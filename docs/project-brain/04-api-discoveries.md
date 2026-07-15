# API / Native Integration Discoveries

## YouTube Data API / Analytics API

Status: Code-ready contract; Live DEV UAT pending.

- Data API channel lookup uses `channels.list`; uploads enumeration uses `playlistItems.list`; video details use `videos.list` in batches of at most 50 IDs.
- `videos.list` requests filtered by `id` do not send `maxResults`; the official method contract does not support that parameter combination.
- `quotaExceeded` is terminal for the current job and creates an operational alert; only short rate limits/backend failures use bounded retry.
- Public data supports API key or OAuth. Owner Analytics `reports.query` requires OAuth.
- Data API statistics are cumulative snapshots. Analytics rows are period metrics and must be stored separately.
- Hidden subscriber count and unsupported metrics stay `null`; explicit zero remains zero.
- Channel identity mismatch blocks writes.

## Meta Graph API

Status: Shared transport only; Facebook/Instagram business adapters remain planned.

- Require an explicit Graph API version and bearer token.
- Cursor pagination replays the original edge with the returned `after` cursor; code does not fetch arbitrary `paging.next` URLs.
- Facebook Page and Instagram Business mappings remain separate from transport because identities, permissions and metric semantics differ.

## WooCommerce / Chatwoot

Status: Sanitized contracts and fixtures only.

- WooCommerce monetary values remain decimal strings at the source boundary; no customer PII is required by the order contract.
- Chatwoot contract keeps operational conversation/inbox/agent/status timestamps and excludes message bodies, email and phone.

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
