# Changelog

## 0.4.0-multi-channel-foundation — 2026-07-11

- Added a central Connector Catalog for TikTok, Facebook, Instagram, YouTube, WooCommerce, and Chatwoot.
- Added strict per-connector runtime feature flags with `active`/`planned` implementation states.
- Kept TikTok active while all unfinished connectors remain disabled and cannot be enabled accidentally.
- Added customer-specific connector profiles for developer-owned DEV resources and customer-owned Chemistry K Production resources.
- Added `TIKTOK_SOURCE_HANDLE` runtime override so the real account handle can change at deployment without editing source code, while the stable account key remains profile-owned.
- Added an Application-layer Connector Registry and safe readiness summary for Health/Admin use without exposing account identities or secrets.
- Centralized Queue job types and introduced Queue schema version 1 with backward compatibility for existing jobs.
- Registered future connector/report/reconciliation/notification jobs as planned; they now fail permanently before loading Lark infrastructure instead of returning fake success.
- Split Queue validation from Lark infrastructure creation so unknown, planned, or disabled jobs do not touch credentials or initialize clients.
- Updated DEV/Cloudflare examples, README, Project Brain, deployment rules, and multi-channel foundation documentation.
- Package verification target: 170/170 tests, 43 source files, 82 local dependencies, 0 cycles, and coverage 93.99% lines / 84.37% branches / 93.30% functions.
- No Facebook, Instagram, YouTube, WooCommerce, or Chatwoot API client/mapping is included in this release; those remain blocked until each Data Model/Lark Blueprint and source contract is approved.

## 0.3.1-codebase-audit-hardening — 2026-07-11

- Continued the full codebase audit with correctness, reliability, and performance prioritized before exhaustive line-by-line comments.
- Required TikTok Video ID at the source adapter boundary and added regression coverage for missing IDs.
- Rejected unsafe numeric TikTok IDs and count metrics that would lose JavaScript integer precision.
- Verified TikTok shareable/embed URL account and video identity against the RAW Video ID.
- Added destination conflict guards for account mismatches and legacy/stale Content/Daily stable keys.
- Improved Classification Dictionary decoding for comma-separated values inside structured Lark cells.
- Kept live-schema serialization, filtered destination lookup, pagination guards, token refresh, retry classification, and ambiguous Create retry protection in one production path.
- Updated current-state, production checklist, README, Project Brain, and the full audit report.
- Package verification target: 140/140 tests, syntax checks, architecture audit, coverage, secret scan, ZIP integrity, and extracted-package retest.
- Live DEV validation/write remains a post-install gate because release packaging has no access to the developer's Lark secrets.

## 0.3.0-codebase-audit-hardening — 2026-07-11

- Split sync into plan and execute phases so Content and Daily schema preflight complete before the first write.
- Added filtered stable-key lookup, guarded pagination, schema/token caching, request pacing, response-body timeout, and retry classification.
- Prevented ambiguous Batch Create retries after network/timeout/5xx failures.
- Added strict runtime customer profiles for developer-owned DEV resources and customer-owned Chemistry K Production resources.
- Added source-account validation, destination identity conflict checks, strict date/number/URL/select contracts, and queue permanent/transient error handling.
- Added architecture audit, release checklist, full codebase audit report, and expanded regression tests.

## 0.2.8-runtime-customer-profiles
- Added central runtime environment and customer-profile selection.
- Added a developer-owned `dev_ft_pumkin` profile and customer-owned `chemistry_k` production profile.
- Separated TikTok stable account key from the detected source handle.
- Removed direct TikTok account identity reads from scripts and worker business flow.
- Added Thai comments for customer configuration and production deployment behavior.
- Added fail-fast validation for invalid development/production profile pairings.
- Added production readiness checklist and runtime configuration regression tests.

## 0.2.7-live-contract-preflight

- Added shared Lark source-cell decoders for rich-text arrays, URL arrays, and numeric cells.
- Updated TikTok Creator mapping to match the real Lark Base cell shapes found in the current exported Base.
- Added the full native TikTok traffic-source field name used by the current Base.
- Converted `metric_date` to Asia/Bangkok midnight epoch milliseconds before Lark serialization.
- Prevented TikTok content URLs from being incorrectly copied into `cta_destination`.
- Added destination select-option validation before writes.
- Upgraded `validate:tiktok` to load the live destination schemas and serialize every Content and Daily row without writing.
- Added source-account integrity checks so RAW TikTok rows cannot be written under a different configured account key.
- Added regression coverage for real Lark rich-cell shapes, select options, schema preflight, and source-account mismatch.

## 0.2.6 - Lark URL source contract
- Fixed TikTok native source mapping for Lark Bitable URL fields returned as `{ link, text }`.
- URL source values are now validated and extracted before domain normalization; arbitrary objects are never coerced to `"[object Object]"`.
- Added regression coverage using the real structured Lark URL response shape.

## 0.2.5-canonical-datetime
- Fixed TikTok `published_at` handling when Lark returns epoch milliseconds or numeric epoch strings.
- Added one shared canonical date-time parser for adapters and Lark field serialization.
- Epoch seconds are normalized to milliseconds; ambiguous timezone-less strings now fail before writes.
- Added range validation and regression tests for real Lark/TikTok date shapes.

## 0.2.4-lark-pagination-guards — 2026-07-11
- Fixed the production infinite-pagination defect in Lark field and record reads.
- Pagination now continues only when Lark explicitly returns `has_more: true`; a stale `page_token` is ignored when `has_more` is false.
- Centralized field and record pagination in one guarded paginator instead of maintaining duplicate loops.
- Added fail-fast protection for missing next tokens, repeated tokens, and excessive page counts.
- Added pagination completion/failure tracing without exposing credentials.
- Added real-contract regression tests for single-page, multi-page, stale-token, repeated-token, missing-token, empty-intermediate-page, records, and maximum-page behavior.
- Full test suite passes 50/50 and static JavaScript syntax checks pass.

## v0.2.2 Lark sync observability and timeout
- Added per-request timeout with AbortController so stalled Lark requests cannot hang forever.
- Added stage progress logs for TikTok sync.
- Timeout errors include the Lark API path and configured timeout.
- v0.2.3: Added end-to-end sync tracing for schema loading, destination pagination, sync planning, batch writes, request attempts, retries, elapsed time, and timeout diagnosis.

## 0.2.1-lark-schema-preflight

- Added Lark table-field metadata loading and per-table schema caching.
- Added a shared typed field serializer before all Lark writes.
- URL fields are now written as Lark URL objects (`{ link, text }`) instead of raw strings.
- Empty optional fields are omitted rather than sent as invalid values.
- Added preflight rejection for missing destination fields, malformed URLs, invalid numbers, and invalid date values with table/key/field context.
- Updated the universal sync engine to compare and write the same serialized representation.
- Added regression coverage for URL serialization, schema caching, field metadata loading, and preflight failures.

## 0.2.0-core-sync-engine — 2026-07-10
- Replaced connector-owned Lark upsert behavior with a storage-neutral universal `TableSyncEngine`.
- Made `LarkRecordRepository` a thin I/O adapter with only list/create/update operations.
- Removed the unused per-row Lark record-search path.
- Added one-read in-memory indexing, input dedupe, destination duplicate detection, changed-field diffing, batch create/update, and unchanged-row skipping.
- Added global Lark request pacing in addition to bounded retry/backoff and tenant-token caching.
- Changed sync-worker queue processing from concurrent jobs to sequential jobs against one runtime to prevent cross-job API bursts.
- Migrated TikTok content sync and metric-definition seeding to the shared engine.
- Added architecture audit documentation and universal sync-engine regression tests.
- All 36 tests and syntax checks pass.

## 0.1.8-lark-rate-limit-resilience

- Fixed Lark Base `1254290 TooManyRequest` during TikTok write sync.
- Replaced per-row concurrent record searches with one paginated destination-table read and an in-memory key index.
- Made content and daily snapshot table sync sequential to avoid request bursts.
- Added exponential backoff with jitter for Lark `1254290`, HTTP 429, and temporary 5xx failures.
- Added tenant access-token caching and shared in-flight token requests.
- Added regression tests for retry behavior, token caching, local upsert indexing, and canonical TikTok keys.
- All 33 tests and static syntax checks pass.

## 0.1.7-tiktok-canonical-keys — 2026-07-10
- Changed TikTok `content_key` from `tiktok::account_id::video_id` to the canonical `tiktok:account_id:video_id` format.
- Changed TikTok `content_daily_key` to `tiktok:account_id:video_id:metric_date`.
- Kept report snapshot IDs on their existing `::` format because they are a separate key contract.
- Centralized key formatting in the existing identity-key builder and normalized surrounding whitespace.
- Updated unit, batch, Lark sync, snapshot, documentation, and PROJECT_BRAIN expectations.
- Rechecked the complete codebase before implementation; no duplicate TikTok identity-key builder was found.
- Packaging validation passed 31 tests and syntax checks; live Lark validation remains pending because the packaging environment could not resolve `open.larksuite.com`.

## v0.1.6-local-lark-run-tools

- Added local `.dev.vars` runner utilities for Lark live validation and write sync.
- Added `npm run validate:tiktok` for safe dry-run validation against the real Lark Base.
- Added guarded write commands: `CONFIRM_WRITE=YES npm run sync:tiktok` and `CONFIRM_WRITE=YES npm run seed:metrics`.
- Added `.dev.vars.example` with full table mapping placeholders and clarified that `TIKTOK_CREATOR_ACCOUNT_ID` is an internal account key.
- Added `.dev.vars` parser tests and kept write commands protected from accidental execution.
- Added mandatory full-codebase review policy before every new feature, fix, connector, refactor, or release.

## v0.1.5-lark-live-sync-validation

- Added a non-mutating `tiktok.creator.native.validate` queue job for first Lark live-sync validation.
- Added `validateLarkLiveSync` to read real RAW TikTok Creator + Classification Dictionary rows and normalize them without writes.
- Added dry-run support to `syncTikTokCreatorNativeToLark`.
- Added tests for validation, dry-run behavior, and queue job routing.
- Updated README and Project Brain for the live validation workflow.

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
