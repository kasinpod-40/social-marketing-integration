# Next Actions

## Immediate
1. Put real `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_APP_TOKEN`, and `TIKTOK_CREATOR_ACCOUNT_ID` into the Cloudflare environment.
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
4. Validate that `MKT_Content` receives one row per eligible TikTok video with Canva classification fields populated.
5. Validate that `MKT_Content_Daily` receives one row per eligible video for the selected metric date.
6. Run the sync job twice and confirm rows are updated, not duplicated.

## After live read/write validation
1. Add `MKT_Sync_Log` writes for TikTok Creator sync and metric seed results.
2. Add manual API route to enqueue sync/seed jobs from a secured admin endpoint.
3. Add live report aggregation that reads `MKT_Content_Daily` and writes `MKT_Report_Snapshots`.
4. Add AI summary generation from `MKT_Report_Snapshots` into `MKT_AI_Report_Runs`.
5. Continue to TikTok For Business Native + Reporting API path.
