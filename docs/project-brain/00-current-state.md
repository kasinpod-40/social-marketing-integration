# 00 — Current State

## Status
Phase 0 Lark Base Foundation is completed.

Phase 1A TikTok For Creator normalization foundation has started.

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

## Completed in code
- Added TikTok Creator native adapter.
- Added TikTok Creator normalization use case.
- Added tests for TikTok Creator field mapping and snapshot output.
- Added POC checklist: `docs/poc/tiktok-for-creator-poc.md`.

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

## Current phase
The project moved from pure Lark foundation into TikTok For Creator POC support.

Do not start full connector implementation until the first Native Integration POC confirms actual fields and sync behavior.

## Current priority
1. Run live TikTok For Creator POC in Lark.
2. Sync test data into `RAW_TikTok_Creator_Videos` or the native-created Lark table.
3. Validate exact fields, sync behavior, historical range, duplicate/update behavior, and schedule options.
4. Compare real field names with adapter aliases.
5. Update Project Brain with POC result.
6. Wire Lark read/write adapter only after live table behavior is confirmed.
