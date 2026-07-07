# 00 — Current State

## Status
Phase 0 Lark Base Foundation is completed.

Phase 1A TikTok For Creator POC is live and passed for MVP usage.

## Completed in Lark
- Created Lark Base: `Social MKT Data Hub`.
- Imported main `MKT_*` tables.
- Imported `RAW_*` native integration tables.
- Organized sidebar folders:
  - `📊 Dashboards`
  - `🧩 Master Data`
  - `📱 Organic Social`
  - `💰 Paid Ads`
  - `🤖 AI Reports`
  - `⚙️ Sync & System`
  - `🧪 Raw Integration Tables`
- Added table icons.
- Fixed primary fields for main MKT tables.
- Configured core field types.
- Configured select options.
- Created base views with icons.

## Completed TikTok For Creator POC
- Connected TikTok For Creator through Lark Native Integration.
- Lark created a sync-managed table automatically.
- The table was renamed to `RAW_TikTok_Creator_Videos` and moved into `🧪 Raw Integration Tables`.
- Rename/move did not break sync.
- Manual sync updates existing rows and does not create duplicate rows.
- Initial sync returned 20 records.
- The TikTok account has 21 videos; the missing item is a video with removed audio, so the gap is likely video eligibility/content availability rather than a confirmed native connector pagination limit.

## Completed in code
- Added TikTok Creator native adapter.
- Added TikTok Creator single-row normalization use case.
- Added TikTok Creator batch normalization use case with O(n) dedupe and skipped-row collection.
- Added tests for TikTok Creator field mapping, exact observed Lark labels, snapshot output, batch dedupe, and invalid row isolation.
- Added POC checklist/result: `docs/poc/tiktok-for-creator-poc.md`.

## Confirmed decisions
- Main language: JavaScript.
- Runtime: Cloudflare Workers.
- Database: Cloudflare D1.
- Queue: Cloudflare Queues.
- Reporting UI: Lark Base and Lark Dashboards.
- External dashboard: not included in phase 1.
- Connect UI: lightweight OAuth/connect/reconnect pages only.
- Architecture: Clean Architecture + Monorepo + Modular Monolith.
- Base name: `Social MKT Data Hub`.
- TikTok Organic uses Lark TikTok For Creator native integration first.
- `RAW_TikTok_Creator_Videos` is the official raw source for TikTok Organic video analytics.

## Current phase
The project is ready to move from TikTok Creator live POC into the Lark read/write adapter and real mapping flow.

## Current priority
1. Commit/tag the TikTok Creator POC confirmation update.
2. Implement Lark read/write adapter for reading `RAW_TikTok_Creator_Videos` and upserting into `MKT_Content` / `MKT_Content_Daily`.
3. Preserve snapshot-first reporting; dashboards must not use raw table metrics directly.
4. Record sync and mapping runs into `MKT_Sync_Log`.
