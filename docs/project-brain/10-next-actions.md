# 10 — Next Actions

## Completed foundation actions
- Lark Base created as `Social MKT Data Hub`.
- Main `MKT_*` tables imported.
- `RAW_*` native integration tables imported.
- Sidebar folders organized.
- Table icons configured.
- Primary fields fixed.
- Core field types configured.
- Main select options configured.
- Base views with icons created.
- Git baseline committed and pushed.

## Completed Phase 1A actions
- Added TikTok Creator native row mapper.
- Added TikTok Creator single-row normalization use case.
- Added TikTok Creator batch normalization use case.
- Added tests for mapping, null metric behavior, invalid numeric rejection, daily snapshot output, batch dedupe, and skipped invalid rows.
- Added POC checklist/result at `docs/poc/tiktok-for-creator-poc.md`.
- Completed live Lark TikTok For Creator POC:
  - Native table created automatically.
  - Native table renamed to `RAW_TikTok_Creator_Videos`.
  - Native table moved into `🧪 Raw Integration Tables`.
  - Sync remained connected after rename/move.
  - Manual sync updated existing rows without duplicates.
  - 20/21 account videos synced; missing video has removed audio.

## Immediate next actions
1. Commit/tag this POC confirmation update.
2. Implement Lark read adapter for `RAW_TikTok_Creator_Videos`.
3. Implement Lark batch upsert adapter for `MKT_Content` and `MKT_Content_Daily`.
4. Implement a sync use case that reads raw TikTok Creator rows, normalizes them, upserts content/snapshots, and writes `MKT_Sync_Log`.
5. Run a real mapping test with the 20 synced records.
6. Verify that raw metrics become stable report rows in `MKT_Content` and `MKT_Content_Daily`.

## After TikTok For Creator mapping
1. Run TikTok For Business POC for Campaign / Ad Group / Ads master data.
2. Run Google Ads Native POC confirmation for Campaign List and Customer List.
3. Start core implementation: D1 schema, queue contracts, sync log writer, and Lark writer.

## Do not start yet
- Do not implement full TikTok Reporting API until access requirements are clear.
- Do not implement full Google Ads GAQL until native gap is confirmed and credentials path is clear.
- Do not create dashboards before snapshot fields and mapping rules are validated with real/native data.
- Do not let AI summaries use raw or unverified metrics.
