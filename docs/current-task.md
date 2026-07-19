# Current Task — YouTube Organic large-account release blocker v0.11.0

## Task metadata

- **Status:** `source_fix_verified_pending_guarded_migration_and_dev_redeploy`
- **Official clean baseline:** `v0.10.2-multi-channel-foundation-approved`
- **Working candidate:** `v0.11.0 + outbox-dispatch/redrive/quiesced-migration corrective patch`
- **Blueprint:** `Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx`
- **Connector status:** `active`
- **Schedule:** `enabled_in_prior_verified_dev_deployment_source_patch_not_deployed`
- **Last updated:** `2026-07-19`
- **Owners:** ChatGPT Work (technical review/release) + developer (DEV credentials and guarded live execution)

## Objective

ปิด YouTube Organic DEV ให้ครบตั้งแต่ Schema/Access/Queue/Reliability UAT จนถึง Active connector, scheduled sync, Owner Analytics policy, Cloudflare deployment และ post-deploy smoke test โดยยังไม่เปิด Production พร้อมแก้ post-activation review ของ commit `324c9d4f6798f0c59b2e8d51f9ccad1050c8cf5b`. ข้อมูลจริงของลูกค้ามี YouTube 837 วิดีโอ จึงยกระดับ Analytics scope, Full backfill, durable page/chunk resume และ completeness accounting เป็น Release blocker ไม่ใช่ Edge case.

## Authorized continuation scope — 2026-07-17

ผู้ใช้อนุมัติให้ปิดช่องว่างหลัง Core Queue UAT ตามลำดับนี้:

1. เปลี่ยน DateTime presentation ของ `fetched_at`, `published_at`, `last_seen_at` และ `missing_since` ให้แสดงวันและเวลา โดยใช้ formatter ที่ยืนยันจาก Live tenant
2. Preview/Apply Schema แบบ Idempotent และตรวจ Property จาก Lark OpenAPI หลัง Apply
3. เพิ่ม YouTube RAW ทั้ง 3 ตารางใน Advanced Permission role `Client` เป็น `No access` และตรวจจาก Lark UI
4. ทำ Reliability fault UAT: Missing Video, identity mismatch, quota/rate-limit, lock collision/renewal, retry exhaustion, DLQ และ alert persistence
5. คง normal connector, Owner Analytics หลัง UAT และ YouTube Schedule เป็น `false` จนทุก Gate ผ่าน

Acceptance criteria ของ continuation:

- Source contract และ Regression tests บังคับ DateTime audit fields เป็น `yyyy/MM/dd HH:mm` พร้อม `auto_fill=false`
- Final Schema Preview หลัง Apply เป็น zero drift
- Client role มองไม่เห็น YouTube RAW ทั้ง 3 ตาราง
- Fault UAT มีหลักฐาน safe counts/status/error classification โดยไม่เปิดเผย External identity หรือ Secret
- ทุกครั้งที่จำลอง Error ต้องคืนค่า DEV Worker/Queue/D1/Lark สู่ safe state และห้ามเปิด YouTube Schedule

## Approved contracts

- RAW latest-state: `RAW_YouTube_Channels`, `RAW_YouTube_Videos`
- Owner Analytics period facts: `RAW_YouTube_Analytics_Daily` แบบ RAW-only ใน Phase 1
- Channel → `MKT_Accounts`
- Video current state → `MKT_Content`
- Data API cumulative snapshot → `MKT_Content_Daily`
- Stable key/date/null/reconciliation contracts ยึด Blueprint v0.10.2
- Missing/private/deleted candidate ต้อง retain row/metrics, ไม่ลบและไม่เติมศูนย์
- Analytics ใช้ exact Pacific `source_metric_date`, `sort=day,video`, bounded batching/pagination

## Large-account contract — Release blocker

ปริมาณจริงที่ใช้ตัดสิน Architecture:

- YouTube: 837 videos
- Instagram: 1,941 posts
- TikTok: หลายร้อย videos
- Facebook: หลายร้อยถึงหลายพัน posts

YouTube ใน Commit นี้ต้องเป็นไปตาม Contract ต่อไปนี้:

1. Initial/Periodic Full เดิน uploads playlist จนจบทุกหน้า; `YOUTUBE_MAX_PAGES` เป็น fail-closed guard ไม่ใช่ silent truncation
2. Daily Content incremental จำกัด recent window ได้ แต่ Owner Analytics ใช้ tracked inventory จาก D1 checkpoint รวมกับ Content inventory รอบปัจจุบัน
3. Source page, Video resource chunk และ Analytics page/chunk เก็บ progress ใน D1 `sync_work_*` แบบ durable; Queue retry ใช้ message ID เดิมและ resume โดยไม่ย้อนทำ unit ที่ commit แล้ว
4. `sync_work_*` เป็น staging เท่านั้นและห้ามแทน Business checkpoint; `source_record_states`/`sync_cursors` ยัง commit หลัง Lark business writes สำเร็จครบ
5. Analytics เก็บ queried-video markers แยกจากจำนวน rows เพราะ API สามารถคืน valid no-data; ก่อน Plan Lark ต้องเทียบ expected tracked IDs กับ queried IDs แบบ exact set
6. Missing scope, repeated cursor, max-page overflow, duplicate Analytics stable row หรือ progress mismatch ต้อง fail-closed และห้ามรายงาน complete success
7. Sync result และ D1 Sync Log details ต้องมี total tracked, selected, successfully queried, skipped/failed, pages/chunks และ completeness status
8. Stable keys, plan-all-tables-before-write, Account-last, checkpoint-after-write, Lock/Retry/DLQ/System Alert และ Release examples ที่ปิดทุก flag ต้องคงเดิม

Shared contract สำหรับ Instagram/Facebook/TikTok งานถัดไป:

- Initial full backfill แบบ paginated และมี persisted cursor/checkpoint
- Incremental sync + periodic full reconciliation
- Bounded page/chunk processing และ durable resume หลัง partial failure
- Stable-key idempotency, rate-limit-aware retry/backoff และ completeness counters
- ห้าม silent hard limit; safety limit ต้อง fail-closed พร้อม operational code/count
- อ่าน staged units แบบ page-by-page และไม่เก็บ Source page envelopes ทุกหน้าใน memory พร้อมกัน
- ต้องมี large-account fixture ตามปริมาณจริงก่อน Activation
- ใช้ shared `sync_work_*`/Sync Engine contracts; ห้ามสร้าง retry/upsert/pagination state machine ซ้ำในแต่ละ Connector

## Implemented in the current candidate

1. YouTube Organic connector/job เป็น `active` และใช้ normal runtime gate `MKT_CONNECTOR_YOUTUBE_ENABLED`; UAT-only gate/route เดิมเป็นประวัติและไม่ใช่ Current contract
2. Data API schedule ใช้ dedicated Cron ทุก 6 ชั่วโมง; Owner Analytics ทำงานวันละครั้งเวลา 07:50 Asia/Bangkok ด้วย completed-Pacific 7-day overlap
3. Full backfill เดิน uploads playlist ครบทุกหน้า; Incremental Content จำกัด recent 100 ได้ แต่ Analytics ใช้ tracked inventory ทั้งหมดจาก D1
4. D1 `sync_work_*` เก็บ Source page/resource chunk/Analytics page แบบ resumable และ exact queried-video completeness
5. Durable generation fence + per-stage/per-write/pre-checkpoint guard ป้องกัน stale Retry เขียนทับ Job ใหม่; Superseded run บันทึกเป็น `skipped/SYNC_WORK_SUPERSEDED`
6. Analytics row ทุกแถวตรวจ requested Video, Owner channel และ Date range ก่อน Durable staging
7. Warning ใช้ deterministic outbox; Completed work replay มาก่อน Generation claim และ Worker drain Pending warning แบบ bounded ก่อน Job ใหม่ จึงไม่สูญหายเมื่อ B ใหม่เข้าก่อน A Retry
8. Dry-run warning อยู่เฉพาะ Result/Sync Log และไม่สร้าง Business System Alert
9. Permanent ทั้ง reliability-handled/unhandled และ DLQ เก็บ Terminal audit พร้อม Dead-letter payload; Operational payload ถูก Redact ส่วน `replay_payload_json` รักษา Queue scope แต่ตัด Secret/Token
10. Admin Redrive ใช้ Job กลาง `system.dead-letter.redrive`, ปิดด้วย `MKT_DLQ_REDRIVE_ENABLED=false` เป็นค่าเริ่มต้น, จอง requestedAt/reference แบบ Durable และส่ง Queue ด้วย Generation ใหม่โดยไม่ Resume terminal staging
11. Migration 0005 Fail closed เมื่อยังมี Work/Active lock, Bootstrap generation fence จาก Business checkpoint ล่าสุด และเพิ่ม Outbox/Redrive lifecycle แบบ additive
12. Guarded rollout และ Rollback ใช้ `docs/youtube-resumable-migration-runbook.md`
13. Release examples ทั้ง `.dev.vars.example` และ `wrangler.sync.example.jsonc` ปิด Connector/Schedule/Redrive เป็นค่าเริ่มต้น และไม่มี Live ID/Secret

### Historical UAT-only path

รายการ `trigger=manual_uat`, `MKT_CONNECTOR_YOUTUBE_UAT_ENABLED`, `npm run job:youtube-uat` และสถานะ “No YouTube Scheduler producer” ใช้เฉพาะก่อน Activation ระหว่างวันที่ 2026-07-15–2026-07-17 และถูกยกเลิกแล้ว ห้ามใช้เป็น Current deployment contract

## Live DEV progress and remaining external actions

- Public Data preflight และ Owner Analytics preflight ผ่านแล้ว; Analytics คืน 0 rows ซึ่งเป็น valid no-data result
- เพิ่ม `Social MKT Sync` ใน DEV Base และยกระดับเป็น `Can manage` แล้ว
- Apply `RAW_YouTube_Channels`, `RAW_YouTube_Videos`, `RAW_YouTube_Analytics_Daily` สำเร็จ; Final Preview เหลือ 0 actions/conflicts/warnings/manual actions
- ปรับ Presentation ของตารางจริงแล้ว: ใส่ไอคอน `📺`/`🎬`/`📊`, ย้ายทั้ง 3 ตารางเข้า `🧪 Raw Integration Tables` และเปลี่ยน Field info ทั้ง 42 ฟิลด์เป็นภาษาไทย
- ปรับ DateTime ทั้ง 6 ฟิลด์ใน YouTube RAW ให้แสดง `yyyy/MM/dd HH:mm`; Live UI แสดงเวลาแล้วและ Final Preview เป็น zero drift
- Advanced Permissions เปิดอยู่และตรวจจาก Lark UI แล้วว่า role `Client` เป็น `No access` สำหรับ YouTube RAW ทั้ง 3 ตาราง โดยสถานะเดิมถูกต้องจึงไม่ต้อง Mutation
- บันทึก Table IDs เฉพาะใน ignored local `wrangler.sync.jsonc`; ไม่มี Live ID ถูกเพิ่มใน Source/Git
- Deploy DEV Worker แบบ Active แล้ว; normal YouTube, Owner Analytics และ dedicated YouTube Schedule เปิดใน DEV
- Manual Queue happy path ผ่าน: First Full, Full rerun/idempotency, `auto` → incremental และ Owner Analytics no-data
- Reliability live fault ผ่าน: lock collision → bounded retry → success, timeout → retry exhaustion → DLQ → D1/Lark Critical Alert, resolve Test incident และ healthy run หลัง Restore สำเร็จ
- OAuth identity mismatch แบบ Live read-only ผ่าน Fail-closed พร้อม Permanent code และ Operational redaction; Source แก้ classification gap ที่พบระหว่าง UAT แล้ว
- Missing Video/Analytics key, quota/rate-limit, lease renewal/loss และ alert-persistence failure ผ่าน deterministic production-path tests; ไม่บังคับลบ Content จริง, เผา Provider quota หรือทำ D1 outage ใน DEV
- สถานะ D1 หลัง Fault UAT: success 7, controlled skipped 2, controlled failed 2, DLQ 1 resolved และ System Alert 1 resolved; ไม่มี active YouTube lock ค้าง
- Lark ตรวจจำนวนจริงหลัง rerun แล้ว: RAW Channel 1, RAW Video 2, RAW Analytics 0, Account 1, Content 2 และ Daily 2 โดยไม่เกิด Duplicate
- เปลี่ยน YouTube จาก `uat_pending` เป็น `active` แล้ว
- เปิด YouTube Schedule เฉพาะ DEV; Meta และ Production ยังปิด
- Commit `44377ce` ถูก Push ไป `origin/main`, Apply D1 migration `0004_resumable_sync_work.sql` สำเร็จ และ Deploy DEV Worker version `2037232c-152a-4e26-95fa-fca044f65bd9` รับ Traffic 100%
- ตรวจ Remote D1 แล้วมี `sync_work_runs`, `sync_work_phases`, `sync_work_units` ครบ; Cron ยังคงเฉพาะ `*/5 * * * *` และ `50 0,6,12,18 * * *`
- Post-deploy Full/Incremental/Owner Analytics Queue smoke ผ่าน success/retry 0; Analytics แสดง tracked=selected=queried 2/2/2, failed=0 และ completeness=`complete`
- Final D1 health: current `organic_sync` tracked 2, work staging 0/0/0, active lock 0, open YouTube alert 0 และสามรอบล่าสุด success ทั้งหมด
- Read-only Lark verification: Account 1, RAW Channel 1, RAW Video 2, RAW Analytics 1, Content 2, Daily 4 และ duplicate Stable key = 0 ทุกตาราง
- DEV allowlisted channel ปัจจุบันมีเพียง 2 วิดีโอและ Owner OAuth ตรงกัน; Live UAT กับ inventory ลูกค้า 837 วิดีโอยังไม่รันและห้ามถือว่า fixture 837 แทนหลักฐาน Customer-owned Live UAT

## Required DEV inputs outside Source control

- `YOUTUBE_CHANNEL_ID` ของช่องที่ได้รับอนุญาตให้ทดสอบ
- `YOUTUBE_API_KEY` สำหรับ Public Data API หรือ OAuth credential ที่ใช้แทน
- Owner Analytics OAuth: client ID, client secret และ refresh token เมื่อต้องทดสอบ Analytics
- Lark App credential/app token และ Local Table IDs หลัง Schema Apply
- Secrets ต้องอยู่ใน `.dev.vars`, Cloudflare Secrets หรือ Secret Manager เท่านั้น

## Historical UAT execution order

1. เติม Local credentials และ Channel allowlist
2. `npm run preflight:youtube`
3. `npm run setup:youtube-schema` เพื่อ Preview
4. ตรวจ Plan แล้วใช้ `CONFIRM_WRITE=YES npm run setup:youtube-schema:apply`
5. ใส่ Table IDs ที่คืนมาใน ignored `wrangler.sync.jsonc`
6. Deploy DEV Worker โดย UAT flag เท่านั้น; normal YouTube flag และ Schedule คง false
7. Enqueue Manual UAT job จาก `npm run job:youtube-uat`
8. ทดสอบ First sync, idempotent rerun, incremental, full reconciliation, Analytics missing-key, identity mismatch, quota/rate-limit, D1 alert failure, lock/retry/DLQ และข้อมูลใน Lark
9. เปลี่ยน Connector เป็น `active` และออกแบบ Schedule หลัง Live DEV UAT ผ่าน — completed 2026-07-19

## Acceptance and verification

- Current post-review source Unit/Integration: 407/407 passed
- Current Workers runtime: 8/8 passed
- Current focused Report reliability: 60/60 passed
- Current focused Independent-review regression suite: 46/46 passed
- Focused DateTime/identity regression: 6/6 passed
- Architecture: 111 source files / 233 local dependencies / 0 cycles
- Repository hygiene: passed
- npm audit: 0 vulnerabilities
- Wrangler dry-run: 512.33 KiB / gzip 102.41 KiB passed
- Historical v0.11.0 clean archive extraction retest: `npm ci`, check, Unit 384/384, Workers 7/7, reliability 58/58, audit 0 และ dry-run ผ่าน; Archive verifier พบ blocked/missing/sensitive/duplicate = 0
- Live DEV UAT: `core_happy_path_and_safe_reliability_faults_passed`
- Active DEV deployment: Worker `2037232c-152a-4e26-95fa-fca044f65bd9`, commit `44377ce`, both Cron triggers deployed
- Active Data API smoke after patch: Full + incremental `success`, retry 0, current source states 2, active lock 0, open YouTube alert 0
- Active Owner Analytics smoke after patch: `success`, retry 0, tracked/selected/queried 2/2/2, failed 0, completeness `complete`
- Provider-destructive scenarios: ไม่บังคับสร้าง missing/private/deleted จริง, quota exhaustion/429 จริง หรือ D1 outage จริง; Contract/Classification ผ่าน deterministic tests และต้องเฝ้าดูเมื่อเกิดตามธรรมชาติ

## Implementation result

### Source build handoff — 2026-07-15

- **Implementation:** แก้ Release example/hygiene และ packager, เติม previously-observed Analytics reconciliation, บังคับ D1 warning alert failure ให้ Retry และเพิ่ม Operational identity redaction กลาง
- **Files changed:** YouTube sync/adapters/preflight, Reliability runner/D1/Lark stores, API/Sync Workers, safe environment example, Release tooling, focused tests และเอกสาร handoff; ลบ Blueprint สำเนาซ้ำที่เนื้อหาเหมือน canonical file
- **Commands run:** `npm ci`, `npm run check`, `npm run test:unit`, `npm run test:worker`, `npm run test:report-reliability`, `npm audit --offline`, `npm run deploy:dry-run`, focused Node tests, `npm run release:package` และ `npm run release:verify -- ...zip`; ทำ gates ซ้ำจาก fresh ZIP extraction
- **Tests:** Source และ extracted-archive gates ด้านบนผ่านทั้งหมด; Workers runtime ต้องรันนอก filesystem/network sandbox เพราะ Miniflare เปิด loopback listener
- **Live UAT ณ วันส่ง Source:** ไม่ได้เรียก YouTube/Lark API, ไม่ Apply Schema, ไม่ส่ง Queue จริง และไม่ Deploy
- **Remaining risks:** ต้องยืนยัน Analytics missing-key/re-fetch กับ Live payload, D1 retry/Alert ใน DEV Worker และตรวจข้อมูล retain จริงใน Lark ก่อน Activation
- **Recommended commit:** `fix: harden YouTube reconciliation and reliability`

### Live schema execution update — 2026-07-17

- **Lark permission:** `Social MKT Sync` เปลี่ยนจาก `Can edit` เป็น `Can manage`
- **Partial apply:** รอบแรกสร้าง Channels สำเร็จแล้วหยุดที่ Videos ด้วย `99992402 field validation failed`; `appliedActionCount=1`
- **Confirmed root cause:** Hyperlink field ส่ง `ui_type=URL` แทน Lark OpenAPI enum `Url`; แก้ใน Source จริงและเพิ่ม Regression test
- **Recovery:** Apply ซ้ำแบบ Idempotent สร้าง Videos และ Analytics สำเร็จ จากนั้น Final Preview ยืนยัน 0 actions/conflicts/warnings/manual actions
- **Focused verification:** YouTube schema + Lark client tests 42/42 ผ่าน
- **Regression gates:** Unit 376/376, Workers runtime 6/6, Report reliability 53/53, Architecture 109/230/0, Repository hygiene, audit 0 และ Wrangler dry-run 443.78/90.89 KiB ผ่าน
- **Local config:** เพิ่ม Table mappings ใน ignored `wrangler.sync.jsonc`; ไม่ Commit Live IDs
- **Remaining Live UAT:** Deploy DEV UAT-only Worker, Manual Queue UAT และ Reliability/Reconciliation cases ตามลำดับเดิม; Schedule และ normal connector flag คงปิด
- **Recommended commit:** `fix: use official Lark Url ui type`

### Live Lark presentation correction — 2026-07-17

- **Issue confirmed from UI:** ตาราง YouTube ใหม่ไม่มีไอคอน, อยู่นอกโฟลเดอร์ RAW และ Field info ยังเป็นภาษาอังกฤษต่างจากตารางเดิม
- **Live correction:** เปลี่ยนชื่อเป็น `📺 RAW_YouTube_Channels`, `🎬 RAW_YouTube_Videos`, `📊 RAW_YouTube_Analytics_Daily` และย้ายเข้าหมวด `🧪 Raw Integration Tables` ครบ
- **Field info:** Apply คำอธิบายภาษาไทยครบ 42 ฟิลด์; ตรวจ tooltip ภาษาไทยจากหน้าจอจริงแล้ว
- **Source contract:** Schema ใหม่กำหนดชื่อพร้อมไอคอน, รองรับ alias ของชื่อเดิม และจัดการ description drift แบบ Idempotent โดยรักษา Lark Field property/Select option IDs เดิมระหว่าง Full Update
- **Live verification:** Apply 42 updates สำเร็จ; Final Preview หลัง Rename/Move ยืนยัน 0 actions/conflicts/warnings/manual actions
- **Focused verification:** YouTube schema + installer + Lark client tests 53/53 ผ่าน
- **Regression gates:** Unit/Integration 377/377, Workers runtime 6/6, Report reliability 53/53, Architecture 109/230/0, Repository hygiene, audit 0 และ Wrangler dry-run 444.06/90.94 KiB ผ่าน
- **Remaining Live UAT ณ ตอนแก้ Presentation:** ต้อง Deploy DEV UAT-only Worker และทำ Manual Queue UAT; สถานะล่าสุดอัปเดตในหัวข้อถัดไป

### Live Manual Queue core UAT — 2026-07-17

- **Cloudflare readiness:** Main Queue/DLQ และ D1 พร้อม, migrations ไม่มีรายการค้าง, YouTube API/OAuth secrets ถูกเก็บใน Worker Secret store และ deploy ผ่าน Wrangler dry-run 444.06/90.94 KiB
- **First Full sync:** `success`; pulled 3, created/written 8, retry 0, warning 0 และ error ไม่มี
- **Idempotency:** Full rerun ไม่สร้างแถวใหม่ (`created=0`); อัปเดตเฉพาะข้อมูล latest-state/timestamp 4 แถวและข้าม 4 แถว จำนวน Record ใน Lark คงเดิม
- **Incremental:** payload `syncMode=auto` เลือก `incremental` ด้วยเหตุผล `recent_upload_window`; `created=0`, reconciliation ไม่จำเป็น, checkpoint `incremental_run_count=1`
- **Owner Analytics:** เปิด flag ชั่วคราวเฉพาะ UAT, owner preflight ผ่าน และ Queue run สำเร็จโดย API คืน 0 rows ซึ่งเป็น valid no-data; RAW Analytics ยังคง 0 และไม่มีการสร้างศูนย์ปลอม
- **Observability:** D1 มี YouTube success 5 รอบ, failed/partial 0, alert 0, cursor 1 และ source state 2; Lark มี YouTube Sync Log 5 แถวและ System Alert 0
- **Final safe state:** Worker version `820fbe7d-1db8-48a9-8494-d6e047c62846` ใช้ UAT gate เท่านั้น; `MKT_CONNECTOR_YOUTUBE_ENABLED=false`, `MKT_YOUTUBE_ANALYTICS_ENABLED=false` และไม่มี YouTube Scheduler producer
- **Files changed:** เอกสารสถานะเท่านั้น; Live IDs/credentials อยู่ใน ignored local config และ Secret store ไม่ถูกเพิ่มใน Source
- **Regression gates:** Unit/Integration 377/377, Workers runtime 6/6, Report reliability 53/53, Architecture 109/230/0, Repository hygiene, audit 0 และ Wrangler dry-run 444.06/90.94 KiB ผ่าน; ลบ `.DS_Store` ที่ไม่ได้ Track 2 ไฟล์ก่อนรัน hygiene ซ้ำ
- **Remaining Live UAT:** Missing/private/deleted Video reconciliation, Analytics missing-key re-fetch, identity mismatch/redaction, quota/rate-limit, D1 alert-write failure, lock collision/renewal และ retry exhaustion → DLQ/System Alert
- **Recommended commit:** `docs: record YouTube core queue UAT`

### DateTime, permissions and Reliability fault UAT — 2026-07-17

- **DateTime Source/Live:** กำหนด DateTime ทั้ง 6 ฟิลด์เป็น `yyyy/MM/dd HH:mm` และ `auto_fill=false`; Apply สำเร็จ 6 updates, UI แสดงวันพร้อมเวลา และ Final Preview ยืนยัน 0 actions/conflicts/warnings/manual actions
- **Advanced Permissions:** ตรวจ role `Client` จาก Lark UI แล้วว่า `📺 RAW_YouTube_Channels`, `🎬 RAW_YouTube_Videos` และ `📊 RAW_YouTube_Analytics_Daily` เป็น `No access` อยู่แล้ว จึงไม่เกิด Permission mutation
- **Lock collision:** Queue attempt 0/1 ได้ `SYNC_LOCK_BUSY`; หลังปล่อย lease เดิม attempt 2 สำเร็จแบบ incremental, ไม่มี lock ค้างและไม่สร้าง noisy alert
- **Retry/DLQ/Alert:** Deploy fault profile ชั่วคราวเฉพาะ DEV, timeout ได้ `YOUTUBE_NETWORK_ERROR` ที่ retry 0/1 แล้วเข้า DLQ ด้วย `QUEUE_RETRY_EXHAUSTED`; D1 และ Lark มี Critical Alert ตรงกัน
- **Recovery:** คืน Timeout/Retry เป็นค่าปกติ, Deploy safe Worker, ส่ง healthy Queue run สำเร็จที่ retry 0, lock ค้าง 0 และเปลี่ยน Test DLQ/Alert เป็น `resolved` ทั้ง D1/Lark โดยไม่ลบประวัติ
- **Identity:** Live OAuth read-only fault พบว่า Adapter เดิมโยน TypeError ที่ไม่มี Operational code; แก้เป็น Permanent `YOUTUBE_CHANNEL_IDENTITY_MISMATCH`, เพิ่ม Regression และ Live recheck ผ่านโดยไม่เปิดเผย External identity
- **Non-destructive fault coverage:** Focused 34/34 ครอบคลุม missing Video retain/no-zero, Analytics missing-key, quota terminal, rate-limit/server retry, lease renewal/loss, retry/DLQ routing และ alert persistence; ไม่จงใจลบ Video จริง, ใช้ quota จนหมด หรือทำ D1 outage
- **Final safe deployment:** Worker version `538ed8a6-7e43-49d1-ad87-5791a6ed37d9`; normal YouTube `false`, UAT gate `true`, Owner Analytics `false`, Timeout 30 วินาที, Queue max retries 5 และไม่มี YouTube Scheduler producer
- **Files changed:** YouTube Lark schema contract/test, YouTube identity adapter/preflight regression และเอกสาร handoff; Live IDs/credentials ยังอยู่เฉพาะ ignored config/Secret store
- **Final gates:** Unit/Integration 377/377, Workers runtime 6/6, Report reliability 53/53, Architecture 109 source files / 231 local dependencies / 0 cycles, hygiene pass, audit 0 และ Wrangler dry-run 444.25 KiB / gzip 90.99 KiB
- **Remaining review:** ให้ ChatGPT Work ตรวจหลักฐานและข้อมูลรอบสุดท้ายก่อนตัดสินใจ Activation; Schedule, normal connector และ Production ยังคงปิด
- **Recommended commit:** `fix: complete YouTube reliability UAT safeguards`

### YouTube Active DEV closeout — 2026-07-19

- **Implementation:** Promote YouTube connector/job เป็น `active`, เปลี่ยน reliability identity เป็น `organic_sync`, เพิ่ม dedicated 6-hour Cron และ daily Owner Analytics แบบ 7-day completed-Pacific overlap พร้อม least-privilege payload gate
- **Schedule:** Data API ที่ 01:50/07:50/13:50/19:50 Asia/Bangkok; Analytics เฉพาะ 07:50 โดยยึด `America/Los_Angeles` source day
- **Config safety:** Release examples คงทุก Connector/Schedule เป็น `false`; เปิดเฉพาะ ignored DEV config ที่ผ่าน UAT
- **Live preflight:** Public Data/OAuth owner ผ่าน, Analytics sample 0 rows เป็น valid no-data และ Lark Schema Preview เป็น zero drift
- **Deployment:** Cloudflare DEV Worker `f46c0c7f-0119-4f78-8e8d-2d37e17823a5`; Cron `*/5 * * * *` และ `50 0,6,12,18 * * *` deploy สำเร็จ
- **Post-deploy smoke:** Active Data API run `success`, pulled 3, created expected 2 daily rows for the new metric date, updated 4, skipped 2, retry 0; cursor 1, source states 2, active lock 0, open alert 0
- **Owner Analytics smoke:** Active Analytics run `success`, pulled 4 total source records, created 1 RAW Analytics row, updated 4, skipped 4, retry 0 และ error ไม่มี; read-only Lark verification ยืนยัน RAW Analytics count = 1
- **Commands run:** `npm run check`, `npm run test:unit`, `npm run test:worker`, `npm run test:report-reliability`, YouTube preflight, Lark Schema Preview, Wrangler example/live dry-run, Wrangler deploy, manual Active Queue smoke และ read-only D1 verification
- **Tests:** Unit 384/384, Workers 7/7, Report reliability 58/58, Architecture 109/230/0, hygiene pass, dry-run 444.70 KiB / gzip 91.23 KiB
- **Release artifact:** สร้างและตรวจ `social-marketing-integration-v0.11.0.zip` สำเร็จ; 256 files และ blocked/missing/sensitive/duplicate = 0 พร้อมรัน Gate ซ้ำจากไฟล์ ZIP ที่แตกใหม่
- **Remaining risks:** Scheduled Cron propagation may take up to 15 minutes; naturally occurring Provider missing/quota/rate-limit and long-term Analytics availability remain operational monitoring, not unfinished implementation
- **Recommended commit:** `feat: activate YouTube organic sync`

### Post-activation scheduler and Analytics review fix — 2026-07-19

- **Root cause:** (1) Owner Analytics ใช้ `videoResources` ของ Content traversal เดียวกัน จึงถูก `MKT_YOUTUBE_RECENT_VIDEO_LIMIT` ตัดเหลือ 100 IDs ใน incremental mode และ reconciliation ใช้ scope ที่ถูกตัดตามไปด้วย (2) `MKT_YOUTUBE_ANALYTICS_TIME` ตรวจเพียงรูปแบบ `HH:mm`/5 นาที แต่ไม่ตรวจว่า Dedicated YouTube Cron ยิงถึงเวลานั้นจริง (3) Scheduler ใช้ negative routing `cron !== YOUTUBE_SCHEDULE_CRON` ทำให้ Cron ที่ไม่รู้จักถูกตีความเป็น Primary
- **Implementation:** แยก Analytics tracked-video scope เป็นผลรวมแบบ dedupe/sort ของ D1 checkpoint states ทั้งหมดกับ uploads IDs รอบปัจจุบัน โดย Content traversal ยังใช้ recent limit เดิม; ใช้ scope เดียวกันทั้ง Owner Analytics query และ reconciliation; derive Dedicated Cron string/เวลาที่รองรับจาก minute/hour contract เดียว; validate Analytics local time ก่อน enqueue; route เฉพาะ `PRIMARY_SCHEDULE_CRON` และ `YOUTUBE_SCHEDULE_CRON`, ส่วน Unknown Cron คืน empty plan
- **Files changed:** `apps/sync-worker/src/index.js`, `packages/application/src/use-cases/sync-youtube-organic-to-lark.js`, `tests/application/scheduled-jobs.test.js`, `tests/application/sync-youtube-organic-to-lark.test.js`, `tests/config/deployment-config.test.js`, `tests/worker-runtime/sync-worker.runtime.test.js`, `docs/current-task.md`, `PROJECT_BRAIN.md`, `docs/project-brain/10-next-actions.md`, `README.md` และ `CHANGELOG.md`
- **Commands run:** focused Node tests, focused Workers-runtime test, `npm ci`, `npm run check`, `npm test`, `npm run test:report-reliability`, focused YouTube/Scheduler/Reliability suite, `npm audit --offline`, `npm run deploy:dry-run`, `git diff --check` และ repository status/diff inspection
- **Tests:** Regression ใหม่จำลอง 105 tracked videos ขณะที่ Content incremental จำกัด 100; Analytics query ครบ 105 IDs เป็น 3 batches, วิดีโอเก่าถูกนำเข้า reconciliation และ idempotent incremental rerun ยังคง scope 105; Unsupported `08:10` fail ด้วย `MKT_SCHEDULE_CONFIG_INVALID`; Unknown Cron ไม่ส่ง Queue; Workers-runtime Primary/YouTube/Unknown routing ผ่าน
- **Regression results:** Full Unit/Integration 388/388, Workers runtime 8/8, focused Report reliability 60/60, focused YouTube/Scheduler/Reliability 60/60, Architecture 109/230/0, repository hygiene pass, offline audit 0 และ Wrangler dry-run 446.77 KiB / gzip 91.73 KiB; lock collision, lease loss, retry behavior, retry exhaustion → DLQ persistence, alert persistence, TikTok Queue routing, YouTube idempotency, plan-before-write, Account-last และ checkpoint-after-business-writes ยังผ่าน
- **Live UAT/Deployment:** รอบแก้นี้ไม่เรียก YouTube/Lark API, ไม่เขียน D1/Queue, ไม่ Apply Schema และไม่ Deploy; DEV Worker ปัจจุบันยังเป็น prior deployment จนกว่าจะ Commit/Review/Deploy patch นี้
- **Remaining risks:** Analytics completeness อาศัย D1 checkpoint ที่สร้างจาก First/Periodic Full traversal ตาม contract; หาก checkpoint ถูกลบหรือเสียหาย รอบ `auto` ถัดไปจะเลือก Full เมื่อ cursor หาย แต่ partial external corruption ที่ยังเหลือ cursor ต้องอาศัย periodic Full reconciliation ซ่อม scope. การรองรับเวลาท้องถิ่นคำนวณจาก Dedicated Cron กับ timezone ของวันรัน; DEV `Asia/Bangkok` ไม่มี DST และ `07:50` รองรับชัดเจน
- **Rollback:** ไม่มี Migration หรือ Stable-key change; หาก patch มีปัญหาให้ปิด `MKT_YOUTUBE_ANALYTICS_ENABLED`/`MKT_SCHEDULE_YOUTUBE_ENABLED`, redeploy prior known-good version แล้ว revert patch commit. Rows/Checkpoint เดิมไม่ต้องลบ
- **Commit suggestion:** `fix: harden YouTube analytics scheduling`

### YouTube large-account release blocker — 2026-07-19

- **Root cause:** Patch ก่อนหน้าแก้ Analytics scope ให้รวม D1 tracked IDs แล้ว แต่ Source traversal และ Analytics query ยังรันใหม่ตั้งแต่ต้นเมื่อ Queue retry, ไม่มี durable page/chunk progress, ไม่มี exact queried-ID marker และ Sync Log ยังไม่เก็บ completeness counters. สำหรับลูกค้า 837 วิดีโอ ความล้มเหลวกลาง 17 Content/Analytics chunks จึงทำงานซ้ำโดยไม่จำเป็น และระบบไม่มีหลักฐานเชิงโครงสร้างว่าทั้ง 837 IDs ถูกส่งเข้า Analytics ครบจริง.
- **Implementation:** เพิ่ม shared D1 resumable work contract (`sync_work_runs`, `sync_work_phases`, `sync_work_units`) แยกจาก Business checkpoint; เพิ่ม uploads single-page API, persist Content inventory page, Video resource chunk และ Analytics page แบบ atomic ต่อ unit; Queue retry ใช้ stable message ID; Analytics บันทึก queried-video marker เมื่อจบ chunk และเทียบ exact expected/query set ก่อน Plan Lark; staged units ถูกอ่านกลับแบบ page-by-page; ลบ work staging หลัง Lark writes และ D1 checkpoint สำเร็จเท่านั้น.
- **Files changed:** YouTube API client/use case/Worker wiring, shared Sync Engine D1/In-memory work stores, D1 migration `0004_resumable_sync_work.sql`, Reliability Sync Log details, large-account/connector/API/D1 tests และเอกสาร Current Task/Project Brain/README/CHANGELOG.
- **Commands run:** focused Node tests, `npm ci`, `npm run check`, `npm test` (Workers runtime รันนอก sandbox เพราะ Miniflare ต้องเปิด loopback), `npm run test:report-reliability`, `npm audit --offline`, `npm run deploy:dry-run`, SQLite migration replay, `git diff --check` และ repository status/diff inspection.
- **Tests:** Fixture 837 ยืนยัน Full traversal 17 pages/17 resource chunks, resume จาก page token 450 หลัง page failure, incremental Content 100 ขณะที่ Analytics query 837 ครบ 17 chunks, Analytics retry ต่อจาก chunk ที่ล้ม, exact-scope corruption fail-closed และ Full rerun ไม่เพิ่ม Lark stable rows; D1 work-store atomic/resume/reset/cleanup และ API single-page contract มี regression แยก.
- **Regression results:** Unit/Integration 397/397, Workers runtime 8/8, Report reliability 60/60 และ focused YouTube/Scheduler/Queue/Reliability/Resumable-work 69/69 ผ่าน; Architecture 111 source files / 232 local dependencies / 0 cycles, repository hygiene ผ่าน, offline audit 0 vulnerabilities, Wrangler dry-run 480.80 KiB / gzip 97.58 KiB และ fresh SQLite migration replay ผ่าน.
- **Live UAT/Deployment:** รอบนี้ยังไม่ Apply migration ไป Remote D1, ไม่เรียก YouTube/Lark API, ไม่ส่ง Queue, ไม่ Deploy และไม่แก้ Secret/Live IDs. DEV Worker ปัจจุบันยังเป็น prior deployment และยังไม่ถือว่าปิด large-account blocker.
- **Remaining risks:** ก่อน DEV redeploy ต้อง Apply migration `0004_resumable_sync_work.sql`; จากนั้นทำ Queue UAT ด้วย tracked inventory จริงและตรวจ D1 Sync Log completeness. TableSyncEngine ยัง materialize normalized destination rows ที่จำเป็นต่อ six-table plan ไว้ก่อน write ตาม safety contract แต่ Source page envelopes ถูก persist/read แบบ bounded pages; Connector ปริมาณใหญ่ถัดไปต้อง benchmark memory และขยาย shared persisted-plan execution หาก fixture จริงเกิน Worker memory budget.
- **Rollback:** ปิด `MKT_SCHEDULE_YOUTUBE_ENABLED` และ `MKT_YOUTUBE_ANALYTICS_ENABLED`, redeploy prior Worker แล้ว revert patch. Migration ใหม่เป็น additive staging tables ไม่มี Foreign key ไป Business state; เก็บไว้ได้ระหว่าง rollback และลบ orphan work rows ภายหลังด้วย guarded operation โดยไม่แตะ `sync_cursors`, `source_record_states` หรือ Lark rows.
- **Commit suggestion:** `fix: make YouTube large-account sync resumable`

### Large-account patch DEV rollout — 2026-07-19

- **Git:** Commit `44377ce` (`fix: make YouTube large-account sync resumable`) ถูก Push ไป `origin/main`
- **D1 migration:** Remote migration list พบ pending เฉพาะ `0004_resumable_sync_work.sql`; Apply สำเร็จ 7 commands และ read-only verification พบ work tables ครบ 3 ตาราง
- **Deployment:** Actual DEV-config dry-run ผ่าน; Worker version `2037232c-152a-4e26-95fa-fca044f65bd9` ถูก Deploy และรับ Traffic 100%; Cron API ยืนยัน `*/5 * * * *` กับ `50 0,6,12,18 * * *`
- **Full smoke:** `success`, retry 0, mode `full`, playlist 2, inventory 1 page, resource 1 chunk, created 0, updated 4, skipped 4 และ written 4
- **Incremental smoke:** `success`, retry 0, request `auto` เลือก mode `incremental`, playlist 2, created 0, updated 4, skipped 4 และ written 4
- **Analytics smoke:** ใช้ช่วง `2026-07-11`–`2026-07-17` จาก scheduler contract; `success`, retry 0, tracked=2, selected=2, queried=2, skipped=0, failed=0, pages/chunks=1/1 และ completeness=`complete`
- **D1 final state:** `organic_sync` tracked 2; `sync_work_runs`/`sync_work_phases`/`sync_work_units` = 0/0/0 หลัง checkpoint; active lock 0, open YouTube alert 0, latest three YouTube runs success 3/3
- **Lark read-only verification:** Account 1, RAW Channel 1, RAW Video 2, RAW Analytics 1, Content 2, Daily 4; duplicate Stable keys = 0 ทุกตาราง
- **Security/Scope:** Secret values ไม่อยู่ใน Config/Command output; Meta, Instagram, WooCommerce, Chatwoot และ Production ยังคง disabled
- **Remaining blocker:** DEV channel ปัจจุบันมี 2 วิดีโอ ไม่ใช่ Customer inventory 837. Source regression 837 ผ่านแล้วแต่ยังไม่แทน Live Customer UAT; ต้องใช้ Customer-owned Channel + matching Owner OAuth/Lark/Cloudflare environment แล้วทำ Full/Incremental/Analytics UAT ซ้ำก่อน Production release
- **Rollback:** หากพบปัญหาให้ปิด YouTube Schedule/Analytics ใน DEV และ rollback ไป Worker `f46c0c7f-0119-4f78-8e8d-2d37e17823a5`; migration 0004 เป็น additive staging และเก็บไว้ได้
- **Closeout commit suggestion:** `docs: record YouTube large-account DEV rollout`

## Work review

- **Technical architecture:** Local corrective patch closes cross-generation warning delivery, exact durable redrive payload, superseded-run semantics and migration quiesce/bootstrap gaps
- **Data model:** approved — Blueprint v0.10.2; Migration 0005 remains additive and has not been applied remotely
- **Release decision:** Source package must pass full gates and guarded DEV rollout in `docs/youtube-resumable-migration-runbook.md`; Customer 837-video Live UAT remains the Production blocker
- **Recommended commit for current delta:** `fix: close YouTube resumable reliability gaps`

### Independent review reliability hardening — 2026-07-19

- **Root cause:** (1) Resumable work ผูกกับ Queue `message.id` แต่ไม่มี durable generation fence ทำให้ Retry เก่าสามารถกลับมา Plan/Write/Commit checkpoint หลังงานใหม่กว่า (2) Analytics ตรวจ headers/markers แต่ไม่ตรวจทุก mapped row กับ requested video/channel/date scope ก่อน staging (3) Reconciliation warning ถูกสร้างหลัง Business checkpoint/cleanup และ alert store failure ทำให้ Retry รอบถัดไปหา warning เดิมไม่เจอ (4) `completeWork` เกิดเฉพาะ success ส่วน Permanent/DLQ ไม่มี terminal lifecycle/TTL cleanup จึงทิ้ง staging ค้าง
- **Implementation:** เพิ่ม D1 generation fence และตรวจก่อน Source staging, ก่อนทุก Destination plan/write chunk และก่อน guarded checkpoint CAS; stale job คืน `superseded` โดยไม่แตะ Source/Lark/checkpoint. เพิ่ม Analytics row-scope validator แบบ typed fail-closed. เพิ่ม deterministic durable warning outbox + completed-work replay และ mark delivered หลัง D1 System Alert upsert. เพิ่ม `active/completed/terminal/superseded` lifecycle, terminal reason/audit/expiry, idempotent DLQ/Permanent marking และ guarded bounded cleanup ที่ไม่ลบ active/locked/pending-warning work. DLQ redrive ต้องสร้าง Queue message/work key และ generation ใหม่ ห้าม implicit resume terminal staging.
- **Files changed:** Worker Queue routing, YouTube sync use case/RAW adapter, Reliability runner, D1 incremental/resumable stores, in-memory work store, additive migration `0005_resumable_sync_reliability.sql`, release policy/ignore rules, focused regression tests และเอกสาร handoff/Project Brain/README/CHANGELOG.
- **Commands run:** fail-before focused tests, official Cloudflare/Workers/D1 contract review, `npm ci`, `npm run check`, `npm test`, `npm run test:worker`, `npm run test:report-reliability`, `npm audit --offline`, `npm run deploy:dry-run`, focused regression suites, `git diff --check`, SQLite empty/existing migration replay และ repository status/diff inspection. Workers runtime ใช้ execution นอก sandbox เพราะ Miniflare ต้องเปิด loopback.
- **Tests:** Regression ครอบคลุม A(view=100) ล้ม → B(view=200) สำเร็จ → A retry ถูก supersede; checkpoint CAS; 837-video Full/Incremental/Analytics resume/idempotency; Analytics video/channel/date นอก scope; warning alert ล้มครั้งแรกแล้ว completion replay ส่ง business alert เดิมหนึ่งรายการโดยไม่เรียก Source ซ้ำ; Permanent ทั้ง reliability-handled/unhandled, retry exhaustion/DLQ, terminal mark, TTL cleanup ซ้ำ, active/locked exclusion และ new-generation redrive.
- **Regression results:** Unit/Integration `407/407`, Workers runtime `8/8`, Report reliability `60/60`, focused review suite `46/46`, Architecture `111 source files / 233 local dependencies / 0 cycles`, repository hygiene pass, offline audit `0 vulnerabilities`, Wrangler dry-run `512.33 KiB / gzip 102.41 KiB`. Empty D1 replay `0001→0005` ผ่าน; existing schema `0001→0004 + legacy rows → 0005` ผ่านและรักษา legacy work/cursor. Clean archive มี 261 files และ verifier พบ blocked/missing/sensitive/duplicate = 0; gates ผ่านซ้ำจาก fresh extraction.
- **TikTok/Core impact:** TikTok unguarded checkpoint SQL และ existing Queue/Scheduler/Retry/Lock contracts คงเดิม; additive columns/tables ไม่บังคับ TikTok ใช้ generation ทันที. TikTok Queue/report reliability regressions ผ่าน. Shared work store รองรับ connector ขนาดใหญ่ถัดไปโดยไม่เพิ่ม YouTube-only state machine.
- **Live UAT/Deployment:** Patch นี้ไม่เรียก YouTube/Lark API, ไม่ Apply Remote D1 migration, ไม่ส่ง Queue, ไม่ Deploy, ไม่เปลี่ยน DEV schedule/Secret/Production. DEV ยังคงรัน commit/deployment ก่อน patch นี้จนกว่าจะผ่าน review และ apply migration 0005.
- **Remaining risks:** ต้อง review SQL บน target D1, apply additive migration 0005 ก่อน deploy source ใหม่, ทำ controlled DEV stale-generation/outbox/terminal smoke และ Customer-owned 837-video Live UAT. In-memory 837 fixture ไม่แทน Live customer quota/data behavior. Cleanup ทำงานแบบ bounded opportunistic หลัง Reliability runner ปล่อย Lock; หากไม่มีงานนานควรเพิ่ม scheduled maintenance หลังมี operational evidence. Work ที่ยังมี pending warning จะถูกเก็บไว้โดยตั้งใจจน Alert delivery/repair สำเร็จ.
- **Rollback:** ปิด `MKT_SCHEDULE_YOUTUBE_ENABLED` และ `MKT_YOUTUBE_ANALYTICS_ENABLED`, redeploy prior known-good Worker. Migration 0005 เป็น additive จึงเก็บไว้ได้; prior codeไม่อ่าน columns/tables ใหม่. ห้ามลบ Business checkpoint/Lark rows. Terminal/completed staging ลบได้ภายหลังด้วย guarded cleanup เท่านั้น.
- **Commit suggestion:** `fix: harden YouTube resumable sync`

### ChatGPT Work corrective patch — 2026-07-19

- **Review gaps closed:** Pending warning can be drained independently of the current Generation; Completed retry replays before fence claim; Permanent reliability-handled failure persists the same durable Dead-letter contract as unhandled failure; Migration rollout is quiesced and bootstrapped from Business checkpoints
- **Outbox:** Worker drains Pending warning before a new YouTube Generation; deterministic Alert upsert + delivered marker remains idempotent when Alert write or delivered-marker write fails
- **Redrive:** `dead_letter_jobs` separates operational-redacted `payload_json` from secret-filtered `replay_payload_json`; Application validates the candidate read-only before reservation and D1 rechecks forbidden job types before `redrive_pending`, so recursive/invalid commands cannot mutate an open incident
- **Migration safety:** 0005 rejects any remaining pre-migration work or unexpired lock before ALTER statements and seeds `sync_generation_fences` from `sync_cursors.last_successful_sync_at`; exact rollout/rollback steps are in `docs/youtube-resumable-migration-runbook.md`
- **Semantics:** Superseded work is `skipped`, not success; Dry-run warnings do not create Business alerts
- **Source tests added:** A warning failure → B newer generation → A retry; global bounded Outbox drain; durable Redrive retry after Queue send; `privateKey`/`signingKey`/`credential` filtering in Operational and Replay D1 payloads; read-only recursive-redrive rejection with D1 state remaining `open`; migration guard/bootstrap contract; handled/unhandled Permanent payload persistence
- **Verification:** Unit/Integration 426/426, Workers runtime 8/8, Report reliability 64/64, focused corrective 74/74, Architecture 113/238/0, repository hygiene, offline audit 0, Wrangler dry-run 534.26/106.71 KiB และ SQLite migration replay/guard ผ่าน
- **Source handoff archive:** 264 source files; ไม่มี `.DS_Store`, AppleDouble, `RELEASE_MANIFEST.txt`, local config, Secret, dependency หรือ generated output. Official Release archive/manifest ต้องสร้างใหม่หลัง Commit จาก clean Git tree เท่านั้น
- **Live mutation:** none — no YouTube/Lark API, Remote D1, Queue, deploy, schedule, Secret or Production change
- **Remaining external gates:** full local/clean-archive gates, guarded DEV migration/deploy smoke, then Customer-owned 837-video Full/Incremental/Analytics UAT
- **Code X follow-up:** ยืนยันและปิด 3 finding หลัง review: Secret matcher coverage, Source-root hygiene/manifest truthfulness และ recursive redrive state mutation
- **Commit suggestion:** `fix: close YouTube reliability review gaps`

### Scalar Secret redaction follow-up — 2026-07-19

- **Root cause:** Operational และ Queue-replay sanitizers ข้ามการ Redact เมื่อค่าของ Secret-looking key เป็น Number หรือ Boolean เพื่อรักษา completeness counters ที่เป็นตัวเลข แต่ใช้เงื่อนไขเดียวกันกับ true Secret keys จึงทำให้ค่าอย่าง numeric `password`, `accessToken`, `privateKey` หรือ `credential` สามารถถูก Persist ลง D1 แบบไม่ปกปิด
- **Implementation:** แยก Operational true-secret matcher ออกจาก Identity/count matcher; true Secret ที่ไม่ใช่ `null` ถูก Redact โดยไม่ขึ้นกับชนิดค่า ขณะที่ numeric operational counters เช่น `missingVideoIds: 2` ยังคงใช้วินิจฉัยได้. Queue replay ใช้ secret allowlist เดิมเพื่อรักษา `channelId`/`pageToken` ที่จำเป็นต่อ Replay แต่ Redact scalar Secret ทุกชนิด
- **Files changed:** `packages/shared/src/errors/runtime-error.js`, `tests/shared/runtime-error.test.js`, `tests/reliability/d1-reliability-store.test.js`, `docs/current-task.md`, `PROJECT_BRAIN.md`, `README.md`, `CHANGELOG.md` และ `RELEASE_TEST_REPORT.md`
- **Commands run:** focused Node tests, `npm ci`, `npm run check`, `npm test`, `npm run test:report-reliability`, `npm audit --offline`, `npm run deploy:dry-run`, `git diff --check` และ final repository status/diff inspection
- **Tests:** Focused sanitizer/D1 persistence 12/12 ครอบคลุม numeric/boolean `password`, `accessToken`, `privateKey`, `signingKey`, `credential` และ `credentials`; ตรวจว่า Operational count ยังอยู่, Replay scope ยังอยู่ และ raw scalar Secret ไม่ปรากฏใน JSON ที่ Persist
- **Regression results:** Unit/Integration 426/426, Workers runtime 8/8, Report reliability 64/64, Architecture 113/238/0, repository hygiene pass, offline audit 0 และ Wrangler dry-run 534.48/106.76 KiB ผ่าน
- **Live UAT/Deployment:** ไม่มี — ไม่เรียก YouTube/Lark API, ไม่เขียน Remote D1/Queue, ไม่ Deploy, ไม่เปลี่ยน Schedule/Secret/Production
- **Remaining risks:** Sanitizer เป็น key-name policy จึงต้องเพิ่ม naming variant เมื่อมี Credential contract ใหม่; External gate เดิมยังคงเป็น guarded migration 0005/DEV smoke และ Customer-owned 837-video Live UAT
- **Rollback:** Revert matcher/test/documentation delta นี้ได้โดยไม่แตะ Migration, D1 rows, Lark rows, Stable keys หรือ Schedule; ไม่แนะนำให้ rollback ในระบบที่รับ payload จาก Boundary ที่ไม่บังคับ Secret เป็น String
- **Commit suggestion:** `fix: redact scalar secrets in queue payloads`

### Clean archive gate consistency — 2026-07-19

- **Root cause:** Official packaging adds `RELEASE_MANIFEST.txt` to the ZIP by contract, but `check-repository-hygiene.mjs` rejected that generated file in every working directory. The required `npm run check` therefore failed after extracting a valid archive even though the verifier required the same Manifest.
- **Implementation:** Detect the actual Git worktree root before enforcing the source-root generated-artifact rule. The Git source root still rejects `RELEASE_MANIFEST.txt`; an extracted Release tree can keep its required Manifest and run the full gate.
- **Files changed:** `scripts/check-repository-hygiene.mjs`, `docs/current-task.md` and `CHANGELOG.md`.
- **Commands run:** Official Release package/verify, fresh extraction `npm ci`, `npm run check`, `npm test`, `npm run test:report-reliability`, `npm audit --offline`, `npm run deploy:dry-run`, focused Release policy tests and source `npm run check`.
- **Tests:** Before fix, extracted `npm run check` failed only on the required Manifest. Unit/Integration 426/426, Workers runtime 8/8, Report reliability 64/64, offline audit 0 and dry-run 534.48/106.76 KiB passed. Source-root hygiene and focused Release policy 4/4 remain passed.
- **Regression results:** Source root continues to reject generated root artifacts; Archive verifier still requires the Manifest and still blocks local config, Secret, dependencies, nested archives and generated outputs.
- **Remaining risks:** Must create a new clean archive after committing this fix and rerun every extracted-archive gate before Remote D1/Worker mutation.
- **Rollback:** Revert this narrow checker/documentation change; it has no Worker runtime, D1, Queue, Lark, Secret or Schedule effect.
- **Commit suggestion:** `fix: align extracted release hygiene gate`

### Migration 0005–0006 guarded DEV rollout — 2026-07-20

- **Root causes found during Live UAT:** (1) A valid YouTube Data API zero-result channel response may omit `items`; `getChannel()` required an Array too early and emitted `UNHANDLED_SYNC_ERROR`. (2) Migration 0005 added Redrive columns/logic but inherited migration 0002's SQLite CHECK constraint, which did not allow `redrive_pending`/`redriven`; every Admin Redrive attempt therefore failed retryably at prepare.
- **Implementation:** Treat only omitted `channels.items` as empty before the exact-one identity guard. Add migration 0006 to rebuild `dead_letter_jobs` with both durable Redrive states, a copy-count guard, all existing columns/rows and both indexes preserved.
- **Files changed:** YouTube API client/test, migration `0006_dead_letter_redrive_status.sql`, migration regression, Release hygiene checker and rollout/Project Brain/CHANGELOG documentation.
- **Commands run:** Clean Release package/verify and all gates from a fresh ZIP extraction; Wrangler version/migration/D1 read-only checks; guarded config-off deploy; D1 export; remote migration 0005 apply/verify; schedule-off source deploy; Manual healthy/stale/Permanent Queue messages through Cloudflare Dashboard; focused YouTube tests and source `npm run check`.
- **Tests:** Fresh archive passed Unit/Integration 426/426, Workers runtime 8/8, Report reliability 64/64, Architecture 113/238/0, hygiene, audit 0 and dry-run 534.48/106.76 KiB. Focused YouTube/client regression including omitted `items` passed 22/22.
- **Live regression results so far:** Quiesce work/lock 0; migration 0005 applied 32 commands; lifecycle/cursor/redrive columns complete; fence bootstrap 3/3; healthy incremental succeeded retry 0; stale job was `skipped/SYNC_WORK_SUPERSEDED` with writes 0. Patched Live identity retest now returns `YOUTUBE_CHANNEL_IDENTITY_MISMATCH`. Permanent handling created terminal work, valid secret-filtered replay payload and alerts with active lock 0. Live tail confirmed Redrive prepare failed specifically with `D1_DEAD_LETTER_REDRIVE_PREPARE_FAILED`; target incident remained `open` and unreserved.
- **Remaining risks/gates:** Wait for the failed Admin message to drain, apply/verify migration 0006, deploy and rerun controlled Redrive/healthy recovery, warning-outbox/TTL guard verification, full final gates, then re-enable DEV Schedule/Analytics. Customer-owned 837-video Live UAT remains the Production blocker.
- **Rollback:** Current migration is additive. Keep Schedule/Analytics disabled and deploy the prior known-good Worker if the patched smoke fails; do not delete Business checkpoints/Lark rows or pending warning entries.
- **Commit suggestion:** `fix: classify empty YouTube channel lookup`
