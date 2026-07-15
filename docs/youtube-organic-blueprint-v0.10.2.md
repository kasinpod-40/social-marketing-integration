# YouTube Organic Blueprint v0.10.2

## Decision status

- Status: `blueprint_rc2_complete_pending_user_approval`
- Source contract: `youtube-organic-v2`
- Workbook: `Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx`
- Live mutation: none

เอกสารนี้บันทึกการแก้ Blueprint จาก Review ของ v0.10.1 เท่านั้น. ยังไม่อนุญาตให้
Apply Lark Schema, เรียก YouTube API, เปิด Worker route/schedule หรือ Deploy.

## Revised contracts

### Channel

- One latest-state row per Channel; upsert by `youtube:{channel_id}`.
- `uploads_playlist_id` may be null in RAW, but activation preflight blocks traversal when missing.
- `subscriber_count_hidden` preserves the Source Boolean.
- Hidden subscriber count remains `null`; visible counts retain YouTube's rounded-count semantics.

### Video and reconciliation

- One latest-state row per Channel + Video.
- Store `last_seen_at`, `source_availability_status`, and `missing_since`.
- Missing item retains the prior row and metrics, emits a warning, and is never deleted or zero-filled.
- Private/deleted requires explicit authorized Source evidence; absence alone means `missing`.
- Phase 1 canonical `content_type` is always `video`; Shorts classification is deferred.

### Owner Analytics

- Key by Channel + Video + exact `source_metric_date` returned by Analytics.
- Source day is `America/Los_Angeles`; store exact `YYYY-MM-DD` Text without Bangkok conversion.
- Query uses `ids=channel==CHANNEL_ID`, `dimensions=day,video`, explicit `sort=day,video`, approved metrics, internal 50-Video batches, `maxResults=200`, row-count `startIndex` pagination, and a 1,000-page bound.
- Use the maximum returned day common to the requested metric set. A never-observed Video×Day gap creates no row, zero or warning; a previously observed Stable key that disappears on re-fetch retains the prior row and creates a reconciliation warning.
- Period metrics remain in `RAW_YouTube_Analytics_Daily` only during Phase 1 and cannot overwrite cumulative `MKT_Content_Daily`.
- Future canonical conversions: `estimatedMinutesWatched × 60`, `averageViewDuration` unchanged, `averageViewPercentage ÷ 100`.

## Canonical mapping

- `MKT_Accounts`: configured account key + Channel identity/title + lifecycle/timezone metadata.
- `MKT_Content`: field-by-field mapping for identity, publish time, caption, URLs, duration, cumulative public metrics, explicit nulls and shared classifier outputs.
- `MKT_Content_Daily`: field-by-field cumulative Data API snapshot keyed by configured reporting `metric_date`; unsupported period/breakdown fields remain null.
- Owner Analytics: no canonical destination in Phase 1.

## Workbook QA

- 10 sheets
- 9 tables / 105 fields / 42 YouTube fields
- `YouTube Mapping` is field-by-field and `YouTube Approval` records the rc.2 corrections
- Formula-error scan: 0 matches
- Every sheet rendered and visually inspected

## Blocking gates

1. User approves the v0.10.2 fields, keys, query, mappings and RAW-only Analytics decision.
2. Authorized DEV Channel ID and credential are supplied outside Source control.
3. Identity/access and minimal payload preflight pass.
4. Live payload confirms uploads playlist, hidden subscriber, Pacific date and metric-unit semantics.
5. Only then may the three RAW tables be previewed/applied and Manual sync implementation begin.

Meta, WooCommerce, Chatwoot and Ads are outside this revision.
