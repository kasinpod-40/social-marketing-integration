# Current Task — YouTube Organic DEV Complete v0.11.0

## Task metadata

- **Status:** `completed_active_dev_deployed`
- **Official clean baseline:** `v0.10.2-multi-channel-foundation-approved`
- **Working candidate:** `v0.11.0`
- **Blueprint:** `Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx`
- **Connector status:** `active`
- **Schedule:** `enabled_in_verified_dev`
- **Last updated:** `2026-07-19`
- **Owners:** ChatGPT Work (technical review/release) + developer (DEV credentials and guarded live execution)

## Objective

ปิด YouTube Organic DEV ให้ครบตั้งแต่ Schema/Access/Queue/Reliability UAT จนถึง Active connector, scheduled sync, Owner Analytics policy, Cloudflare deployment และ post-deploy smoke test โดยยังไม่เปิด Production.

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

## Implemented in this candidate

1. Generic Lark Schema Preview/Apply engine ที่รับ Schema contract ได้หลายชุด โดยรักษา Report compatibility
2. YouTube RAW three-table installer ที่ derive จาก Blueprint กลาง
3. Guarded commands:
   - `npm run setup:youtube-schema`
   - `CONFIRM_WRITE=YES npm run setup:youtube-schema:apply`
4. YouTube DEV access preflight สำหรับ Public Data API และ optional Owner Analytics OAuth
5. API key / OAuth refresh-token runtime clients พร้อม cache และ placeholder rejection
6. RAW Channel, Video และ Analytics mapping พร้อม response-grain validation
7. `MKT_Accounts`, `MKT_Content`, `MKT_Content_Daily` destination plans โดย Plan ทุกตารางก่อน Write และเขียน Account เป็นลำดับสุดท้าย
8. Manual Queue job `youtube.channel.organic.sync` ที่รันได้เฉพาะ `trigger=manual_uat`
9. Separate UAT gate `MKT_CONNECTOR_YOUTUBE_UAT_ENABLED=true` ขณะที่ normal `MKT_CONNECTOR_YOUTUBE_ENABLED=false`
10. D1 checkpoint, recent-window incremental mode และ periodic full reconciliation
11. Reuse Sync Log, distributed lock/renewal, bounded retry, DLQ และ System Alerts
12. Reconciliation warning หลังรอบสำเร็จเมื่อ Video resource หาย โดยไม่ทำให้ Queue retry ซ้ำ
13. Dry-run/manual payload helper `npm run job:youtube-uat`
14. No YouTube Scheduler producer
15. Analytics reconciliation ตรวจเฉพาะ Stable keys ที่เคยพบใน Video/ช่วงวันที่ที่ re-fetch จริง; แถวที่หายถูก retain และสร้าง `YOUTUBE_ANALYTICS_RECONCILIATION_REQUIRED`
16. D1 warning alert เป็น Primary gate จริง: Persist ไม่สำเร็จกลายเป็น Retryable failure และ Queue ห้าม Ack
17. Operational redaction กลางสำหรับ Worker logs, D1 payload/error และ Lark reliability mirror โดยไม่เปิดเผย Channel/Video/Handle/Lock identity
18. Release examples ใช้ Placeholder เท่านั้นและ Repository hygiene ไม่มี macOS metadata
19. Promote Connector/Job เป็น `active` และยกเลิก UAT-only runtime gate
20. Data API schedule แยก Cron ทุก 6 ชั่วโมง โดยไม่ enqueue TikTok/Report ซ้ำ
21. Owner Analytics วันละครั้งเวลา 07:50 Asia/Bangkok พร้อม bounded 7-day completed-Pacific overlap
22. Queue payload ลดสิทธิ์ Analytics ได้ แต่ห้ามยกระดับเหนือ Runtime feature flag

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

- Unit/Integration: 384/384 passed
- Workers runtime: 7/7 passed
- Focused Report reliability: 58/58 passed
- Focused YouTube safe fault suite: 34/34 passed
- Focused DateTime/identity regression: 6/6 passed
- Architecture: 109 source files / 230 local dependencies / 0 cycles
- Repository hygiene: passed
- npm audit: 0 vulnerabilities
- Wrangler dry-run: 444.70 KiB / gzip 91.23 KiB passed
- Clean archive extraction retest: `npm ci`, check, Unit 384/384, Workers 7/7, reliability 58/58, audit 0 และ dry-run ผ่าน; Archive verifier พบ blocked/missing/sensitive/duplicate = 0
- Live DEV UAT: `core_happy_path_and_safe_reliability_faults_passed`
- Active DEV deployment: Worker `f46c0c7f-0119-4f78-8e8d-2d37e17823a5`, both Cron triggers deployed
- Active Data API smoke: `success`, retry 0, cursor 1, source states 2, active lock 0, open YouTube alert 0
- Active Owner Analytics smoke: `success`, retry 0, pulled 4 total source records and created 1 real RAW Analytics row
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

## Work review

- **Technical architecture:** approved and active in DEV
- **Data model:** approved — Blueprint v0.10.2
- **Release decision:** `v0.11.0`; YouTube Organic DEV complete, Production remains disabled
- **Recommended commit for current delta:** `feat: activate YouTube organic sync`
