# 00 — Current State

## Baseline

`v0.5.3-cloudflare-fetch-context-fix` — 2026-07-12

## Environment ปัจจุบัน

- DEV Base เป็นของผู้พัฒนา
- TikTok source คือ `@ft.pumkin`
- `MKT_ENV=development`
- `MKT_CUSTOMER_PROFILE=dev_ft_pumkin`
- Production profile `chemistry_k` อยู่ใน Source codeแล้ว แต่ Production จริงยังไม่เปิดใช้งาน
- Production ต้องสร้างใน Lark, Cloudflare และบัญชี Platform ที่ลูกค้าเป็นเจ้าของ

## Verified Live DEV ก่อน Release นี้

Baseline v0.4.0 ผ่าน Live DEV idempotency gate:

- RAW TikTok: 20 rows
- รอบแรกหลัง Upgrade: Content/Daily update 20
- รอบที่สอง: Content/Daily `created=0`, `updated=0`, `skipped=20`
- Source identity: `@ft.pumkin`
- Account conflicts: 0
- Warnings: 0

## เพิ่ม/แก้ใน v0.5.1

- `sync_run_id` ต่อหนึ่งรอบ Sync
- Lifecycle `running`, `success`, `partial_success`, `failed`, `skipped`
- Mirror ไป `MKT_Sync_Log` ด้วย Schema ที่มีอยู่แล้ว
- Mirror Alert ไป `MKT_System_Alerts`
- D1 operational tables: `sync_runs`, `sync_locks`, `dead_letter_jobs`, `system_alerts` และ D1 เป็น Primary ที่ต้องสำเร็จก่อน Ack
- D1 atomic lease lock พร้อม owner-scoped renewal heartbeat สำหรับ Cloudflare Worker หลาย invocation
- Local file lease lock สำหรับหลาย Terminal/Process บนเครื่องเดียวกัน
- Automatic reconciliation ระหว่าง `MKT_Content` และ `MKT_Content_Daily`
- Chunk-aware `SYNC_PARTIAL_WRITE` พร้อมจำนวนแถว/Chunk ที่ยืนยันว่าเขียนสำเร็จแล้ว
- Main Queue/DLQ exact-name whitelist; DLQ persist อย่างเดียวและ Unknown Queue ถูก quarantine
- Secret-like key redaction ก่อนเก็บ payload/details ใน D1
- Root Wrangler config, Scheduled Queue producer, Workers-runtime tests และ CI dry-run

## Package gate

- Tests ต้องผ่านทั้งหมด
- Syntax checks ต้องผ่าน
- Architecture audit ต้องมี 0 cycles
- Migration SQL ต้อง parse/apply ได้
- ZIP ต้องไม่มี `.dev.vars`, Secret, `.mkt-locks`, `node_modules` หรือ build artifact

## Live DEV gate ที่ผ่านแล้ว

- Sync Log lifecycle ผ่าน
- Idempotency ผ่าน
- Recovery Daily ที่หาย 1 แถวผ่าน
- Local concurrent lock ผ่าน
- Source identity failure + System Alert ผ่าน

## Connector status

| Connector | Code status | Default runtime |
|---|---|---|
| TikTok | active | enabled |
| Facebook Page | planned | disabled |
| Instagram Business | planned | disabled |
| YouTube | planned | disabled |
| WooCommerce | planned | disabled |
| Chatwoot | planned | disabled |

## Known residual risks

- Lark ไม่มี Transaction ข้ามตาราง แต่ Partial write ตรวจพบ/Alert/Recovery ได้แล้ว
- Lease renewal มีแล้ว แต่ยังต้อง UAT กับ D1/Queue resource จริงบน Cloudflare DEV
- Local file lock ไม่ครอบ Cloudflare ต้องห้าม Local write เมื่อ Cloud Cron ใช้ Base เดียวกัน
- RAW/Dictionary ยังเป็น Full-source read
- Classification field ที่กลายเป็นค่าว่างยังไม่ล้างค่าเก่าใน Larkจนกว่าจะยืนยัน Cell-clear contract
- Connector ที่เป็น `planned` ยังไม่มี API/Source contract/Blueprint และห้ามเปิดใช้
- Chemistry K Production ยังไม่ผ่าน customer-owned Cloudflare/Lark deployment


## เพิ่ม/แก้ใน v0.5.2
- `package-lock.json` ใช้ `registry.npmjs.org` แทน Internal Artifactory ของสภาพแวดล้อมสร้างแพ็กเกจ
- Repository hygiene จะปฏิเสธ non-portable HTTPS registry host ใน lockfile


## เพิ่ม/แก้ใน v0.5.3
- Live Cloudflare Main Queue รับ `tiktok.creator.native.sync` และสร้าง `sync_run_id` ได้จริง
- Retry classification ทำงานจริงเมื่อ Lark request ล้มเหลวแบบชั่วคราว
- แก้ `LarkBitableClient` ไม่ให้เก็บ Global Fetch แล้วเรียกเป็น Method ของ Client ซึ่งทำให้ Runtime context ผิดบน Cloudflare Workers
- เพิ่ม regression test ตรวจว่า Default Global Fetch ถูก Bind กับ `globalThis`
- เพิ่ม `.dev.vars.example`, `.gitignore` และล้าง macOS metadata จาก Release package
- Distributed Lock concurrent UAT และ Retry-to-DLQ UAT ยังไม่ปิดจนกว่า Deploy รุ่นนี้และทดสอบ Live รอบใหม่
