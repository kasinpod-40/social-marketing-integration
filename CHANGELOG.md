
## v0.1.5-lark-live-sync-validation

- Added a non-mutating `tiktok.creator.native.validate` queue job for first Lark live-sync validation.
- Added `validateLarkLiveSync` to read real RAW TikTok Creator + Classification Dictionary rows and normalize them without writes.
- Added dry-run support to `syncTikTokCreatorNativeToLark`.
- Added tests for validation, dry-run behavior, and queue job routing.
- Updated README and Project Brain for the live validation workflow.

# Changelog

## 0.1.4-env-config-lark-dictionary
- Removed real Lark table IDs from source code and made table mapping env-driven.
- Added `LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY` support.
- Added Lark classification dictionary mapper that handles text, select-like, and multi-select-like field shapes.
- Updated TikTok Creator sync to load dictionary rules from Lark before normalization.
- Replaced hardcoded Chemistry K course/content rules in core classifier with client-editable dictionary rules.
- Added manual-review fallback for unmatched content instead of guessing business-specific fields.
- Added tests for env-driven table config, dictionary mapping, dictionary-based classification, and TikTok sync orchestration.


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

## v0.1.6-local-lark-run-tools

- Added local `.dev.vars` runner utilities for Lark live validation and write sync.
- Added `npm run validate:tiktok` for safe dry-run validation against the real Lark Base.
- Added guarded write commands: `CONFIRM_WRITE=YES npm run sync:tiktok` and `CONFIRM_WRITE=YES npm run seed:metrics`.
- Added `.dev.vars.example` with full table mapping placeholders and clarified that `TIKTOK_CREATOR_ACCOUNT_ID` is an internal account key.
- Added `.dev.vars` parser tests and kept write commands protected from accidental execution.
- Added mandatory full-codebase review policy before every new feature, fix, connector, refactor, or release.

## 0.1.7-tiktok-canonical-keys — 2026-07-10
- Changed TikTok `content_key` from `tiktok::account_id::video_id` to the canonical `tiktok:account_id:video_id` format.
- Changed TikTok `content_daily_key` to `tiktok:account_id:video_id:metric_date`.
- Kept report snapshot IDs on their existing `::` format because they are a separate key contract.
- Centralized key formatting in the existing identity-key builder and normalized surrounding whitespace.
- Updated unit, batch, Lark sync, snapshot, documentation, and PROJECT_BRAIN expectations.
- Rechecked the complete codebase before implementation; no duplicate TikTok identity-key builder was found.
- Packaging validation passed 31 tests and syntax checks; live Lark validation remains pending because the packaging environment could not resolve `open.larksuite.com`.
