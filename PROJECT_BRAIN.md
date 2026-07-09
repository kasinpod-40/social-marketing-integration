# Project Brain — Social Marketing Data Integration

## Current baseline
This project connects social organic and paid ads data into Lark Base for reporting, daily snapshots, monitoring, and AI summaries. The implementation target is a lean MVP using Cloudflare Workers, Cloudflare D1, Cloudflare Queues, Lark Base, Lark Native Integrations where useful, and JavaScript.

## Current project status
**Phase 1B — Canva report data model support implemented.**

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
- Added Lark Bitable client and Lark record repository.
- Added TikTok Creator read/write use case from `RAW_TikTok_Creator_Videos` to `MKT_Content` and `MKT_Content_Daily`.
- Wired sync-worker queue job type `tiktok.creator.native.sync` to the Lark upsert flow.
- Added tests for TikTok metric parsing, null handling, invalid numeric rejection, exact observed Lark labels, batch dedupe, snapshot key generation, Lark upsert behavior, and TikTok Creator sync orchestration.
- Added Canva-ready Lark table IDs to config.
- Added deterministic rule-based course/content/funnel classification for `MKT_Content`.
- Added `MKT_Metric_Definitions` seed rows and idempotent seed use case.
- Added `MKT_Report_Snapshots` row builder for weekly/monthly/YoY report payloads.
- Added sync-worker queue job type `metric.definitions.seed`.
- Added tests for content classification, metric seed, and report snapshot payloads.
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

## Current Canva-ready Lark table IDs
```text
MKT_Accounts = tblDcT7CVveNlNpP
MKT_Ads_Accounts = tbl3yPcXdQzZQvBc
MKT_Content = tbllvswTYP1dQGf3
MKT_Content_Daily = tbl5n2rbZU7NO07w
MKT_Ads_Campaigns = tblR7FwJ2tasEKPy
MKT_Ads_AdGroups = tblsFufuixpig0Tf
MKT_Ads_Creatives = tblmWi81dZ98v4dc
MKT_Ads_Daily = tblPTMsC9J32gukX
MKT_Metric_Definitions = tblk2Ho99sXqLLE2
MKT_Report_Snapshots = tbl81gHrMESpDolN
MKT_AI_Report_Runs = tblCX8IMtOiahI1x
RAW_TikTok_Creator_Videos = tblMdO6XCti94EwH
```

## Next action
Validate the Lark read/write mapping flow with live Lark table IDs:

1. Fill Lark table IDs in Cloudflare env or local config.
2. Run queue job `tiktok.creator.native.sync` for the synced TikTok account.
3. Confirm `MKT_Content` receives one row per eligible TikTok video.
4. Confirm `MKT_Content_Daily` receives one snapshot per eligible TikTok video per metric date.
5. Confirm a second run updates existing rows instead of creating duplicates.
6. Seed `MKT_Metric_Definitions` with queue job `metric.definitions.seed`.
7. Add `MKT_Sync_Log` write after live read/write validation.


## 2026-07-09 — v0.1.4 env-driven config + Lark classification dictionary
- Baseline: `v0.1.4-env-config-lark-dictionary`.
- Lark table IDs are now resolved from env only; source code is client-neutral.
- Added `LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY` and dictionary loading from Lark.
- `MKT_Classification_Dictionary` is now the source of truth for course/content/funnel/CTA/promotion/urgency mapping.
- Removed Chemistry K-specific hardcoded classification rules from core code.
- Unmatched content now goes to manual review via low confidence and `manual_tag_note` instead of guessed fields.
- Validation: `npm test` passed 25 tests; `npm run check` passed.
