# 00 — Current State

## Baseline

`v0.5.0-reliability-layer` — 2026-07-11

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

## เพิ่มใน v0.5.0

- `sync_run_id` ต่อหนึ่งรอบ Sync
- Lifecycle `running`, `success`, `partial_success`, `failed`, `skipped`
- Mirror ไป `MKT_Sync_Log` ด้วย Schema ที่มีอยู่แล้ว
- Mirror Alert ไป `MKT_System_Alerts`
- D1 operational tables: `sync_runs`, `sync_locks`, `dead_letter_jobs`, `system_alerts`
- D1 atomic lease lock สำหรับ Cloudflare Worker หลาย invocation
- Local file lease lock สำหรับหลาย Terminal/Process บนเครื่องเดียวกัน
- Automatic reconciliation ระหว่าง `MKT_Content` และ `MKT_Content_Daily`
- Retryable `SYNC_PARTIAL_WRITE` พร้อมผล Content ที่เขียนสำเร็จแล้ว
- Cloudflare Dead Letter Queue consumer ที่ Persist โดยไม่ Execute งานเดิมซ้ำ
- Secret-like key redaction ก่อนเก็บ payload/details ใน D1

## Package gate

- Tests ต้องผ่านทั้งหมด
- Syntax checks ต้องผ่าน
- Architecture audit ต้องมี 0 cycles
- Migration SQL ต้อง parse/apply ได้
- ZIP ต้องไม่มี `.dev.vars`, Secret, `.mkt-locks`, `node_modules` หรือ build artifact

## Live DEV gate สำหรับ v0.5.0

1. เพิ่ม Table IDs ใน `.dev.vars`
2. `npm run validate:tiktok`
3. `CONFIRM_WRITE=YES npm run sync:tiktok`
4. ตรวจ `MKT_Sync_Log` มีสถานะ `running` แล้วเปลี่ยนเป็น `success`
5. รันซ้ำและยืนยัน Content/Daily ยังไม่สร้างหรือ Update ซ้ำ
6. ทดสอบ Local lock ด้วยการรัน Write สอง Terminal พร้อมกัน: หนึ่งรอบทำงาน อีกหนึ่งรอบต้อง `SYNC_LOCK_BUSY`
7. ทดสอบ Error แบบปลอดภัยใน DEV และตรวจ `MKT_System_Alerts`

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
- D1 lease ยังไม่มี renewal heartbeat ต้องตั้ง Lease ยาวกว่าระยะ Sync สูงสุด
- Local file lock ไม่ครอบ Cloudflare ต้องห้าม Local write เมื่อ Cloud Cron ใช้ Base เดียวกัน
- RAW/Dictionary ยังเป็น Full-source read
- Classification field ที่กลายเป็นค่าว่างยังไม่ล้างค่าเก่าใน Larkจนกว่าจะยืนยัน Cell-clear contract
- Connector ที่เป็น `planned` ยังไม่มี API/Source contract/Blueprint และห้ามเปิดใช้
- Chemistry K Production ยังไม่ผ่าน customer-owned Cloudflare/Lark deployment
