# 10 — Next Actions

## Gate ทันทีหลังติดตั้ง v0.4.0

ใน `.dev.vars` ให้ TikTok เปิดและช่องทางที่ยังไม่ Implement ปิดทั้งหมด:

```env
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_CONNECTOR_YOUTUBE_ENABLED=false
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_CONNECTOR_CHATWOOT_ENABLED=false
TIKTOK_SOURCE_HANDLE=ft.pumkin
```

จากนั้นรัน:

```bash
npm install
npm test
npm run check
npm run validate:tiktok
```

Dry run ต้องยืนยัน:

- `sourceIdentity.ok=true`
- Expected/detected handle เป็น `ft.pumkin`
- ไม่มี skipped rows, issues หรือ destination identity conflict
- Content/Daily schema preflight ผ่านทุกแถว
- Plan ใช้ `existingReadStrategy=filtered_keys`

เมื่อผ่านแล้ว:

```bash
CONFIRM_WRITE=YES npm run sync:tiktok
CONFIRM_WRITE=YES npm run sync:tiktok
```

รอบที่สองต้อง `created=0` และจำนวน Record เดิมไม่เพิ่ม

## Reliability ถัดไป

1. เขียน `MKT_Sync_Log` ต่อหนึ่ง Sync run พร้อม `sync_run_id`
2. เพิ่ม Reconciliation summary หลัง Partial write/retry
3. เพิ่ม Distributed lock/Unique reservation ก่อนอนุญาต Writer หลาย Runtime
4. เพิ่ม DLQ และ `MKT_System_Alerts` เมื่อ Queue Retry หมด
5. Deploy ขึ้น Cloudflare DEV/Staging ของผู้พัฒนา
6. เปิด Scheduled TikTok sync และทดสอบหลายรอบ
7. เพิ่ม Incremental cursor/window เมื่อ RAW source โตระดับหลักหมื่น
8. ยืนยัน Lark Cell-clear contract แล้วเพิ่มการล้าง Classification field ที่ไม่ Match อีกต่อไป

## งานที่ทำคู่ขนานได้หลัง Foundation นี้

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
