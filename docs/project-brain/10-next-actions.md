# 10 — Next Actions

## Gate ทันทีหลังติดตั้ง v0.5.0

รักษา Feature flag เดิมของ DEV และเพิ่ม Table IDs ที่ Reliability layer ใช้:

```env
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_CONNECTOR_YOUTUBE_ENABLED=false
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_CONNECTOR_CHATWOOT_ENABLED=false
TIKTOK_SOURCE_HANDLE=ft.pumkin

LARK_TABLE_MKT_SYNC_LOG=tblpgnHODi8MIcso
LARK_TABLE_MKT_SYSTEM_ALERTS=tbl5Cq9iVkWTFdA4
MKT_SYNC_LOCK_LEASE_MS=600000
MKT_LOCAL_LOCK_DIR=.mkt-locks
```

จากนั้นรัน:

```bash
npm install
npm test
npm run check
npm run validate:tiktok
CONFIRM_WRITE=YES npm run sync:tiktok
CONFIRM_WRITE=YES npm run sync:tiktok
```

ต้องยืนยัน:

- `MKT_Sync_Log` มี `sync_id` ใหม่ต่อหนึ่งรอบ และสถานะสุดท้ายเป็น `success`
- Content/Daily รอบที่สอง `created=0`, `updated=0`
- Source identity เป็น `ft.pumkin` และไม่มี Account conflict
- ผลลัพธ์มี `syncRunId` และ `reconciliation`

ทดสอบ Local lock ด้วยการเริ่ม Write สอง Terminal ใกล้กัน หนึ่งรอบต้องทำงาน อีกหนึ่งรอบต้องหยุดด้วย `SYNC_LOCK_BUSY` โดยไม่เขียน Content/Daily

## Cloudflare DEV/Staging ถัดไป

1. สร้าง D1 ของผู้พัฒนาและ Apply `migrations/0001_initial.sql` + `0002_reliability.sql`
2. สร้าง Queue หลักและ Dead Letter Queue ตาม `deploy/wrangler.sync.example.jsonc`
3. ตั้ง `MKT_STATE_DB`, Lark secrets, Table IDs และ DEV customer profile ใน Cloudflare ของผู้พัฒนา
4. Deploy Sync Worker
5. ทดสอบ Queue retry เฉพาะ Transient error
6. ทดสอบ D1 lease lock ด้วย Job ซ้ำพร้อมกัน
7. ทดสอบ Retry exhaustion แล้วตรวจ `dead_letter_jobs`, `system_alerts` และ Lark `MKT_System_Alerts`
8. เปิด Scheduled TikTok sync หลัง Reliability UAT ผ่าน
9. เพิ่ม Incremental cursor/window เมื่อ RAW source โตระดับหลักหมื่น
10. เพิ่ม lock renewal heartbeat ก่อนงานหนึ่งรอบมีโอกาสยาวเกิน Lease

## งานที่ทำคู่ขนานได้

- ออกแบบ Data Model/Lark Blueprint ของ Facebook + Instagram
- ออกแบบ Data Model/Lark Blueprint ของ YouTube
- ออกแบบ Data Model/Lark Blueprint ของ WooCommerce
- ออกแบบ Data Model/Lark Blueprint ของ Chatwoot
- กำหนด Source contract, Stable key, Metric definition และ Sample payload จริง
- เพิ่ม Test fixture หลังมี Payload/เอกสารจริงแล้ว

ห้ามเปิด Feature flag หรือเขียน API integration ก่อน Blueprint ของช่องทางนั้นผ่าน

## Product flow หลัง Connector core เสถียร

1. Facebook + Instagram
2. YouTube
3. WooCommerce
4. Chatwoot
5. Unified master/daily snapshots
6. Report aggregation
7. Lark AI summary/insight/recommendation
8. Lark Bot/Automation ส่งกลุ่มและเก็บ delivery status
9. UAT รวมบน DEV/Staging
10. Deploy Production ในทรัพยากรของ Chemistry K
