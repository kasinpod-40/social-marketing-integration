# Current State

## Baseline
`v0.1.4-env-config-lark-dictionary`

## Completed
- Lark Base `Social MKT Data Hub` is created.
- Main `MKT_*` tables are imported.
- Raw `RAW_*` native integration tables are imported.
- Sidebar folders, table icons, primary fields, field types, select options, and views with icons are configured.
- Git baseline for Lark foundation is pushed.
- TikTok For Creator native POC is confirmed for MVP usage.
- Lark Native Integration creates a sync-managed table and can be renamed/moved to `RAW_TikTok_Creator_Videos` without breaking sync.
- TikTok For Creator native sync updates existing records and does not create duplicates.
- Initial POC synced 20/21 TikTok videos; the missing video had removed audio, so the omission is treated as eligibility/content availability rather than a confirmed pagination limit.

## Completed in code
- TikTok Creator native row mapper.
- TikTok Creator single-row normalization to `MKT_Content` and `MKT_Content_Daily`.
- TikTok Creator batch normalization with O(n) dedupe and skipped-row isolation.
- Lark Bitable client for tenant token, paginated record read, key search, batch create, and batch update.
- Lark record repository with stable-key upsert, O(n) input dedupe, bounded-concurrency search, and create/update split.
- TikTok Creator Lark sync use case:
  - read `RAW_TikTok_Creator_Videos`
  - normalize rows
  - upsert `MKT_Content`
  - upsert `MKT_Content_Daily`
- `sync-worker` queue job type `tiktok.creator.native.sync` wired to the use case.
- Tests cover metric parsing, Lark field aliases, invalid row isolation, batch dedupe, Lark repository upsert behavior, and TikTok Creator sync orchestration.

## Current status
The TikTok Creator flow is ready for live read/write validation with real Lark table IDs.

## Next
1. Fill Lark table IDs and TikTok account ID in environment variables.
2. Trigger `tiktok.creator.native.sync`.
3. Confirm rows in `MKT_Content` and `MKT_Content_Daily`.
4. Run the job twice to confirm update-in-place behavior for normalized tables.
5. Add `MKT_Sync_Log` write after live validation.


## 2026-07-08 — v0.1.3 Canva report model support
- Lark Base Canva-ready table structure was confirmed.
- Added latest Lark table IDs into code config.
- Added rule-based content classification fields for course/theme/funnel/CTA reporting.
- Added metric-definition seed rows for organic and ads metrics.
- Added report snapshot row builder for computed Canva-style payloads.
- Tests and syntax checks pass.


## 2026-07-09 — v0.1.4 env-driven config + Lark classification dictionary
- Added `📚 MKT_Classification_Dictionary` in Lark Base and confirmed table ID `tblatpDOU6Qqh7Dv`.
- Moved Lark table ID resolution to env-only config; no real table IDs remain hardcoded in source code.
- Added `LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY` env key.
- TikTok Creator sync now reads dictionary rules from Lark before normalizing rows.
- Removed Chemistry K-specific hardcoded course rules from the core classifier.
- Classification now uses client-editable dictionary rows and falls back to `manual_review` note with low confidence when no rule matches.
- Local tests pass: 25 tests.
- Syntax check passes for apps/packages/tests.


### v0.1.5-lark-live-sync-validation

Added a dry-run validation queue job before the first real Lark write. Use `tiktok.creator.native.validate` to confirm env/table mapping, dictionary rules, normalization output, skipped rows, and sample keys before running `tiktok.creator.native.sync`.
