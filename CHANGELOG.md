# Changelog

## 0.1.3-canva-report-data-model-support
- Added latest Lark table IDs for the Canva-ready Base structure.
- Added deterministic course/content/funnel classification for `MKT_Content` fields.
- Added `MKT_Metric_Definitions` seed rows and idempotent seed use case.
- Added `MKT_Report_Snapshots` row builder for weekly/monthly/YoY Canva-style report payloads.
- Wired sync-worker queue job type `metric.definitions.seed`.
- Updated TikTok Creator normalization to write course/theme/funnel/CTA classification fields.
- Added tests for classification, metric definitions, report snapshots, and updated TikTok normalization.

## 0.1.2-tiktok-creator-lark-upsert
- Added Lark Bitable client for token retrieval, paginated record reads, key search, batch create, and batch update.
- Added Lark record repository with O(n) key dedupe, bounded-concurrency lookups, and create/update split.
- Added TikTok Creator read/write sync use case from `RAW_TikTok_Creator_Videos` to `MKT_Content` and `MKT_Content_Daily`.
- Wired `sync-worker` queue job type `tiktok.creator.native.sync` to the TikTok Creator Lark upsert flow.
- Added tests for Lark upsert behavior and TikTok Creator Lark sync orchestration.
- Updated README, Wrangler example vars, Project Brain, and next actions.

## 0.1.1-tiktok-creator-poc-confirmed
- Recorded live TikTok For Creator POC result: native table creation, rename/move safety, sync-managed source, update-in-place behavior, and 20/21 video eligibility finding.
- Confirmed `RAW_TikTok_Creator_Videos` as the official TikTok Creator raw source.
- Expanded observed Lark field aliases for TikTok Creator native rows.
- Added O(n) batch normalization use case with upsert-key dedupe and skipped-row collection.
- Added tests for exact observed Lark labels, batch dedupe, and invalid row isolation.
- Updated Project Brain, API discoveries, POC notes, and next actions.

## 0.1.0-tiktok-creator-poc-foundation
- Started Phase 1A TikTok For Creator native integration support.
- Added robust TikTok Creator native row mapper with alias handling for observed Lark field names.
- Added normalization use case from `RAW_TikTok_Creator_Videos` to `MKT_Content` and `MKT_Content_Daily`.
- Added tests for TikTok metric parsing, null handling, invalid metric rejection, and daily snapshot output.
- Added `docs/poc/tiktok-for-creator-poc.md` live POC checklist.
- Updated Project Brain with current TikTok Creator POC status and next actions.

## 0.0.1-phase0-lark-foundation
- Updated Project Brain after Lark Base foundation setup.
- Recorded Lark Base name: `Social MKT Data Hub`.
- Recorded imported `MKT_*` and `RAW_*` tables.
- Recorded sidebar folder organization and table icon setup.
- Recorded primary field fixes for main MKT tables.
- Recorded field type, select option, and view/icon setup completion.
- Updated next action to TikTok For Creator Native Integration POC.

## 0.0.0-phase0 — Initial foundation
- Created Project Brain structure.
- Created JavaScript monorepo skeleton.
- Added domain metric rules.
- Added D1 schema draft.
- Added baseline tests for metric calculations.
- Added platform decision notes for TikTok and Google Ads strategy.
