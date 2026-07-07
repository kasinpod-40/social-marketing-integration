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

## Completed Phase 1A code actions
- Added TikTok Creator native row mapper.
- Added TikTok Creator normalization use case.
- Added tests for mapping, null metric behavior, invalid numeric rejection, and daily snapshot output.
- Added POC checklist at `docs/poc/tiktok-for-creator-poc.md`.

## Immediate next actions
1. Run live TikTok For Creator Native Integration POC in Lark.
2. Connect TikTok account through Lark Native Integration.
3. Select TikTok Account Video Data.
4. Sync into `RAW_TikTok_Creator_Videos` if possible. If Lark creates its own table, keep it as the native raw source and document the actual table name.
5. Capture exact fields returned by the connector.
6. Check whether sync updates existing rows or creates new rows.
7. Check how many historical videos are pulled and whether more than 20 records are supported.
8. Check automatic sync schedule options.
9. Compare real field names against aliases in `creator-native.adapter.js`.
10. Record POC result in Project Brain.
11. Wire Lark read/write adapter after real table behavior is confirmed.

## After TikTok For Creator POC
1. Run TikTok For Business POC for Campaign / Ad Group / Ads master data.
2. Run Google Ads Native POC confirmation for Campaign List and Customer List.
3. Start core implementation: D1 schema, queue contracts, sync log writer, and Lark writer.

## Do not start yet
- Do not implement full TikTok Reporting API until access requirements are clear.
- Do not implement full Google Ads GAQL until native gap is confirmed and credentials path is clear.
- Do not create dashboards before snapshot fields and mapping rules are validated with real/native data.
- Do not let AI summaries use raw or unverified metrics.
