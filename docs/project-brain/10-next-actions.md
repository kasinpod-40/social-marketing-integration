# Next Actions

## Immediate
1. Add these env vars in local `.dev.vars` / Cloudflare Variables:
   ```text
   LARK_APP_ID
   LARK_APP_SECRET
   LARK_APP_TOKEN
   TIKTOK_CREATOR_ACCOUNT_ID
   LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS
   LARK_TABLE_MKT_CONTENT
   LARK_TABLE_MKT_CONTENT_DAILY
   LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY
   LARK_TABLE_MKT_METRIC_DEFINITIONS
   ```
2. Seed metric definitions by queueing:
   ```json
   {
     "type": "metric.definitions.seed"
   }
   ```
3. Trigger TikTok Creator sync:
   ```json
   {
     "type": "tiktok.creator.native.sync",
     "metricDate": "2026-07-07"
   }
   ```
4. Validate that `MKT_Content` receives one row per eligible TikTok video with dictionary-based classification fields.
5. Validate unmatched content gets `manual_tag_note = manual_review: no enabled dictionary rule matched` rather than guessed values.
6. Validate that `MKT_Content_Daily` receives one row per eligible video for the selected metric date.
7. Run the sync job twice and confirm rows are updated, not duplicated.

## After live read/write validation
1. Add `MKT_Sync_Log` writes for TikTok Creator sync and metric seed results.
2. Add manual API route to enqueue sync/seed jobs from a secured admin endpoint.
3. Add live report aggregation that reads `MKT_Content_Daily` and writes `MKT_Report_Snapshots`.
4. Add AI summary generation from `MKT_Report_Snapshots` into `MKT_AI_Report_Runs`.
5. Add WordPress/WooCommerce sales/order connector after confirming the client's order source.


### v0.1.5-lark-live-sync-validation

Added a dry-run validation queue job before the first real Lark write. Use `tiktok.creator.native.validate` to confirm env/table mapping, dictionary rules, normalization output, skipped rows, and sample keys before running `tiktok.creator.native.sync`.

## After v0.1.6

1. Fill `.dev.vars` with real Lark app credentials and table IDs.
2. Run `npm run validate:tiktok` and inspect rawRecords, dictionaryRules, contentRows, dailySnapshotRows, skippedRows, and warnings.
3. If validation is clean, run `CONFIRM_WRITE=YES npm run sync:tiktok`.
4. Verify `MKT_Content` and `MKT_Content_Daily` in Lark manually.
5. Seed metric definitions using `CONFIRM_WRITE=YES npm run seed:metrics` after table field validation.
