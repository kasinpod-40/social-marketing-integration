# 00 — Current State

## Current release candidate

Official baseline: `v0.10.2-multi-channel-foundation-approved`

Clean candidate: `v0.11.0` — YouTube Organic DEV active, deployed, and smoke-tested

Working delta: YouTube large-account release blocker สำหรับ 837 videos เพิ่ม durable D1 page/chunk resume และ exact Analytics completeness. Commit `44377ce`, migration 0004, DEV deploy และ smoke ผ่านแล้วกับ DEV channel 2 videos; Customer 837-video Live UAT ยังไม่รันและยังเป็น Production release blocker.

## Multi-channel foundation

- YouTube Organic source contract, RAW Lark Blueprint, client, adapter, normalization and destination path are active in the verified DEV environment.
- TikTok and YouTube now share Canonical Organic identities/rows/batch/destination planning while platform parsing and identity contracts remain separate.
- Meta Graph transport, WooCommerce/Chatwoot sanitized contracts and Canonical Ads v2 are present as `planned` foundations without Worker routes.
- v0.10.1 removes unsupported `maxResults` from `videos.list(id)`, treats quota exhaustion as terminal alert, separates Ad from reusable Creative and makes integer micros the Ads money source of truth.
- The Excel/Lark model `../Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx` passed Technical review and is the approved implementation contract.
- YouTube contract `youtube-organic-v2` uses latest-state Channel/Video RAW rows, non-destructive Video reconciliation, exact Pacific `source_metric_date`, and RAW-only Owner Analytics in Phase 1.
- Public/Owner YouTube preflight, three-table Lark Apply และ Manual Queue core UAT ผ่านใน DEV เมื่อ 2026-07-17. First Full สร้าง 8 แถวจาก 3 source records; Full rerun และ incremental สร้าง 0 แถวใหม่; Owner Analytics คืน valid no-data. Lark มี Channel 1, Video 2, Analytics 0, Account 1, Content 2 และ Daily 2 โดยไม่เกิด Duplicate.
- DateTime audit fields ทั้ง 6 แสดง `yyyy/MM/dd HH:mm`; Final Schema Preview เป็น zero drift และ Advanced Permissions role `Client` เป็น `No access` สำหรับ YouTube RAW ทั้ง 3 ตาราง
- Reliability live fault ผ่าน lock collision → retry → success และ controlled timeout → retry exhaustion → DLQ → D1/Lark Critical Alert; หลัง Restore healthy run สำเร็จ retry 0, lock ค้าง 0 และ Test incident ถูกเก็บเป็น `resolved`
- Live OAuth read-only identity fault พบและแก้ missing Operational classification เป็น Permanent `YOUTUBE_CHANNEL_IDENTITY_MISMATCH`; missing/quota/rate-limit/lease/persistence contracts ผ่าน deterministic production-path tests
- DEV Worker version `f46c0c7f-0119-4f78-8e8d-2d37e17823a5` เปิด normal YouTube, Owner Analytics และ dedicated Cron แล้ว; Data API รันทุก 6 ชั่วโมง ส่วน Analytics รันวันละครั้งพร้อม 7-day completed-Pacific overlap.
- Active Data API และ Owner Analytics smoke tests ใช้ `sync_type=organic_sync` และผ่านแบบ success/retry 0; Analytics สร้าง RAW fact จริง 1 แถว, active cursor 1, source states 2, active lock 0 และ open YouTube alert 0. Production ยังคงปิด.
- Large-account patch แยก Content recent 100 จาก Analytics tracked 837, เดิน Full 17 pages, query Analytics 17 chunks, resume page/chunk ด้วย `sync_work_*`, ตรวจ exact queried-ID set และเก็บ completeness counters ใน D1 Sync Log details.
- DEV patch Worker `2037232c-152a-4e26-95fa-fca044f65bd9` ผ่าน Full/Incremental/Analytics success/retry 0; Analytics 2/2/2 complete, work staging/lock/open alert 0 และ Lark duplicate Stable key 0. ปริมาณ 2 เป็น DEV smoke ไม่ใช่ Customer 837 Live UAT.

## Shared Work/Codex handoff

- `AGENTS.md` is the repository-wide operating contract for ChatGPT Work, Codex, and developers.
- `docs/current-task.md` is the single active task handoff with status, scope, contracts, acceptance criteria, implementation result, and Work review.
- Repository hygiene now requires both files, so a release cannot silently lose shared context.
- The approved six-part foundation is implemented; `docs/current-task.md` records the results, Activation review และ non-destructive operational monitoring ที่เหลือ.

## TikTok Organic DEV status

The TikTok Organic DEV pipeline and Report Engine are feature-complete and live-UAT proven:

- TikTok Creator ingestion → `MKT_Content` + cumulative `MKT_Content_Daily`
- Canonical keys, idempotency, reconciliation, D1 lock, retry/DLQ/System Alerts
- Scheduled + incremental sync and 24-hour full reconciliation
- Five-table Report schema, 68 metric definitions, 2 report settings
- Daily/Weekly report generation, fixed-rank Top Content, data-quality status, deterministic completed-period dates
- Daily/Weekly idempotency, partial-baseline behavior, stale-rank cleanup/restore, and report lock collision/retry
- First-write failure versus partial-write behavior covered by deterministic regression tests

Canonical closeout: `../tiktok-organic-dev-complete-v0.9.6.md`; detailed earlier UAT evidence: `../tiktok-organic-dev-closeout-v0.9.0.md`

## Verification

- Node unit/integration: 312/312
- Workers runtime: 6/6
- Focused Report reliability: 51/51
- Architecture: 77 source files / 168 local dependencies / 0 cycles
- Repository hygiene and npm audit 0 passed
- Wrangler 4.110.0 dry-run/deploy: 363.52 KiB / gzip 74.69 KiB; Worker startup 1 ms
- v0.9.6 clean-tree gate: `npm ci`, check/hygiene, unit 312/312, Workers 6/6, Report reliability 51/51, focused View/client 53/53, offline npm audit 0, and Wrangler dry-run 363.52 KiB / gzip 74.69 KiB.
- v0.9.7 workflow gate: unit 312/312, Workers 6/6, Report reliability 51/51, focused View/Lark/build 56/56, Architecture 77/168/0, hygiene pass, npm audit 0, and the same Wrangler bundle because runtime behavior is unchanged.
- v0.10.0 foundation gate: unit 336/336, Workers 6/6, Report reliability 51/51, Architecture 94/189/0, hygiene pass, offline npm audit 0, and Wrangler dry-run 373.71 KiB / gzip 76.31 KiB.
- v0.10.1 reviewed gate after clean `npm ci`: unit 340/340, Workers 6/6, Report reliability 51/51, Architecture 94/189/0, hygiene pass, offline npm audit 0, workbook 8-sheet visual/formula/integrity verification, and Wrangler dry-run 373.74 KiB / gzip 76.31 KiB.
- v0.10.2-rc.2 source gate: unit 351/351, Workers 6/6, Report reliability 51/51, Architecture 99/195/0, hygiene pass, offline npm audit 0, Workbook/source parity + 10-sheet visual/formula QA, and Wrangler dry-run 373.74 KiB / gzip 76.31 KiB.
- v0.11.0-rc.1 hardened source gate: unit 376/376, Workers 6/6, Report reliability 53/53, focused YouTube/Reliability/Redaction 37/37, Architecture 109/230/0, hygiene pass, offline npm audit 0, and Wrangler dry-run 443.78 KiB / gzip 90.89 KiB.
- YouTube Lark presentation correction gate: focused schema/installer/client 53/53, full unit 377/377, Workers 6/6, Report reliability 53/53, Architecture 109/230/0, hygiene pass, offline audit 0, Wrangler dry-run 444.06 KiB / gzip 90.94 KiB, and Live Preview zero drift.
- YouTube Manual Queue core UAT: First Full, idempotent Full rerun, checkpoint-driven incremental และ Owner Analytics no-data ผ่าน; Lark record counts คงที่หลัง rerun, D1 cursor/source state พร้อม และไม่มี failed/partial/alert.
- YouTube Reliability continuation: DateTime/permission/live lock/DLQ/Alert/identity tests ผ่าน; focused non-destructive fault suite 34/34, Unit 377/377, Workers 6/6, Report reliability 53/53, Architecture 109/231/0, hygiene, audit 0 และ dry-run 444.25/90.99 KiB ผ่าน
- YouTube v0.11.0 activation gate: Unit 384/384, Workers 7/7, Report reliability 58/58, Architecture 109/230/0, hygiene and Wrangler dry-run 444.70/91.23 KiB passed; Lark Preview remained zero drift and active Data API smoke test succeeded.
- Fresh release extraction repeated `npm ci`, check, Unit 376/376, Workers 6/6, Report reliability 53/53, audit 0 and dry-run; the archive verifier found zero blocked, missing, sensitive or duplicate artifacts.
- YouTube Blueprint rc.2 parity is part of the 351/351 gate and verifies all 42 field metadata rows, query/date/missing semantics and field-by-field mapping.

## v0.9.6 closeout baseline

- v0.9.6 packages the live-verified implementation as the clean handoff baseline; it contains no local Wrangler config, secrets, macOS metadata, dependencies, or build artifacts.
- `setup:report-views` installs six managed client-facing Views.
- Live v0.9.0–v0.9.4 attempts failed with generic `1254001`; earlier root-cause claims were hypotheses, not confirmed facts.
- v0.9.5 sends only request fields (`field_id`, `operator`, `value`) and preserves Checkbox values as JSON booleans such as `[true]`.
- The verifier hydrates each managed View through Get View because this tenant's List Views response omits `property`.
- Existing View updates omit `view_name`; Filter and Hidden fields are applied in separate requests.
- Preview compares Filter and Hidden-field state, remains read-only, never deletes Views/records, and safely resumes if Create succeeds before a later mutation fails.
- View OpenAPI has no Sort mutation contract, so the six `rank` sorts and Advanced Permission were completed and verified in Lark UI.
- `enable:tiktok-report-schedules` validates and atomically enables Daily/Weekly report flags in local `wrangler.sync.jsonc`.
- Both tools require explicit Apply command plus `CONFIRM_WRITE=YES` for mutation.

## Live activation status

Client View Apply is complete: all six Views exist, Get View confirms their Filters/Hidden fields, each View uses `rank` ascending with Automatic sorting, and Final Preview reports zero actions/conflicts. Advanced Permissions is enabled with a saved `Client` role: report outputs are View only while Daily, AI technical, Sync/System, and RAW tables are No access. No DEV member is assigned to the role. Schedule flags are enabled and Worker version `ba6f3968-628c-4c61-b7eb-62647b38f547` is deployed. Remaining operational activation is:

1. The first post-deploy cron completed `success` at 22:01 Asia/Bangkok (`skipped=40`, no error). Observe the naturally due Daily/Weekly outputs at their configured times as ongoing operations.

These are deployment/observation steps, not unfinished connector logic.

## Client-facing rule

Clients should not use RAW tables, `MKT_Content_Daily`, Sync Log, System Alerts, cursor, lock, or technical IDs as normal working views. Client roles use the six managed Report Views. Production permissions belong to the customer's Lark organization.

## Next implementation workstream

YouTube Organic large-account patch active ใน DEV และ smoke ผ่าน แต่ต้องทำ Customer-owned 837-video Live UAT ก่อน Production release. Meta/WooCommerce/Chatwoot/Ads ยังเป็น workstream ถัดไปและต้องผ่าน Data-model/Access/UAT แยก. See `10-next-actions.md`.
