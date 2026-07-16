# Social Marketing Data Integration

ระบบรวมข้อมูล Social Marketing เข้าสู่ Lark Base สำหรับ Daily Snapshot, Dashboard, AI Summary และ Alert โดยใช้ JavaScript ES Modules, Cloudflare Workers/Queues และ Lark Open API

## Baseline ปัจจุบัน

Working candidate: `v0.11.0-rc.1`

Official clean baseline: `v0.10.2-multi-channel-foundation-approved`

สถานะปัจจุบัน:

- DEV ใช้ Lark Base ของผู้พัฒนาและ TikTok `@ft.pumkin`
- Production profile `chemistry_k` เตรียมไว้ใน Source code แต่ Production จริงต้องใช้ Lark Base, App, Cloud และบัญชี Social ที่ลูกค้าเป็นเจ้าของ
- TikTok DEV Sync จริงผ่าน 20 Content + 20 Daily Snapshot แล้วก่อน Audit รอบนี้
- v0.4.0 ผ่าน Live DEV gate แล้ว: รันซ้ำได้ `created=0`, `updated=0`, `skipped=20` ทั้ง Content และ Daily
- v0.6.0 เพิ่ม D1 checkpoint/fingerprint สำหรับ TikTok Incremental Sync: รอบปกติส่งเฉพาะ RAW records ที่เปลี่ยนเข้าสู่ Destination plan/write และบังคับ Full reconciliation ทุก 24 ชั่วโมง
- Live Cloudflare DEV ผ่าน Sync Log, Reconciliation, Distributed Lock, Retry/DLQ/System Alert และ Scheduled Sync ต่อเนื่อง 3 รอบแล้ว
- v0.7.1 ซ่อม Report/Lock reliability: แยก failed กับ partial_success ตาม write progressจริง, ทำ Top Content limit ให้สอดคล้องและล้างอันดับเก่า, ตรวจ lease expiry, รักษา partial progress ระหว่าง chunk, จำแนก Lark 1254290 ถูกต้อง และป้องกัน Local lock renewal race
- v0.7.2 ล็อก Scheduled Report ให้ใช้ “วันสมบูรณ์ล่าสุด” จาก `scheduledTime` ตาม Timezone พร้อม regression tests สำหรับข้ามเดือน/ปี/ปีอธิกสุรทิน และจัด Release package ให้ไม่มี Local Wrangler config หรือ macOS metadata
- v0.8.0 เพิ่ม Lark Report Schema Installer แบบ Preview/Apply, Idempotent, ไม่ลบ Schema เดิม, Fail-closed เมื่อชน Field type และสร้าง 2 ตาราง Report output ผ่าน OpenAPI
- v0.8.2 แก้ `WrongRequestBody` ของ Number field: Schema ใช้ Lark OpenAPI formatter enum (`1,000`, `0.0000`) และ Contract กลางแปลง legacy formatter ก่อน Create/Update
- v0.8.1 แก้ `CheckboxFieldPropertyError`: Preview เป็น Read-only เสมอแม้ Shell มี `CONFIRM_WRITE=YES`, Apply ต้องใช้คำสั่งแยก, และ Field payload ใช้เฉพาะ OpenAPI property keys ที่รองรับ
- TikTok Organic DEV Daily/Weekly Report ผ่าน Live UAT, idempotency, partial-baseline, stale-rank cleanup/restore และ report lock retry แล้ว
- v0.9.0 เพิ่ม Client View installer และ guarded local schedule activator เพื่อปิดงานโดยไม่แก้ Lark/Config ด้วยมือเกินจำเป็น
- v0.9.1–v0.9.3 เป็นการแก้ตามสมมติฐานทีละจุด แต่ Live tenant ยังปฏิเสธ combined View PATCH ด้วย `1254001`; จึงไม่ถือว่าสาเหตุใดได้รับการยืนยันจาก Live Apply
- v0.9.5 แก้ View PATCH ตาม request contract จริง: ไม่ส่ง response-only `field_type`/`condition_omitted`, ส่ง Checkbox เป็น `[true]`, และใช้ Get View ตรวจ Filter เพราะ List Views ของ tenant ไม่คืน `property`
- Live Apply สร้าง/อัปเดต Client Views ครบ 6 รายการ ติดตั้ง Filter และ Hidden fields แล้ว และ Final Preview เป็น `create=0`, `update=0`, `conflicts=0`
- Lark UI บันทึก Sort `rank` แบบ `0 → 9` พร้อม Automatic sorting ครบทั้ง 6 Views แล้ว
- เปิด Advanced Permissions และสร้าง `Client` role แล้ว: ตาราง Report outputs เป็น View only; Daily/AI technical/Sync/System/RAW tables เป็น No access. DEV ยังไม่ Assign สมาชิกให้ role นี้
- Daily/Weekly schedules เปิดและ deploy ไปยัง `social-mkt-sync-worker` แล้วเมื่อ 2026-07-14
- v0.9.6 เป็น Clean handoff baseline: ไม่มี Local Wrangler config, Secret, macOS metadata หรือ build artifacts ใน Release ZIP
- v0.9.7 เพิ่ม Shared Work/Codex workflow ผ่าน `AGENTS.md` และ `docs/current-task.md`; Repository hygiene บังคับไม่ให้สองไฟล์นี้หายจาก Release
- v0.10.0 เพิ่ม Multi-channel foundation ทั้ง 6 ส่วน: YouTube Organic Blueprint/client/normalization, Canonical Organic core, Meta Graph transport, WooCommerce/Chatwoot sanitized contracts และ Canonical Ads model
- v0.10.1 ตรวจทาน Foundation: ถอด `maxResults` จาก `videos.list(id)`, แยก `quotaExceeded` ออกจาก Short retry, แยก Ads `Ad`/`Creative`, ใช้ integer micros เป็น Money source of truth และเพิ่ม Excel/Lark Blueprint ที่ตรวจภาพครบ
- v0.10.2-rc.2 ปิด Blueprint/Release review gaps: YouTube preflight บังคับ `MKT_Accounts` และ RAW/Content/Daily tables, Example config fail-closed และ Clean ZIP มี Allowlist/Blocklist + Secret/DEV ID/Duplicate verification
- YouTube Blueprint v0.10.2 rc.2 แก้ latest-state Channel/Video, hidden subscriber, non-destructive reconciliation, Pacific-day Analytics, explicit `sort=day,video`, missing-row semantics และ field-by-field Canonical mapping; Owner Analytics คง RAW-only ใน Phase 1
- v0.11.0-rc.1 เพิ่ม YouTube guarded Schema installer, DEV access preflight, RAW/Canonical/Account writes, Manual Queue route, D1 checkpoint, reconciliation และ Reliability reuse; YouTube ยังคง `uat_pending` และไม่มี Schedule
- DEV Public/Owner preflight และ Lark Schema Apply สำหรับ YouTube RAW 3 ตารางผ่านแล้วเมื่อ 2026-07-17; ตารางจริงมีไอคอนและอยู่ในหมวด RAW พร้อม Field info ภาษาไทยครบ 42 ฟิลด์; Manual Queue UAT, Deployment และ Schedule ยังไม่เริ่ม
- v0.11.0-rc.1 hardening เติม Analytics missing-key reconciliation แบบ retain/warn, บังคับ D1 warning alert failure ให้ Queue retry, Redact external identity จาก operational logs/stores และคืน safe examples เป็น Placeholder-only
- Connector อื่นยังไม่ถูกเปิด: Meta/WooCommerce/Chatwoot/Ads เป็น `planned` จนกว่า Blueprint/Access/Live UAT ของแต่ละช่องทางผ่าน
- Customer Production setup ยังไม่รวมใน Release นี้และต้องใช้ทรัพยากรของลูกค้า
- v0.11.0-rc.1 hardened source gate ผ่าน Unit/Integration 376/376, Workers runtime 6/6, Report reliability 53/53, Architecture 109/230/0, hygiene, audit 0 และ Wrangler dry-run 443.78 KiB / gzip 90.89 KiB
- YouTube Lark presentation correction ผ่าน focused 53/53 และ full Unit/Integration 377/377; Workers 6/6, Reliability 53/53, Architecture/Hygiene/Audit และ Wrangler dry-run 444.06/90.94 KiB ผ่าน พร้อม Final Live Preview เป็นศูนย์ drift
- Fresh ZIP extraction ผ่าน gates ชุดเดียวกัน และ Archive verifier ไม่พบ blocked path, missing required path, sensitive finding หรือ duplicate artifact

รายละเอียด Contract และ Activation gates: `docs/multi-channel-foundation-v0.10.1.md`

Excel/Lark review Blueprint: `docs/Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx`

Blueprint v0.10.2 ผ่าน Technical review และเป็น Foundation baseline แล้ว. DEV access preflight และ guarded Schema Apply ผ่านแล้ว; Source v0.11.0-rc.1 รอ Deploy แบบ UAT-only และ Manual Queue Live UAT โดย Schedule และ Production ยังคงปิด

สร้างและตรวจ Clean candidate:

```bash
npm run release:package
npm run release:verify -- outputs/releases/social-marketing-integration-v0.11.0-rc.1.zip
```

Archive/Manifest/SHA-256/Verification report ถูกสร้างใน `outputs/releases/` ซึ่งเป็น Local artifact และไม่ Commit

## Shared workflow ระหว่าง ChatGPT Work และ Codex

ก่อนเริ่มงานใหม่ให้อ่านตามลำดับ:

```text
AGENTS.md
→ docs/current-task.md
→ PROJECT_BRAIN.md
→ docs/project-brain/* ที่เกี่ยวข้อง
→ Source code และ Tests
```

- `AGENTS.md` เก็บกฎถาวร, Definition of Done, Data-model-first, Secret/Environment และ Live API verification rules
- `docs/current-task.md` เก็บ Scope/Contract/Acceptance criteria ของงานปัจจุบัน และเป็นจุดที่ Codex บันทึก Files changed, Tests, Commands, UAT และ Remaining risks กลับมาให้ Work ตรวจ
- งาน Connector ห้ามเริ่ม Coding จน Current task ระบุ Technical approval; งานที่แตะ Credential, Live resources, Schedule หรือ Production ต้องผ่าน Gate แยกและบันทึกหลักฐาน

## TikTok Organic DEV Closeout v0.9.6

เอกสารปิดงานหลักอยู่ที่ `docs/tiktok-organic-dev-complete-v0.9.6.md`; หลักฐาน Live UAT เดิมอยู่ที่ `docs/tiktok-organic-dev-closeout-v0.9.0.md` และรายละเอียด View PATCH ที่ยืนยันกับ Live tenant อยู่ที่ `docs/lark-report-view-live-fix-v0.9.5.md`. เอกสาร v0.9.1–v0.9.4 เก็บไว้เป็นประวัติของสมมติฐานก่อนยืนยันสาเหตุจริง.

ติดตั้ง/ตรวจ Client Views:

```bash
npm run setup:report-views
CONFIRM_WRITE=YES npm run setup:report-views:apply
npm run setup:report-views
```

เปิด Daily/Weekly report schedules ใน local config หลัง View ผ่าน:

```bash
npm run enable:tiktok-report-schedules
CONFIRM_WRITE=YES npm run enable:tiktok-report-schedules:apply
npx wrangler deploy --config wrangler.sync.jsonc
```

Preview ทั้งสองคำสั่งเป็น Read-only เสมอ. View installer สร้างชื่อ/ชนิด View แล้ว PATCH Filter กับ Hidden fields แยก request. Sort `rank` ascending และ Advanced Permissions ถูกตั้งและตรวจใน Lark UI แล้วเมื่อ 2026-07-14; `manualActions` ยังแสดงเป็น checklist เพราะ View OpenAPI ไม่คืน Sort และ role-permission state. Customer Production ยังต้อง Assign สมาชิกจริงด้วยทรัพยากรของลูกค้า.

Focused Report gate:

```bash
npm run test:report-reliability
```

## Lark Report Schema Installer v0.8.2

อ่านรายละเอียดที่ `docs/lark-report-schema-installer-v0.8.2.md`

Preview แบบ Read-only:

```bash
npm run setup:report-schema
```

Apply หลัง Preview มี `readyToApply: true`:

```bash
CONFIRM_WRITE=YES npm run setup:report-schema:apply
```

Installer ครอบคลุม 5 ตาราง Report, สร้างเฉพาะส่วนที่ขาด, เติม Select options โดยไม่ลบของเดิม และคืน Table IDs ผ่าน `environmentUpdates`. Preview command ไม่เขียนข้อมูลแม้ Environment มี `CONFIRM_WRITE=YES`; การ Apply ต้องระบุทั้ง `setup:report-schema:apply` และ `CONFIRM_WRITE=YES`. หาก v0.8.0 เขียนไปบางส่วนก่อนพบ Error ให้รัน Preview ใหม่แล้ว Installer จะวางแผนเฉพาะส่วนที่เหลือ. Report schedules ต้องคง `false` จน Schema/Seed/Manual UAT ผ่าน.

## TikTok Organic Report v0.7.2

Report Engine อ่าน cumulative snapshots จาก `MKT_Content_Daily` แล้วคำนวณ Delta ของช่วงเวลา; ห้ามนำยอดสะสมแต่ละวันมาบวกกันตรง ๆ. ลูกค้าใช้ Client Views จาก `MKT_Report_Metric_Values` และ `MKT_Report_Top_Content` ส่วน RAW/Daily/Sync/System tables เป็นหลังบ้าน.

ก่อนเปิด Report schedule ต้องอ่าน `docs/completed-report-period-v0.7.2.md`, `docs/report-reliability-hardening-v0.7.1.md` และทำตาม `docs/tiktok-organic-report-blueprint-v0.7.0.md` และ Excel Blueprint ที่แนบมากับ Release:

1. เพิ่ม Field ของตาราง Report เดิมและสร้าง 2 ตารางใหม่
2. ใส่ Table IDs ใหม่ใน Runtime config
3. Seed Metric definitions และ Report settings
4. Manual Queue UAT Daily/Weekly และ rerun idempotency
5. จึงเปลี่ยน `MKT_SCHEDULE_DAILY_REPORT_ENABLED` / `MKT_SCHEDULE_WEEKLY_REPORT_ENABLED` เป็น `true`

คำสั่ง Seed หลัง Schema พร้อม:

```bash
CONFIRM_WRITE=YES npm run seed:metrics
MKT_CUSTOMER_PROFILE=dev_ft_pumkin CONFIRM_WRITE=YES npm run seed:report-settings
```

## Cloudflare DEV/Staging deployment gate

ก่อน Deploy จริงให้คัดลอก `wrangler.sync.example.jsonc` เป็นไฟล์ local ที่ไม่ Commit แล้วแทน D1 ID, Queue names และ Table IDs ของ DEV. หาก Repository เดิมเคย Track ไฟล์นี้ ต้องเอาออกจาก Git index หนึ่งครั้งโดยไม่ลบไฟล์ในเครื่อง:

```bash
git rm --cached wrangler.sync.jsonc
cp -n wrangler.sync.example.jsonc wrangler.sync.jsonc
chmod 600 .dev.vars
npm ci
npm run check
npm test
npm run deploy:dry-run
```

`wrangler.sync.example.jsonc` เปิด Workers Logs/Traces สำหรับ DEV observability แล้ว ส่วน `wrangler.sync.jsonc` เป็น local-only และจะถูก Repository hygiene gate ปฏิเสธหากยังถูก Track. การแก้ `.guard` ค้างของ Local file lock ต้องทำตาม `docs/local-file-lock-guard-runbook-v0.7.2.md` เท่านั้น.

จากนั้นสร้าง D1/Queues, apply migrations และใส่ Secrets ผ่าน Wrangler โดยไม่เก็บ Secret ใน Source code รายละเอียดอยู่ใน `deploy/README.md`, `docs/cloudflare-deploy-hardening-v0.5.1.md` และ `docs/tiktok-incremental-sync-v0.6.0.md`

## โครงสร้างระบบ

```text
apps
  ├─ api-worker       HTTP health/status
  └─ sync-worker      Scheduled/Queue jobs

packages
  ├─ domain           Entity และ Value object ที่ไม่พึ่ง Infrastructure
  ├─ application      Use case, Connector registry และ Queue job contract
  ├─ sync-engine      Plan/Diff/Execute แบบ Storage-neutral
  ├─ connectors       Lark, TikTok, YouTube foundation, Meta transport และ source contracts
  ├─ config           Customer profile, table mapping และ build info
  ├─ reliability      Sync run, D1/Lark stores, lease lock และ recovery orchestration
  └─ shared           Date, Error และ HTTP utilities กลาง
```

Dependency direction หลัก:

```text
apps -> application/domain/config
application -> domain/shared + connector ports/adapters ที่ประกอบจาก Runtime
connectors -> shared
sync-engine -> repository contract
```

## Dev และ Production

เลือก Environment ผ่านค่า Runtime โดยไม่แก้ Source code

DEV:

```env
MKT_ENV=development
MKT_CUSTOMER_PROFILE=dev_ft_pumkin
```

Production ของ Chemistry K:

```env
MKT_ENV=production
MKT_CUSTOMER_PROFILE=chemistry_k
```

Connector feature flags:

```env
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_CONNECTOR_YOUTUBE_ENABLED=false
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_CONNECTOR_CHATWOOT_ENABLED=false
```

Connector ที่ยังเป็น `planned` เปิดไม่ได้แม้ตั้งค่า `true` เพื่อป้องกันโค้ดโครงรอถูกใช้งานเป็น Production โดยไม่ตั้งใจ

TikTok handle จริงเปลี่ยนผ่าน Environment ได้โดยไม่แก้ Source code:

```env
TIKTOK_SOURCE_HANDLE=ft.pumkin
```

ข้อมูลที่ไม่เป็นความลับ เช่น Customer key, Stable account key, Feature mapping และคำอธิบายภาษาไทยเก็บใน `packages/config/src/customer-profiles.js`

Secret ทั้งหมดต้องอยู่ใน `.dev.vars`, Cloudflare Secret หรือ Secret Manager ของลูกค้า:

```text
LARK_APP_ID
LARK_APP_SECRET
LARK_APP_TOKEN
API keys / access tokens / webhook secrets / passwords
```

## ตั้งค่า Local DEV

```bash
cp .dev.vars.example .dev.vars
```

กำหนดค่าอย่างน้อย:

```env
MKT_ENV=development
MKT_CUSTOMER_PROFILE=dev_ft_pumkin
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_CONNECTOR_YOUTUBE_ENABLED=false
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_CONNECTOR_CHATWOOT_ENABLED=false
TIKTOK_SOURCE_HANDLE=ft.pumkin

LARK_APP_ID=...
LARK_APP_SECRET=...
LARK_APP_TOKEN=...

LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS=...
LARK_TABLE_MKT_CONTENT=...
LARK_TABLE_MKT_CONTENT_DAILY=...
LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY=...
LARK_TABLE_MKT_SYNC_LOG=...
LARK_TABLE_MKT_SYSTEM_ALERTS=...

MKT_SYNC_LOCK_LEASE_MS=600000
MKT_LOCAL_LOCK_DIR=.mkt-locks
```

`.dev.vars` ต้องไม่ Commit และไม่รวมใน ZIP Release

## คำสั่งตรวจและ Sync

ตรวจ Code:

```bash
npm test
npm run check
```

Dry run ด้วยเส้นทางเดียวกับ Production write path:

```bash
npm run validate:tiktok
```

Write จริงหลัง Dry run ผ่าน:

```bash
CONFIRM_WRITE=YES npm run sync:tiktok
```

Seed Metric definitions:

```bash
CONFIRM_WRITE=YES npm run seed:metrics
```

กำหนด Snapshot date เฉพาะรอบ:

```bash
METRIC_DATE=2026-07-11 npm run validate:tiktok
METRIC_DATE=2026-07-11 CONFIRM_WRITE=YES npm run sync:tiktok
```



## Reliability Layer

ทุก Write sync ถูกครอบด้วยวงจรเดียวกัน:

```text
sync_run_id
→ lease lock
→ MKT_Sync_Log=running
→ Prepare/Preflight
→ Execute Content + Daily
→ success / partial_success / failed
→ MKT_System_Alerts เมื่อจำเป็น
→ release lock
```

Local ใช้ file lock กันหลาย Process บนเครื่องเดียวกัน ส่วน Cloudflare ใช้ D1 binding `MKT_STATE_DB` เป็น Distributed lease lock และ operational state store

Automatic reconciliation ใช้ Stable key ตรวจว่าฝั่ง Content หรือ Daily ขาด แล้วสร้างเฉพาะส่วนที่ขาด รอบที่เกิด Partial write จะถูกบันทึกเป็น `partial_success` และ Retry ได้โดยไม่สร้างฝั่งที่สำเร็จแล้วซ้ำ

Cloudflare Queue ต้องกำหนด Dead Letter Queue ชื่อเดียวกับ `MKT_DLQ_QUEUE_NAME` Message ที่ Retry ครบจะถูกเก็บใน D1 `dead_letter_jobs` และสร้าง Critical alert โดย DLQ consumer จะไม่ Execute งานเดิมซ้ำ

### TikTok Incremental Sync

เปิดผ่าน Wrangler vars:

```env
MKT_TIKTOK_INCREMENTAL_ENABLED=true
MKT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS=86400000
```

D1 เก็บ Cursor และ SHA-256 fingerprint ใน `sync_cursors`/`source_record_states` หลัง Content และ Daily เขียนสำเร็จเท่านั้น รอบปกติที่ข้อมูลไม่เปลี่ยนจะไม่โหลด Schema, ค้น Destination หรือเขียน Content/Daily ส่วนวันใหม่, Dictionary เปลี่ยน, Source record หาย หรือครบ 24 ชั่วโมงจะบังคับ Full reconciliation อัตโนมัติ

ข้อจำกัดที่ตั้งใจไว้: Lark Native RAW table ยังถูกอ่านครบทุกหน้าเพื่อยืนยัน Source identity และตรวจ Record ที่ถูกลบ แต่ Destination workload เป็น Incremental จริง โดยประมวลผลเฉพาะ Record fingerprint ที่เปลี่ยน

ก่อน Deploy v0.6.0 ให้ Apply migration:

```bash
npx wrangler d1 migrations apply MKT_STATE_DB --remote --config wrangler.sync.jsonc
```

รายละเอียด: `docs/cloudflare-deploy-hardening-v0.5.1.md` และ `docs/tiktok-incremental-sync-v0.6.0.md`

## Multi-channel Foundation

Connector ที่ลงทะเบียนใน Catalog กลาง:

| Connector | Implementation | Default |
|---|---|---|
| TikTok | active | enabled |
| Facebook Page | planned | disabled |
| Instagram Business | planned | disabled |
| YouTube | uat_pending | disabled |
| WooCommerce | planned | disabled |
| Chatwoot | planned | disabled |

ไฟล์หลัก:

```text
packages/config/src/connector-catalog.js
packages/config/src/connector-runtime-config.js
packages/application/src/connectors/connector-registry.js
packages/application/src/jobs/job-catalog.js
packages/application/src/jobs/queue-job.js
```

Queue schema ปัจจุบันคือ version `1` และ Job เดิมที่ไม่มี `schemaVersion` ยังรองรับโดย Normalize เป็น version `1` อัตโนมัติ Job ที่รู้จักแต่ยังไม่ Implement จะหยุดด้วย Permanent error ก่อนโหลด Lark credentials และจะไม่คืน Fake success

Health endpoint แสดงเฉพาะ `implementationStatus`, `enabled` และ `runnable` ของแต่ละ Connector โดยไม่เปิดเผย Account key, Handle, Customer profile หรือ Secret

## Safety ของ TikTok Sync

ก่อนเริ่มเขียน ระบบจะทำตามลำดับ:

1. อ่าน RAW TikTok และ Classification Dictionary
2. Normalize ทุกแถวและตรวจ Metric/URL/Date/Video ID แบบไม่เสีย precision
3. ตรวจ Source handle ให้ตรง Customer profile
4. ตรวจ Destination identity conflict ทั้ง Account และ Stable key เก่าจาก `platform + external_content_id`
5. โหลด Schema จริงของ Content และ Daily
6. Serialize/Preflight ทั้งสองตาราง
7. ค้น Existing record ด้วย Stable Key และสร้าง Create/Update/Skip plan
8. เมื่อทุกขั้นผ่านจึง Execute Content และ Daily

Stable keys:

```text
MKT_Content       tiktok:<account_key>:<video_id>
MKT_Content_Daily tiktok:<account_key>:<video_id>:<YYYY-MM-DD>
```

DEV:

```text
tiktok:ft_pumkin:<video_id>
```

Production Chemistry K:

```text
tiktok:chemistry_k:<video_id>
```

## Retry และ Idempotency

- Read/Update requests Retry เฉพาะ Error ชั่วคราว
- Batch Create Retry ภายใน Request เฉพาะ Rate limit ที่ Lark ตอบกลับชัดเจน
- Timeout/Network/5xx ที่ผล Create อาจกำกวมจะส่งกลับให้ Queue เริ่ม Job ใหม่
- Job ใหม่ต้อง Re-plan จาก Stable Key ก่อนเขียน จึงเติมเฉพาะส่วนที่ขาดและลดความเสี่ยงสร้างข้อมูลซ้ำ
- Partial write ถูกบันทึกเป็น `partial_success` พร้อม `sync_run_id` และ Critical alert
- Cloudflare ใช้ D1 lease lock ป้องกันหลาย Invocation เขียน Account เดียวกันพร้อมกัน
- Permanent error เช่น Schema, Config, Source mismatch และ Invalid job จะไม่ Retry วน
- Transient error ที่ Retry ครบจะเข้าสู่ DLQ และถูกเก็บใน D1

Lark ไม่มี Transaction ข้าม `MKT_Content` และ `MKT_Content_Daily` ดังนั้น Network failure หลังตารางแรกสำเร็จยังอาจเกิด Partial write ได้ การรัน Job เดิมซ้ำจะ Reconcile ด้วย Stable Key และเติมเฉพาะส่วนที่ขาด

## Lark Classification Dictionary

`MKT_Classification_Dictionary` เป็น Source of truth ของคำธุรกิจ เช่น Course, Level, Theme, Funnel, CTA, Promotion และ Urgency

Field ที่อ่าน:

```text
rule_key
target_field
output_value
aliases
match_type
platform
applies_to
priority
confidence
enabled
note
```

เมื่อไม่มี Rule Match ระบบไม่เดาค่า แต่กำหนด:

```text
manual_tag_note = manual_review: no enabled dictionary rule matched
classification_confidence = 0.2
```

## Deployment

- API Worker example: `wrangler.example.jsonc`
- Sync Worker example: `wrangler.sync.example.jsonc` (อยู่ root เพื่อให้ path ของ entrypoint/migrations ตรงกัน)
- Deployment notes: `deploy/README.md`
- Full audit baseline: `docs/full-codebase-audit-v0.3.1.md`
- Multi-channel foundation: `docs/multi-channel-foundation-v0.4.0.md`
- Production checklist: `docs/PRODUCTION_CHECKLIST.md`
- Source of truth: `PROJECT_BRAIN.md`

## Definition of Done

Release จะยังไม่ถือว่าเสร็จจนกว่า Test, Syntax check, Secret scan, ZIP extraction test, DEV Dry run, Idempotency rerun และเอกสารหลักจะผ่านครบ
