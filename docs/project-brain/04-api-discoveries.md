# 04 — API Discoveries

## TikTok For Creator — Lark Native Integration

Status: POC support started, live sync still pending.

Confirmed from previous manual inspection:
- Lark TikTok For Creator can request TikTok profile, public videos, user analytics, and video analytics permissions.
- Observed video analytics fields include views, likes, comments, shares, average play duration, total play duration, percentage watched completely, unique viewers, traffic sources, and audience country/region breakdown.
- This is richer than the public/basic TikTok Display API assumption and should be used native-first for TikTok Organic.

Current implementation assumptions:
- `RAW_TikTok_Creator_Videos` is the staging table.
- Raw fields are mapped into `MKT_Content` and `MKT_Content_Daily`.
- Completion rate is normalized to decimal ratio.
- Missing unsupported fields stay null.
- Unique viewers must not be renamed as reach.

Live POC checks still required:
1. Exact field names returned after sync.
2. Whether Lark writes into the prepared raw table or creates its own native table.
3. Whether sync updates existing rows or creates duplicates.
4. Whether more than 20 videos can be synced.
5. Automatic sync schedule options.
6. Sync logs, retry behavior, and historical range.

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
