# API / Native Integration Discoveries

## YouTube Data API / Analytics API

Status: Source contract and DEV smoke verified; customer-scale Live UAT pending.

- Data API Channel lookup uses `channels.list`.
- Upload enumeration uses `playlistItems.list` with cursor pagination.
- Video details use `videos.list` in batches of at most 50 IDs.
- `videos.list(id)` does not send `maxResults`.
- `quotaExceeded` is terminal for the current job; short rate limits/backend failures use bounded retry.
- Public data supports API key or OAuth; Owner Analytics requires OAuth.
- Data API statistics are cumulative latest-state snapshots.
- Analytics rows are period metrics and remain RAW-only in the current phase.
- Owner Analytics completeness uses exact queried-video markers, not returned row count.
- Analytics `day` is the exact Pacific source day.
- Missing/unsupported metrics remain `null`; explicit zero remains zero.
- Channel identity mismatch blocks writes.

Customer 837-video scope requires bounded full pagination, Analytics chunking, durable resume and exact completeness verification.

## Meta Graph API

Status: Shared transport verified; Facebook/Instagram business adapters remain planned.

- Require an explicit Graph API version and bearer token.
- Cursor pagination replays the approved edge with the returned `after` cursor.
- Do not fetch arbitrary `paging.next` URLs.
- Facebook Page and Instagram Business identity/metric mappings remain separate.
- Valid read preflight does not authorize connector writes or schedule activation.

## WooCommerce / Chatwoot

Status: Sanitized contracts and fixtures only.

- WooCommerce monetary values remain decimal strings at the source boundary.
- Current marketing-data scope does not require customer PII.
- Chatwoot contract keeps approved operational conversation/inbox/agent/status timestamps.
- Message bodies, email and phone are excluded.

## TikTok For Creator — Lark Native Integration

Status: Confirmed MVP RAW source.

- Lark Native Integration creates and manages the source table.
- The table may be renamed to `RAW_TikTok_Creator_Videos` and moved into the RAW folder without breaking sync.
- Manual sync updates existing rows and does not create duplicate records in verified DEV tests.
- Missing content can reflect eligibility/content availability and is not proof of a fixed row limit.
- Worker must treat this table as protected read-only schema.
- Canonical reporting uses `MKT_Content` and `MKT_Content_Daily`, not RAW directly.
- Missing metrics remain `null`.
- Unique viewers must not be renamed as Reach automatically.

## TikTok Ads

Status: Access and connector preflight pending.

Production must use a controlled API/Worker connector. Lark TikTok For Business Native Integration is not the Production source of truth and cannot bypass:

- exact advertiser identity;
- token/scope lifecycle;
- stable keys/idempotency;
- bounded pagination/rate limiting;
- Queue/DLQ/D1 reliability;
- reconciliation/audit;
- customer-owned Production resources.

## Google Ads — Lark Native Integration

Status: Master/config discovery only.

Observed native sources include Customer List and Campaign List. They are insufficient for confirmed daily performance metrics such as spend, impressions, clicks, conversions, conversion value and ROAS.

## Google Ads — Direct API access

Current state:

```text
Basic Access application submitted 2026-07-21
Case ID 1-686800040839
Cloud project number 788131774873
Review pending
Developer-token level Test Account Access
```

Direct API is an optional Phase 2 path and does not block the Manager Script MVP.

Any older note saying no Basic Access application was submitted is superseded.

## Google Ads — Manager Script

Status: Customer-authorized read-only Live Preview passed on 2026-07-22.

- Exact target allowlist matched the linked advertiser.
- `AdsManagerApp.select()` switched to the intended account.
- The Script queried six bounded datasets:
  1. account;
  2. campaigns;
  3. ad groups;
  4. ads;
  5. YouTube assets;
  6. campaign daily metrics.
- This Scripts runtime rejected `campaign.start_date` and `campaign.end_date` with `QueryError.UNRECOGNIZED_FIELD`.
- Removing those request fields produced a successful rerun while nullable output mapping remained `null`.
- Final result: `data_available`, six non-empty datasets, errors/truncation `0/0`, Preview `No changes`.
- Frequency remains `—`; no schedule exists.
- No external delivery exists in the reviewed version.

Evidence boundary:

- The 598-line safety scan is documented Live review evidence.
- Sanitized source is not committed, so it is not independently reproducible from Repository source.
- Before signed delivery, add a sanitized Script snapshot or immutable checksum/query/output manifest.

See `docs/google-ads-manager-script-read-only-uat-evidence.md`.

## Lark View OpenAPI discoveries

- List Views can omit `property`; hydrate existing Views with Get View before idempotency comparison.
- Filter and Hidden fields use separate mutations.
- Request payload must not replay response-only metadata.
- Single-select values must resolve to Live Option IDs.
- Checkbox values remain JSON booleans, for example `[true]`.
- Relative-date response metadata must not be replayed as an inferred request schema.
- Google Ads View maintenance is update-only; missing managed View must fail closed rather than create a replacement.

## Lark Formula discovery

Verified tenant syntax:

- Field reference: `[field]`
- Blank test: `ISBLANK(...)`
- Blank numeric result: `""`
- `{field}` and `BLANK()` are invalid in this tenant.
