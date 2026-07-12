# 10 — Next Actions

## Deploy/UAT v0.6.0 TikTok Incremental Sync

1. Apply D1 migration `0003_incremental_sync.sql` กับ Remote DEV:

```bash
npx wrangler d1 migrations apply MKT_STATE_DB --remote --config wrangler.sync.jsonc
```

2. ตรวจว่ามี `sync_cursors` และ `source_record_states`
3. Deploy `v0.6.0-tiktok-incremental-sync` โดยเปิด:

```env
MKT_SCHEDULE_TIKTOK_ENABLED=true
MKT_TIKTOK_INCREMENTAL_ENABLED=true
MKT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS=86400000
```

4. รอบแรกหลัง migration ต้องเป็น `mode=full`, `reason=initial_checkpoint`, `checkpointSaved=true`
5. รอบถัดไปวันเดียวกันและ RAW ไม่เปลี่ยนต้องเป็น `mode=incremental`, `reason=no_source_changes`, `selectedRecords=0`, Content/Daily เขียน 0
6. แก้ Metric ของ RAW DEV หนึ่งรายการอย่างปลอดภัย แล้วตรวจว่ารอบถัดไปเลือก/อัปเดตเฉพาะรายการนั้น
7. ตรวจ D1 cursor/record states และยืนยันว่าไม่มี Lock ค้างหรือ Alert ใหม่
8. ปล่อย Scheduled Sync อย่างน้อย 3 รอบหลัง Incremental UAT

## งานหลักหลังข้อ 6 เสร็จ

1. TikTok Metrics + Report: seed metric definitions, aggregation, daily/weekly report snapshots
2. Lark AI Summary/Insight/Recommendation + Group Notification และ delivery status
3. ออกแบบ Data Model/Lark Blueprint ของ Facebook + Instagram ก่อนเขียน Connector
4. YouTube Blueprint/Connector
5. WooCommerce Blueprint/Connector
6. Chatwoot Blueprint/Connector
7. UAT รวมบน DEV/Staging
8. Production setup ใน Lark/Cloud/Platform assets ที่ Chemistry K เป็นเจ้าของ

## งานเสริมที่ยังค้าง

- Benchmark 10x/100x และประเมิน Lark API rate limit
- ยืนยัน Lark Cell-clear contract สำหรับ Classification field clearing
- เพิ่ม server-side modified-time filter เมื่อ Source contract ของ Lark Native table รองรับแบบที่ตรวจสอบได้

ห้ามเปิด Feature flag ของ Connector ที่ยังเป็น `planned` ก่อน Data Model, Source contract, Stable key, Metric definition และ Test fixture ผ่าน
