# TikTok Incremental Sync v0.6.0

## เป้าหมาย

ลด Destination schema lookup, diff และ write ของ Scheduled TikTok Sync โดยประมวลผลเฉพาะ RAW records ที่ Fingerprint เปลี่ยน ขณะเดียวกันยังรักษา Source identity, deletion detection, idempotency และ Reconciliation เดิม

## Architecture

```text
Lark RAW TikTok + Classification Dictionary
→ normalize/validate ทุก Source row
→ SHA-256 fingerprint compare กับ D1 checkpoint
→ Full หรือ Incremental decision
→ Destination plan/write เฉพาะ selected records
→ Content + Daily สำเร็จ
→ D1 record states (chunked)
→ D1 cursor commit สุดท้าย
```

D1 tables จาก `migrations/0003_incremental_sync.sql`:

- `sync_cursors`: สถานะล่าสุดต่อ customer/platform/account/sync type
- `source_record_states`: fingerprint ต่อ RAW Lark record

## Safe Full conditions

ระบบบังคับ Full processing เมื่อ:

- ยังไม่มี checkpoint
- ผู้เรียกขอ `syncMode=full`
- Metric date เปลี่ยน
- Classification Dictionary เปลี่ยน
- Source record เดิมหายไป
- ครบ `MKT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS` (DEV default 24 ชั่วโมง)

## Commit และ Retry safety

- Cursor/record state จะไม่ถูกบันทึกก่อน Content และ Daily สำเร็จ
- Record states จำนวนมากถูกแบ่ง D1 batch เพื่อลดขนาดคำสั่ง
- Cursor ถูก commit ใน batch สุดท้าย
- ถ้า D1 checkpoint ล้มหลัง Lark write ระบบคืน Retryable error; Queue rerun ปลอดภัยเพราะ Stable key/Diff เดิม
- Full snapshot ล้างเฉพาะ state ที่ไม่ถูกเห็นใน sync run ล่าสุด แต่ไม่ลบ Business row จาก Lark อัตโนมัติ

## ข้อจำกัดที่ตั้งใจไว้

Lark Native RAW source ยังถูกอ่านครบทุกหน้า เพราะต้องตรวจ Source identity ทั้งชุด, Dictionary contract และ record deletion โดยปลอดภัย ดังนั้น v0.6.0 คือ **Incremental destination processing** ไม่ใช่ server-side source delta query

เมื่อมี Source contract ที่รับประกัน Modified Time filter/cursor ได้จริง สามารถเพิ่ม server-side source window ภายหลังโดยไม่เปลี่ยน checkpoint schema

## Runtime variables

```env
MKT_TIKTOK_INCREMENTAL_ENABLED=true
MKT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS=86400000
```

Scheduled job ส่ง `syncMode=auto`; Manual UAT สามารถส่ง `syncMode=full` หรือ `incremental` ได้ แต่ Safety rules ยังสามารถยกระดับเป็น Full ได้

## Deploy DEV

```bash
npx wrangler d1 migrations apply MKT_STATE_DB \
  --remote \
  --config wrangler.sync.jsonc

npm run check
npm test
npm run deploy:dry-run
npx wrangler deploy --config wrangler.sync.jsonc
```

## Live UAT expected

รอบแรก:

```text
incremental.mode = full
incremental.reason = initial_checkpoint
incremental.checkpointSaved = true
```

รอบไม่เปลี่ยนแปลงในวันเดียวกัน:

```text
incremental.mode = incremental
incremental.reason = no_source_changes
incremental.selectedRecords = 0
processedRawRecords = 0
Content/Daily records_written = 0
```

หลังแก้ RAW metric หนึ่งรายการ:

```text
incremental.reason = source_records_changed
incremental.selectedRecords = 1
Content/Daily plan เฉพาะ stable key ของรายการนั้น
```
