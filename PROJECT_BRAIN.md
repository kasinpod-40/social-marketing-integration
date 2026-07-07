# Project Brain — Social Marketing Data Integration

## Current baseline
This project connects social organic and paid ads data into Lark Base for reporting, daily snapshots, monitoring, and AI summaries. The implementation target is a lean MVP using Cloudflare Workers, Cloudflare D1, Cloudflare Queues, Lark Base, Lark Native Integrations where useful, and JavaScript.

## Current project status
**Phase 1A — TikTok For Creator normalization foundation has started.**

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

Completed in code:
- Added robust TikTok For Creator native row mapper.
- Added TikTok Creator normalization use case from `RAW_TikTok_Creator_Videos` to `MKT_Content` and `MKT_Content_Daily`.
- Added tests for TikTok metric parsing, null handling, invalid numeric rejection, and snapshot key generation.
- Added TikTok For Creator POC checklist in `docs/poc/tiktok-for-creator-poc.md`.

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
- `RAW_TikTok_Creator_Videos`
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

## Primary artifacts
- `PROJECT_BRAIN.md` — current truth and handoff summary.
- `docs/project-brain/` — project history, rules, decisions, and next actions.
- `docs/poc/tiktok-for-creator-poc.md` — TikTok For Creator POC checklist.
- `migrations/` — D1 schema draft.
- `apps/` — Cloudflare Worker entry points.
- `packages/` — clean architecture modules.
- `tests/` — baseline tests for pure domain and mapping logic.

## Next action
Run the live Lark Native Integration POC for TikTok For Creator:

1. Connect TikTok For Creator in Lark.
2. Sync video data into `RAW_TikTok_Creator_Videos` or the native-created raw table.
3. Validate exact fields, sync behavior, duplicate/update behavior, historical range, and schedule options.
4. Compare real field names with `creator-native.adapter.js` aliases.
5. Update Project Brain with POC result.
6. Wire Lark read/write adapter after live table behavior is confirmed.
