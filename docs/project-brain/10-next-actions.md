# 10 — Next Actions

## Gate ทันทีหลังติดตั้ง v0.3.1

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
2. เพิ่ม Distributed lock/Unique reservation ก่อนเปิด Queue concurrency มากกว่า 1 หรืออนุญาต Writer หลาย Runtime
3. เพิ่ม DLQ/System Alert สำหรับ Queue ที่ Retry หมด
4. เพิ่ม Reconciliation summary หลัง Partial write/retry
5. เพิ่ม Incremental cursor/window เมื่อ RAW source โตระดับหลักหมื่น
6. ยืนยัน Lark Cell-clear contract แล้วเพิ่มการล้าง Classification field ที่ไม่ Match อีกต่อไป
7. เพิ่ม Secured admin enqueue endpoint เมื่อ Authentication/Authorization พร้อม

## Product flow ถัดไปหลัง TikTok core เสถียร

1. Report aggregation จาก `MKT_Content_Daily`
2. `MKT_Report_Snapshots`
3. Lark AI summary/insight/recommendation
4. Lark Bot/Automation ส่งกลุ่มและเก็บ delivery status
5. WooCommerce/Chatwoot connector ตาม Data Model ที่ออกแบบเสร็จก่อน Implementation
