# Current Task — YouTube Organic DEV Implementation v0.11.0-rc.1

## Task metadata

- **Status:** `manual_queue_core_uat_passed_reliability_fault_cases_pending`
- **Official clean baseline:** `v0.10.2-multi-channel-foundation-approved`
- **Working candidate:** `v0.11.0-rc.1`
- **Blueprint:** `Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx`
- **Connector status:** `uat_pending`
- **Schedule:** `disabled`
- **Last updated:** `2026-07-17`
- **Owners:** ChatGPT Work (technical review/release) + developer (DEV credentials and guarded live execution)

## Objective

ทำ YouTube Organic DEV implementation ตาม Blueprint ที่ผ่าน Technical review โดยเพิ่มเส้นทาง Manual UAT ที่ Fail-closed, ใช้ Reliability layer เดิม และยังไม่เปิด Scheduled/Production traffic.

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

## Live DEV progress and remaining external actions

- Public Data preflight และ Owner Analytics preflight ผ่านแล้ว; Analytics คืน 0 rows ซึ่งเป็น valid no-data result
- เพิ่ม `Social MKT Sync` ใน DEV Base และยกระดับเป็น `Can manage` แล้ว
- Apply `RAW_YouTube_Channels`, `RAW_YouTube_Videos`, `RAW_YouTube_Analytics_Daily` สำเร็จ; Final Preview เหลือ 0 actions/conflicts/warnings/manual actions
- ปรับ Presentation ของตารางจริงแล้ว: ใส่ไอคอน `📺`/`🎬`/`📊`, ย้ายทั้ง 3 ตารางเข้า `🧪 Raw Integration Tables` และเปลี่ยน Field info ทั้ง 42 ฟิลด์เป็นภาษาไทย
- บันทึก Table IDs เฉพาะใน ignored local `wrangler.sync.jsonc`; ไม่มี Live ID ถูกเพิ่มใน Source/Git
- Deploy DEV Worker แบบ UAT-only แล้ว; normal YouTube flag, Owner Analytics flag หลังจบ UAT และ YouTube Schedule คงปิด
- Manual Queue happy path ผ่าน: First Full, Full rerun/idempotency, `auto` → incremental และ Owner Analytics no-data
- D1 บันทึก YouTube `success` 5 รอบ, failed/partial 0, alert 0; Lark มี Sync Log 5 แถวและ System Alert 0 แถว
- Lark ตรวจจำนวนจริงหลัง rerun แล้ว: RAW Channel 1, RAW Video 2, RAW Analytics 0, Account 1, Content 2 และ Daily 2 โดยไม่เกิด Duplicate
- ไม่เปลี่ยน YouTube จาก `uat_pending` เป็น `active`
- ไม่เปิด Schedule, Meta หรือ Production

## Required DEV inputs outside Source control

- `YOUTUBE_CHANNEL_ID` ของช่องที่ได้รับอนุญาตให้ทดสอบ
- `YOUTUBE_API_KEY` สำหรับ Public Data API หรือ OAuth credential ที่ใช้แทน
- Owner Analytics OAuth: client ID, client secret และ refresh token เมื่อต้องทดสอบ Analytics
- Lark App credential/app token และ Local Table IDs หลัง Schema Apply
- Secrets ต้องอยู่ใน `.dev.vars`, Cloudflare Secrets หรือ Secret Manager เท่านั้น

## Live execution order

1. เติม Local credentials และ Channel allowlist
2. `npm run preflight:youtube`
3. `npm run setup:youtube-schema` เพื่อ Preview
4. ตรวจ Plan แล้วใช้ `CONFIRM_WRITE=YES npm run setup:youtube-schema:apply`
5. ใส่ Table IDs ที่คืนมาใน ignored `wrangler.sync.jsonc`
6. Deploy DEV Worker โดย UAT flag เท่านั้น; normal YouTube flag และ Schedule คง false
7. Enqueue Manual UAT job จาก `npm run job:youtube-uat`
8. ทดสอบ First sync, idempotent rerun, incremental, full reconciliation, Analytics missing-key, identity mismatch, quota/rate-limit, D1 alert failure, lock/retry/DLQ และข้อมูลใน Lark
9. เปลี่ยน Connector เป็น `active` และออกแบบ Schedule เฉพาะหลัง Live DEV UAT ผ่าน

## Acceptance and verification

- Unit/Integration: 377/377 passed
- Workers runtime: 6/6 passed
- Focused Report reliability: 53/53 passed
- Focused YouTube/Reliability/Redaction: 37/37 passed
- Architecture: 109 source files / 230 local dependencies / 0 cycles
- Repository hygiene: passed
- npm audit: 0 vulnerabilities
- Wrangler dry-run: 444.06 KiB / gzip 90.94 KiB passed
- Clean archive extraction retest: `npm ci`, check, Unit 376/376, Workers 6/6, reliability 53/53, audit 0 และ dry-run ผ่าน; Archive verifier พบ blocked/missing/sensitive/duplicate = 0
- Live DEV UAT: `core_happy_path_passed_reliability_fault_cases_pending`

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

## Work review

- **Technical architecture:** approved for Manual DEV UAT
- **Data model:** approved — Blueprint v0.10.2
- **Release decision:** package as `v0.11.0-rc.1`; do not promote YouTube to active
- **Recommended commit for current delta:** `fix: localize YouTube Lark schema presentation`
