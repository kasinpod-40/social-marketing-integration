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
- `content_key` is generated from `platform:account_id:external_content_id`.
- `content_daily_key` is generated from `platform:account_id:external_content_id:metric_date`.
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


## v0.1.5 — Lark live sync validation

The next release adds a safe pre-write validation path for the first real Lark integration test. The new `tiktok.creator.native.validate` queue job reads real Lark tables, loads `MKT_Classification_Dictionary`, normalizes TikTok Creator rows in memory, and logs row counts, skipped rows, sample keys, and warnings without writing to `MKT_Content` or `MKT_Content_Daily`. The actual sync use case also supports `dryRun: true`.

This keeps the first live test safe: validate field/table/env mapping first, then run the write job only after the dry-run result is clean.

## v0.1.6 Local Lark run tools

Decision: because this project is deployed one Cloudflare project per client, table IDs remain environment-driven and no D1 tenant config is needed. To make first live validation easier before Cloudflare deploy/queue wiring, local Node runner scripts now read `.dev.vars` and call the same application use cases used by Workers.

Added commands:
- `npm run validate:tiktok`: reads real RAW TikTok Creator and dictionary tables, normalizes in memory, does not write.
- `CONFIRM_WRITE=YES npm run sync:tiktok`: writes/upserts into `MKT_Content` and `MKT_Content_Daily`.
- `CONFIRM_WRITE=YES npm run seed:metrics`: writes metric definition seed rows.

Safety: write scripts refuse to run unless `CONFIRM_WRITE=YES` is set. `.dev.vars` is intentionally local-only and must not be committed. `.dev.vars.example` is included for setup.


---

# Update: MKT Architecture (2026-07)

## Customer
- Chemistry K
- Online chemistry courses
- WooCommerce commerce
- Chatwoot conversations

## Integration Scope
### Social
- TikTok
- Facebook
- Instagram
- YouTube

### Chatwoot
- Conversations
- Messages
- Contacts
- Agents
- Inbox
- Labels

### WooCommerce
- Orders
- Order Items
- Products
- Customers
- Coupons
- Refunds

## Flow
Social + Chatwoot + WooCommerce
→ Connectors
→ Raw Data
→ Normalization
→ Master Tables
→ Daily Snapshot
→ Dashboard
→ AI Analysis
→ Lark Group Notification

## AI
MKT:
- Collect
- Normalize
- Calculate metrics
- Daily Snapshot
- Rule alerts

Lark AI:
- Summary
- Insight
- Recommendation
- Alert explanation

Lark Bot:
- Notify Lark Group
- Log notification

---

## Codebase Review Policy

Before starting any new feature, bug fix, connector, refactor, or release, the complete current codebase must be reviewed first.

The review must check for:

- Duplicate business logic, duplicated helpers, and duplicated API mapping
- Dead code, unused imports, unused files, obsolete scripts, and stale configuration
- Code that should be moved into shared helpers, services, adapters, or domain modules
- Poor architecture, excessive coupling, hardcoded values, and fragile implementation patterns
- Performance issues, unnecessary loops, repeated API calls, avoidable database or Lark requests, and inefficient memory usage
- Idempotency, retry, pagination, rate-limit handling, logging, error handling, and recovery behavior
- Regression risks across TikTok, Facebook, Instagram, YouTube, Chatwoot, WooCommerce, Lark Base, AI analysis, dashboards, snapshots, and notifications
- Test quality, missing edge cases, validation coverage, and whether the current implementation remains production-ready

Rules:

1. Do not blindly add new code on top of existing code.
2. Reuse existing production-quality logic where appropriate.
3. Refactor shared behavior instead of creating parallel or duplicated implementations.
4. Remove code waste and obsolete code when it is safe to do so.
5. If existing code is weak, unsafe, slow, or difficult to maintain, improve it before or together with the new work.
6. Avoid unnecessary large refactors that increase risk without clear value.
7. After changes, run relevant validation, unit tests, regression tests, static checks, and production build or dry-run checks.
8. Update PROJECT_BRAIN and CHANGELOG whenever architecture, flow, contracts, or development rules change.

Standard workflow:

Codebase audit
→ Architecture and code-health assessment
→ Reuse / refactor / cleanup plan
→ Implementation
→ Validation and regression checks
→ Performance and reliability re-check
→ PROJECT_BRAIN and CHANGELOG update

---

## 2026-07-10 — v0.1.7 TikTok canonical keys and current Lark Base baseline

TikTok identity keys now use a single colon delimiter:

- `content_key = platform:account_id:external_content_id`
- `content_daily_key = platform:account_id:external_content_id:metric_date`

For Chemistry K, examples are:

- `tiktok:chemistry_k:video_id`
- `tiktok:chemistry_k:video_id:2026-07-10`

The key format is owned by the shared builder in `create-daily-snapshot.js`; connectors and tests must not rebuild this contract independently. Report IDs retain their existing double-colon delimiter because they are a separate contract.

Current Lark Base source of truth supplied by the customer:

- Base name: `Social MKT Data Hub`
- Base revision: `9`
- Timezone: `Asia/Bangkok`
- Current tables: 21
- Current domains: social organic, ads, reports, AI report runs, classification dictionary, sync logs, and system alerts
- Chatwoot and WooCommerce tables are approved scope but have not yet been added to the current Base schema.

Before the next connector is implemented, code, PROJECT_BRAIN, and the latest exported Lark Base must be checked together.

### Validation status for v0.1.7

- Full automated test suite: passed, 31/31 tests.
- JavaScript syntax/static check: passed.
- Repository-wide search confirmed no remaining old TikTok content-key expectations; remaining `::` usage belongs only to the separate report ID contract and migration note.
- Live `validate:tiktok` and real Lark sync were not completed in the packaging environment because outbound DNS/network access to `open.larksuite.com` was unavailable.
- Next action on a network-enabled development machine: run `npm run validate:tiktok`, inspect sample keys, then run `CONFIRM_WRITE=YES npm run sync:tiktok` and verify idempotent second-run updates in Lark Base.
