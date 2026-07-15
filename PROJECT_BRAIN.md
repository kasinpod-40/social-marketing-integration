# Project Brain — Social Marketing Data Integration

## Current baseline
This project connects social organic and paid ads data into Lark Base for reporting, daily snapshots, monitoring, and AI summaries. The implementation target is a lean MVP using Cloudflare Workers, Cloudflare D1, Cloudflare Queues, Lark Base, Lark Native Integrations where useful, and JavaScript.

## Current project status
Current audited release candidate: `v0.9.7-agent-workflow-foundation`

TikTok Organic DEV ingestion/report logic ผ่าน Live Queue UAT และ Reliability UAT แล้ว. Client Views ทั้ง 6 รายการติดตั้ง Filter/Hidden fields และ Sort `rank` ascending สำเร็จ; Advanced Permissions เปิดแล้วพร้อม `Client` role แบบ least privilege และ Final Preview เป็นศูนย์ actions/conflicts. Daily/Weekly schedules เปิดและ deploy ไปยัง Cloudflare DEV แล้ว; เหลือ operational observation ของรอบ schedule.



**v0.9.7-agent-workflow-foundation — เพิ่ม `AGENTS.md` และ `docs/current-task.md` เป็น Shared repository handoff ระหว่าง ChatGPT Work/Codex, บังคับ reading order, Data-model-first, Live API verification, Definition of Done และผล Implementation ที่ต้องบันทึกกลับเข้า Repository. Repository hygiene ตรวจสองไฟล์นี้เป็น Required artifacts.**

**v0.9.6-tiktok-organic-dev-complete — Clean handoff baseline หลัง TikTok Organic DEV implementation, Live UAT, Client Views, least-privilege permission, report schedules และ Cloudflare deployment ผ่านแล้ว. Release package ไม่มี Secret, local Wrangler config, macOS metadata หรือ build artifacts; operational observation ของรอบ Daily/Weekly ตามเวลาจริงไม่บล็อกช่องทางถัดไป.**

**v0.9.5-lark-view-live-verified — Root cause ที่ยืนยันแล้วคือ request ส่ง response-only fields และ encode Checkbox ผิดชนิด. PATCH ปัจจุบันส่งเฉพาะ `field_id`/`operator`/`value`, Checkbox เป็น `[true]`, และ verifier ใช้ Get View เพราะ List Views ไม่คืน Filter property. Live View ทั้ง 6 รายการตรง Contract แล้ว.**

**v0.9.0-tiktok-organic-dev-complete — ปิด TikTok Organic DEV logic และ Live UAT: Daily/Weekly reports, idempotency, partial baseline, stale-rank cleanup/restore และ report lock retry ผ่านแล้ว; เพิ่ม Client View installer, guarded schedule activator และ closeout runbook.**

Final operational activation on the developer machine:
- completed: guarded Client View Apply → Filter/Hidden fields → zero-action Preview
- completed: Lark UI Sort `rank` ascending ทั้ง 6 Views และ Advanced Permissions/Client role
- completed: guarded schedule activation and Cloudflare deployment
- ongoing observation: confirm naturally due Daily/Weekly report outputs; this is not a release blocker

Failure/partial-write semantics are covered by deterministic regression tests rather than destructive live corruption. Weekly complete baseline is an operational observation after enough snapshots accumulate, not a code-release blocker.

**v0.8.2-lark-number-formatter-fix — แก้ Number Field Create/Update ให้ใช้ formatter enum ของ Lark OpenAPI (`1,000`, `0.0000`) แทน spreadsheet pattern ที่ทำให้ `WrongRequestBody`; Report schedule ยังต้องคงปิดจนกว่า Apply, Seed และ Live UAT จะผ่าน.**

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

Completed Live Cloudflare DEV reliability UAT:
- Main Queue/Lark sync, idempotency และ Reconciliation ผ่าน
- D1 Distributed Lock collision/retry/cleanup ผ่าน
- Retry exhaustion -> DLQ -> D1/Lark System Alert ผ่าน
- Scheduled TikTok Sync ผ่านต่อเนื่อง 3 รอบโดยไม่เขียนซ้ำ

Completed TikTok Organic Report Live DEV UAT:
- Report schema clean rerun: zero create/update actions and zero conflicts.
- Metric seed: 68 created, rerun skipped 68; Report settings: 2 created, rerun skipped 2.
- Daily report: created 1 Snapshot / 13 Metrics / 5 Top Content; rerun created 0 and updated the same stable rows.
- Weekly report: same row counts; correctly marked `partial` because the comparison week predates available snapshots; rerun idempotent.
- Top Content limit 5 → 3 neutralized ranks 4–5 to `no_data`; restoring 5 repopulated them without duplicates.
- Manual report lock returned retryable `SYNC_LOCK_BUSY`; the same Queue message succeeded after lock release with created=0.
- See `docs/tiktok-organic-dev-closeout-v0.9.0.md`.

Completed in v0.9.0 closeout tooling:
- Lark View API list/create/patch adapters with pagination and request-contract tests.
- Idempotent Client Views for Daily/Weekly Metrics and Daily/Weekly Top Content.
- Read-only Preview and double-confirmed Apply safety shared across schema/view/schedule tools.
- Atomic local Wrangler config activation after validating DEV profile, setting keys/times and real report table IDs.
- `npm run test:report-reliability` focused regression gate.

Completed in v0.8.2 Number formatter fix:

- Report Schema Number fields use official Lark formatter enums instead of spreadsheet patterns.
- Shared Field contract normalizes legacy `#,##0` / `#,##0.0000` values before Create/Update.
- Every Number formatter in the five-table schema is regression-tested against an allowlist.
- The observed v0.8.1 Apply failed before any action (`appliedActionCount=0`), so v0.8.2 can be applied without rollback.

Completed in v0.8.1 schema installer safety fix:

- `npm run setup:report-schema` is always read-only; Apply requires the separate `CONFIRM_WRITE=YES npm run setup:report-schema:apply` command.
- Lark Field payloads use canonical OpenAPI property keys; Checkbox and other propertyless field types omit `property` entirely.
- Unsupported UI-only keys are filtered before Create/Update and schema failures expose the exact failed action plus prior applied-action count.
- A partially completed v0.8.0 installer run is resumed idempotently after Preview.

Completed in v0.8.0 schema installer:

- Five Report tables use one versioned 110-field contract.
- Missing tables/fields/options are created incrementally; existing schema is never deleted.
- Type conflicts and unresolved configured Table IDs fail closed.
- Created table IDs are returned as `environmentUpdates` for local Wrangler config.
- Existing Primary mismatches remain an explicit Lark UI review step.

Completed in v0.7.2 release correction:
- Daily/Weekly report `periodEnd` = previous completed local day derived at the scheduler producer.
- Month/year/leap-day boundaries are covered by regression tests.
- Clean release package excludes local Wrangler config and macOS metadata while retaining `.gitignore` / `.dev.vars.example`.
- Orphan Local mutation guard remediation is documented in `docs/local-file-lock-guard-runbook-v0.7.2.md`.

Completed in v0.7.1 reliability hardening code:
- First-write rejection remains `failed`; `partial_success` is used only when confirmed/unknown write progress exists.
- Scheduled TikTok jobs persist the local `metricDate`; report jobs persist the previous completed local day as `periodEnd`, both derived from `scheduledTime` for deterministic retries.
- Top Content resolves one bounded limit (1–100) for JSON and normalized rows and neutralizes stale ranks with `no_data`.
- Lease expiry fails closed, chunk guard failures preserve prior confirmed progress, and exhausted Lark 1254290 remains a retryable rejection instead of unknown write.
- Local file-lock mutation is serialized by an exclusive guard; tracked local deployment config now fails repository hygiene.
- DEV Wrangler example enables persisted Workers Logs/Traces; production sampling remains customer/environment configuration.


Completed in v0.7.0 report foundation code (retained in v0.7.2):
- Reviewed the latest `.base` export before implementation and documented the report schema contract.
- Added cumulative-delta Daily/Weekly TikTok report calculations, previous-period comparison, weighted watch/completion metrics, partial-baseline quality status, and negative correction handling.
- Added normalized Metric Values and fixed-rank Top Content outputs for client-facing views.
- Added customer-scoped report-setting seed, metric metadata seed, active report Queue jobs, reliability accounting, and timezone-aware schedule producers.
- Daily/Weekly schedule flags remain `false` until Lark fields/tables are created and Live DEV UAT passes.

Completed TikTok Incremental layer in v0.6.0:
- D1 `sync_cursors` และ `source_record_states` จาก migration `0003_incremental_sync.sql`
- Fingerprint RAW/Dictionary และเลือกเฉพาะ changed records เข้าสู่ Destination plan/write
- Safe Full fallback สำหรับ initial checkpoint, วันใหม่, Dictionary เปลี่ยน, Source deletion และรอบ 24 ชั่วโมง
- Checkpoint commit หลัง business writes สำเร็จ; cursor commit สุดท้ายเพื่อรองรับ Queue retry
- RAW traversal/normalization ยังครบทุกแถวเพื่อ Source identity และ deletion safety

Completed Reliability layer:
- ทุก TikTok write run มี `sync_run_id` และ lifecycle `running -> success|partial_success|failed|skipped`.
- `MKT_Sync_Log` และ `MKT_System_Alerts` ใช้ Schema จริงของ Dev Base โดยไม่เพิ่ม Field.
- D1 migration `0002_reliability.sql` เพิ่ม `sync_runs`, `sync_locks`, `dead_letter_jobs`, `system_alerts`.
- Cloudflare write job บังคับ D1 binding `MKT_STATE_DB`; Local ใช้ file lease lock ใน `.mkt-locks/`.
- Lock key = `customer_profile:platform:account_key:sync_type`; release ได้เฉพาะ owner เดิม.
- Prepare path ตรวจความไม่ครบคู่ของ Content/Daily และรอบถัดไปเติมเฉพาะ Stable key ที่ขาด.
- Daily write failure หลัง Content สำเร็จกลายเป็น retryable `SYNC_PARTIAL_WRITE`, บันทึก `partial_success` และ Critical alert.
- Queue หลักรองรับ `dead_letter_queue`; DLQ consumer Persist ลง D1, Mirror Alert ไป Lark เมื่อ config พร้อม และไม่ Execute งานเดิมซ้ำ.
- Permanent queue failure ถูกเก็บใน D1 และ Mirror Alert ไป Lark แบบ Best effort เมื่อ config พร้อม; secret-like keys ใน payload/details ถูก redact.

Completed in code:
- Added central Connector Catalog for TikTok, Facebook, Instagram, YouTube, WooCommerce, and Chatwoot.
- Added strict connector runtime flags and blocked all planned connectors from accidental activation.
- Added Customer-profile connector config for DEV and Chemistry K Production without storing secrets.
- Added Connector Registry and Queue Job Catalog/Schema version 1.
- Registered future connector/report/reconciliation/notification jobs as planned permanent failures, never fake success.
- Split Queue validation from Lark infrastructure creation so unsupported/disabled work does not touch credentials.
- Added `TIKTOK_SOURCE_HANDLE` environment override while keeping stable account keys in source-controlled profiles.
- Added robust TikTok For Creator native row mapper.
- Added TikTok Creator normalization use case from `RAW_TikTok_Creator_Videos` to `MKT_Content` and `MKT_Content_Daily`.
- Added TikTok Creator batch normalization use case with O(n) dedupe and skipped-row collection.
- Added Lark Bitable client, thin Lark repository adapter, and storage-neutral universal TableSyncEngine.
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
- `docs/multi-channel-foundation-v0.4.0.md` — Connector/Queue foundation and activation rules.
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
MKT_Sync_Log = tblpgnHODi8MIcso
MKT_System_Alerts = tbl5Cq9iVkWTFdA4
RAW_TikTok_Creator_Videos = tblMdO6XCti94EwH
```

## Next action
Apply and UAT TikTok Organic Report v0.7.0:
1. Import/update the Lark Report schema from the release Blueprint.
2. Configure IDs for `MKT_Report_Metric_Values` and `MKT_Report_Top_Content`.
3. Run metric/report-setting seed and validate idempotent rerun.
4. Send manual Daily and Weekly report jobs; verify snapshots, normalized metrics, Top Content, Sync Log, lock/retry behavior, and client views.
5. Enable report schedules only after Live DEV gate passes.
6. Then start Lark AI + Group Notification; Organic Facebook/Instagram/YouTube and Ads remain later roadmap items.

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

---

## Lark API Rate-Limit Policy (v0.1.8)

The production Lark Base adapter must not issue one search request per row during an upsert. It must read the destination table once, build a local stable-key index, and then use batch create/update operations. Connector table writes should run sequentially unless concurrency has been proven safe.

The Lark client must cache the tenant access token and retry transient failures with bounded exponential backoff and jitter. Retryable failures currently include Lark error `1254290 TooManyRequest`, HTTP 429, and temporary HTTP 5xx responses.

The TikTok sync sequence is: read raw/dictionary data concurrently, normalize locally, upsert `MKT_Content`, then upsert `MKT_Content_Daily`. This avoids concurrent search/write bursts against the same Base app.


---

## v0.2.0 — Core Sync Engine baseline

The project now follows **Core First, Feature Second**. Connector-specific code must fetch and normalize only; synchronization policy is owned by the shared core.

### Mandatory architecture

```text
Source Connector
  → Raw/Normalized Rows
  → TableSyncEngine
  → Storage Repository
  → Lark Bitable Client
```

Responsibilities:

- Connector adapter: fetch and source-field mapping.
- Application use case: orchestration and domain normalization.
- `TableSyncEngine`: stable-key dedupe, destination indexing, diff, unchanged skip, create/update plan, and duplicate-key integrity checks.
- `LarkRecordRepository`: thin list/create/update I/O adapter only.
- `LarkBitableClient`: auth token cache, request pacing, pagination, batch transport, retry/backoff, and HTTP/API error handling.

### Hard rules

1. No connector may implement its own upsert, retry, rate-limit, batch-write, or destination lookup logic.
2. No per-row destination API lookup is allowed for normal table sync.
3. A table sync must read once, index locally, diff locally, and batch writes.
4. Unchanged rows must be skipped and must not be rewritten.
5. Duplicate stable keys already present in a destination table are treated as a data-integrity error and must stop the write.
6. Queue jobs sharing the same Lark app runtime run sequentially unless measured evidence proves a higher concurrency safe.
7. Retry is a resilience layer, not a substitute for reducing request volume.
8. New Facebook, Instagram, YouTube, Chatwoot, and WooCommerce connectors must use this same engine.

### v0.2.0 audit result

- Removed the per-row Lark search path.
- Separated synchronization policy from Lark storage I/O.
- Added request pacing, changed-field diffing, duplicate detection, and unchanged-row skipping.
- Migrated TikTok and metric seeding to the shared engine.
- Automated validation: 36/36 tests passed and syntax checks passed.
- Full audit report: `docs/architecture-audit-v0.2.0.md`.

### Next action

Return to TikTok validation only after installing this baseline:

1. `npm install`
2. `npm run validate:tiktok`
3. `CONFIRM_WRITE=YES npm run sync:tiktok`
4. Run the same write command a second time.
5. Confirm the second run reports unchanged rows as `skipped`, with no duplicate records and no `1254290`.

---

## Lark Schema-Aware Write Contract (v0.2.1)

All writes to Lark Base must pass through the shared destination-schema preflight layer.

Required flow:

Connector normalized rows
→ Lark table field metadata
→ Shared typed field serializer
→ Preflight validation
→ Universal TableSyncEngine diff
→ Batch create/update

Rules:

1. Connectors must not format Lark-specific field payloads themselves.
2. The repository loads `/fields` metadata and caches it per table for the process lifetime.
3. URL fields are serialized as `{ link, text }`; raw URL strings must never be sent directly to a Lark URL field.
4. Empty optional values are omitted from write payloads.
5. Unknown destination fields and invalid typed values must fail before any write request.
6. Preflight errors must identify destination table, stable row key, and field name.
7. Diff comparison must use the same serialized representation that will be written to Lark.
8. Lark schema changes require updated tests and PROJECT_BRAIN review before sync.

This policy applies to TikTok, Facebook, Instagram, YouTube, Chatwoot, WooCommerce, and every future connector.


## v0.2.2 Lark sync observability and timeout
- Added per-request timeout with AbortController so stalled Lark requests cannot hang forever.
- Added stage progress logs for TikTok sync.
- Timeout errors include the Lark API path and configured timeout.
## Lark Sync Observability Rule
Every production sync must expose progress from use case → sync engine → repository/client. Logs must identify scope, table, operation, page/chunk, attempt, elapsed time, retry delay, and Lark status/code without exposing tokens or secrets. Silent network waits are not acceptable.

---

## Lark Pagination Contract (v0.2.4)

Every Lark collection read must use the shared guarded paginator. This applies to table fields, records, and any future paginated Lark collection endpoint.

Mandatory behavior:

1. Continue only when the response explicitly contains `has_more: true`.
2. Ignore `page_token` when `has_more` is false; Lark may return a stale token on the terminal page.
3. When `has_more` is true, require a non-empty next `page_token`.
4. Detect a repeated page token and stop before an unbounded request loop can continue.
5. Enforce a configurable maximum page count as a final safety boundary.
6. Empty pages are allowed only when `has_more` is true and the next token advances.
7. Fields and records must use the same shared pagination implementation; connector-specific pagination loops are prohibited.
8. Pagination logs must report resource, table, page, row count, total row count, completion, and guarded failure without exposing secrets.

Incident learned from TikTok production validation:

- Lark returned 29 fields on page 1, `has_more: false`, and a stale `page_token`.
- The previous implementation followed the token alone and repeatedly requested the same empty page hundreds of times.
- The defect caused unnecessary API traffic and could trigger rate limiting even though no write had started.
- The fixed contract treats `has_more` as authoritative and uses token checks only when another page is explicitly declared.

## Canonical date-time contract (v0.2.5)
- Normalized domain date-time values must be epoch milliseconds.
- Source adapters must convert epoch seconds, epoch milliseconds, numeric epoch strings, Date objects, and explicit-timezone ISO strings through the shared date-time parser.
- Ambiguous timezone-less strings are rejected rather than interpreted using the host machine timezone.
- Lark date fields are serialized from the same shared parser, so connectors may not implement their own date conversion logic.

## 0.2.6 - Lark URL source contract
- Fixed TikTok native source mapping for Lark Bitable URL fields returned as `{ link, text }`.
- URL source values are now validated and extracted before domain normalization; arbitrary objects are never coerced to `"[object Object]"`.
- Added regression coverage using the real structured Lark URL response shape.


---

## Live Contract Audit Rule (v0.2.7)

Before any connector is allowed to write, validation must exercise the same field serialization path as production using the live Lark destination schema. A normalization-only dry run is not sufficient.

Required checks:

- Decode actual Lark source cell shapes (rich text arrays, URL arrays, primitive numbers and epoch dates).
- Serialize every destination row against live field metadata.
- Validate URL, date, number, single-select and multi-select contracts.
- Validate that the source social account matches the configured account identity.
- Stop before writes when the source account is inconsistent, destination fields are missing, or select values are not configured.
- Reporting date values are stored as Asia/Bangkok midnight epoch milliseconds; identity keys continue to use `YYYY-MM-DD`.
- The original content URL is not a CTA destination. `cta_destination` may only come from an explicit URL in human-authored caption/title/campaign text.

Current Base audit observations (2026-07-11):

- RAW TikTok URL and text cells are returned as arrays of rich segments, not plain strings.
- The current RAW TikTok table contains URLs for handle `@ft.pumkin`; this must not be synced with `MKT_CUSTOMER_PROFILE=chemistry_k`.
- The Classification Dictionary contains `course_level` outputs `DEK73` and `ม.3`, while the current `MKT_Content.course_level` select options do not include those values. Add the options or disable/change the affected rules before content matching those rules is synced.

---

## Runtime Environment and Customer Profiles (v0.2.8)

### Ownership model

- `Social MKT Data Hub` ที่ใช้อยู่ปัจจุบันเป็น Lark Base สำหรับพัฒนาและทดสอบของผู้พัฒนา
- Development ใช้ทรัพยากรของผู้พัฒนา เช่น TikTok `@ft.pumkin`
- Production ของ Chemistry K ต้องติดตั้งในทรัพยากรที่ลูกค้าเป็นเจ้าของ ได้แก่ Lark Base, Lark App/Bot, API credentials, Cloud/Runtime, Chatwoot, WooCommerce และ Social assets
- ใช้ codebase เดียวกัน แต่เลือก environment/profile ผ่าน Environment Variables โดยไม่แก้ source code

### Runtime selector

Development:

```env
MKT_ENV=development
MKT_CUSTOMER_PROFILE=dev_ft_pumkin
```

Production:

```env
MKT_ENV=production
MKT_CUSTOMER_PROFILE=chemistry_k
```

ระบบต้อง fail-fast หาก environment และ profile ไม่ตรงคู่กัน

### TikTok identity contract

- `accountKey` ใช้สร้าง stable canonical key
- `sourceHandle` ใช้ตรวจว่าข้อมูล RAW มาจากบัญชีจริงที่ถูกต้อง
- Development: `accountKey=ft_pumkin`, `sourceHandle=ft.pumkin`
- Production Chemistry K: `accountKey=chemistry_k`, `sourceHandle=chemistry_k`
- ห้ามนำข้อมูลจาก `@ft.pumkin` ไปสร้าง key ภายใต้ `chemistry_k`

### Configuration rule

- Business logic และ Connector ห้ามอ่าน `process.env` โดยตรง
- Environment ถูกแปลงเป็น RuntimeConfig กลางก่อนส่งเข้า use case
- เก็บใน code ได้เฉพาะ non-secret profile, mapping, feature flags และ stable identifiers
- Token, Secret, API Key, Password และ credentials ต้องอยู่ใน Environment/Secret Manager เท่านั้น
- Customer profile ต้องมีคอมเมนต์ภาษาไทยอธิบาย ownership และ field สำคัญ


---

## Full Codebase Audit Baseline (v0.3.1)

- TikTok/Lark validation และ write ใช้ Prepare/Plan path เดียวกัน; Content และ Daily ต้องผ่าน Preflight ก่อน Write แรก
- Destination lookup ใช้ Filtered stable-key search; Paginator ตรวจ `has_more`, missing/repeated token และ max pages
- Batch Create ไม่ Retry เมื่อ Timeout/Network/5xx ให้ Job ใหม่ Re-plan จาก Stable Key เพื่อเลี่ยง Duplicate
- Source handle, account mismatch, legacy stable key, TikTok URL handle/video ID และ unsafe numeric ID ถูกตรวจแบบ Fail-fast
- DEV ใช้ Base/TikTok ของผู้พัฒนา (`dev_ft_pumkin`, `@ft.pumkin`); Production `chemistry_k` ใช้ทรัพยากรที่ลูกค้าเป็นเจ้าของ
- Residual risks: ไม่มี cross-table transaction/distributed lock, RAW/Dictionary ยัง full read, ยังไม่มี persisted sync run/DLQ และยังไม่เปิด Classification field clearing จนกว่าจะยืนยัน Lark Cell-clear contract
- รายงานเต็ม: `docs/full-codebase-audit-v0.3.1.md`


## 2026-07-11 — v0.5.0 Reliability Layer

- Baseline: `v0.5.0-reliability-layer`.
- No Lark Content/Daily schema changes. Existing `MKT_Sync_Log` 7 fields and `MKT_System_Alerts` 5 fields are used as user-facing mirrors.
- D1 is the operational source of truth for timestamps, detailed counts, retry metadata, lock leases, DLQ payloads and alert details.
- Automatic reconciliation is part of the normal TikTok sync path; a separate fake reconcile success is not used.
- Local and Cloud resources remain separate: Local file lock protects one machine only; Cloudflare D1 lock protects Worker invocations. Do not run Local write against the same Base while Cloud scheduled sync is enabled.
- Known residual risk: D1 lease has no renewal heartbeat yet; configure lease longer than the maximum expected sync duration.
- Full contract: `docs/reliability-layer-v0.5.0.md`.

## 2026-07-11 — v0.5.1 Cloudflare Deploy Hardening

- Wrangler Sync config ต้องอยู่ repository root หรืออ้าง path ตามตำแหน่ง config; baseline นี้ใช้ `wrangler.sync.example.jsonc` ที่ root.
- D1 เป็น operational primary: `saveSyncRun`, `saveSystemAlert`, `saveDeadLetter` ต้องสำเร็จก่อน Ack; Lark เป็น best-effort human-readable mirror เท่านั้น.
- Main Queue และ DLQ ใช้ exact-name whitelist; Queue ที่ไม่รู้จักต้อง quarantine และห้าม execute งาน.
- Scheduled handler เป็น Producer ส่ง `tiktok.creator.native.sync` เข้า Main Queue ไม่ทำ Sync ตรงใน Cron.
- Lease lock ต้อง renew ก่อนหมดอายุและ Use case ต้องตรวจ ownership ก่อนทุก write chunk; lost ownership เป็น retryable failure.
- Lark batch adapter ต้องรายงาน confirmed rows/chunks เมื่อเกิด partial/unknown write และ Reliability status ต้องเป็น `partial_success` พร้อม Critical alert.
- Source identity mismatch ต้อง fail fast ก่อน Destination schema/search.
- CI/Release gate บังคับ Node unit tests, Workers-runtime tests, `npm run check`, `npm run deploy:dry-run`, migration replay และ extracted ZIP retest.
- Production secrets ห้ามอยู่ใน code/config example; DEV ใช้ทรัพยากรผู้พัฒนา ส่วน Production ใช้ Lark/Cloudflare/App/Credentials ที่ลูกค้าเป็นเจ้าของ.
