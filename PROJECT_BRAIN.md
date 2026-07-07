# Project Brain — Social Marketing Data Integration

## Current baseline
This project connects social organic and paid ads data into Lark Base for reporting, daily snapshots, monitoring, and AI summaries. The implementation target is a lean MVP using Cloudflare Workers, Cloudflare D1, Cloudflare Queues, Lark Base, Lark Native Integrations where useful, and JavaScript.

## Current project status
**Phase 1A — TikTok For Creator live POC passed for MVP usage.**

Completed in Lark:
- Created Lark Base: `Social MKT Data Hub`.
- Imported main `MKT_*` tables.
- Imported `RAW_*` native integration tables.
- Organized sidebar folders.
- Added table icons.
- Fixed primary fields for main MKT tables.
- Configured core field types.
- Configured main select options.
- Created base views with icons.

Completed TikTok For Creator POC:
- Connected TikTok For Creator via Lark Native Integration.
- Lark created a sync-managed table automatically.
- The table was renamed to `RAW_TikTok_Creator_Videos` and moved into `🧪 Raw Integration Tables`.
- Sync stayed connected after rename/move.
- Manual sync updates existing rows and does not create duplicates.
- Initial sync returned 20 records.
- The TikTok account has 21 videos; the missing video has removed audio, so the omission is likely video eligibility/content availability rather than a confirmed pagination limit.

Completed in code:
- Added robust TikTok For Creator native row mapper.
- Added TikTok Creator normalization use case from `RAW_TikTok_Creator_Videos` to `MKT_Content` and `MKT_Content_Daily`.
- Added TikTok Creator batch normalization use case with O(n) dedupe and skipped-row collection.
- Added tests for TikTok metric parsing, null handling, invalid numeric rejection, exact observed Lark labels, batch dedupe, and snapshot key generation.
- Added TikTok For Creator POC result in `docs/poc/tiktok-for-creator-poc.md`.

## Phase 0 objective
Create the project foundation before writing platform connectors:

1. Lock the project scope and hard rules. ✅
2. Lock the Lark table/field model. ✅
3. Prepare Lark import templates. ✅
4. Create the Lark Base structure. ✅
5. Create a Clean Architecture monorepo skeleton. ✅
6. Run Native Integration POCs. In progress

## Hard direction
- JavaScript only for implementation.
- Clean Architecture + Monorepo + Modular Monolith.
- Native-first, custom-fallback.
- No external dashboard in phase 1; Lark Base and Lark dashboards are the main UI.
- Read-only reporting first; no campaign creation, budget editing, bid editing, or auto-optimization.
- Daily snapshots are required for reporting.
- Metrics must have strict definitions before being shown in dashboards.
- Project Brain updates are part of the Definition of Done.

## Lark Base structure
Base name: `Social MKT Data Hub`

Sidebar groups:
- `📊 Dashboards`
- `🧩 Master Data`
- `📱 Organic Social`
- `💰 Paid Ads`
- `🤖 AI Reports`
- `⚙️ Sync & System`
- `🧪 Raw Integration Tables`

Main tables:
- `MKT_Accounts`
- `MKT_Content`
- `MKT_Content_Daily`
- `MKT_Ads_Accounts`
- `MKT_Ads_Campaigns`
- `MKT_Ads_AdGroups`
- `MKT_Ads_Creatives`
- `MKT_Ads_Daily`
- `MKT_Sync_Log`
- `MKT_System_Alerts`
- `MKT_AI_Report_Runs`
- `MKT_Report_Settings`

Raw tables:
- `RAW_TikTok_Creator_Videos` — official native sync-managed TikTok Creator raw source
- `RAW_TikTok_Business_Campaigns`
- `RAW_TikTok_Business_AdGroups`
- `RAW_TikTok_Business_Ads`
- `RAW_Google_Campaigns`
- `RAW_Google_Customer_Lists`

## TikTok For Creator normalization baseline
Native row source: `RAW_TikTok_Creator_Videos`

Output tables:
- `MKT_Content`
- `MKT_Content_Daily`

Current mapping rules:
- `video_id` becomes `external_content_id`.
- `content_key` is generated from `platform::account_id::external_content_id`.
- `content_daily_key` is generated from `platform::account_id::external_content_id::metric_date`.
- Missing unsupported metrics remain `null`, never `0`.
- Completion rate is normalized to decimal ratio, for example `45%` becomes `0.45`.
- Unique viewers stays `unique_viewers`; do not rename it as reach.
- Raw/native rows are not reporting tables; dashboard reporting must use `MKT_Content_Daily`.
- Batch normalization is O(n), dedupes by upsert key, and isolates invalid rows instead of failing the entire batch.

## Primary artifacts
- `PROJECT_BRAIN.md` — current truth and handoff summary.
- `docs/project-brain/` — project history, rules, decisions, and next actions.
- `docs/poc/tiktok-for-creator-poc.md` — TikTok For Creator POC result.
- `migrations/` — D1 schema draft.
- `apps/` — Cloudflare Worker entry points.
- `packages/` — clean architecture modules.
- `tests/` — baseline tests for pure domain and mapping logic.

## Next action
Implement the Lark read/write mapping flow for TikTok Creator:

1. Read rows from `RAW_TikTok_Creator_Videos`.
2. Normalize rows into `MKT_Content` and `MKT_Content_Daily`.
3. Upsert by stable key.
4. Write sync result into `MKT_Sync_Log`.
5. Validate with the 20 live synced rows.
