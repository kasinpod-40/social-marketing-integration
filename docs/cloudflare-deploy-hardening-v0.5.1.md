# Cloudflare Deploy Hardening v0.5.1

## เป้าหมาย

ปิด deployment blockers ของ Sync Worker ก่อนสร้าง DEV/Staging resources จริง โดยไม่เปลี่ยน Lark Content/Daily schema และไม่เปิด Connector ที่ยังเป็น planned.

## Runtime contract

- `wrangler.sync.example.jsonc` อยู่ repository root เพื่อให้ `main` และ `migrations_dir` resolve ตรงกัน
- D1 binding `MKT_STATE_DB` เป็น operational source of truth
- Lark `MKT_Sync_Log`/`MKT_System_Alerts` เป็น best-effort mirror
- `MKT_MAIN_QUEUE_NAME` และ `MKT_DLQ_QUEUE_NAME` ต้องมีค่า ไม่ซ้ำ และตรงกับ `batch.queue`
- Cron ส่ง Job เข้า `MKT_SYNC_QUEUE`; Queue consumer เป็นผู้รัน Sync
- Lease lock ต่ออายุด้วย `MKT_SYNC_LOCK_RENEW_INTERVAL_MS` ซึ่งต้องน้อยกว่า Lease

## Failure behavior

- D1 write ล้มเหลว: ห้าม Ack และให้ Queue retry
- Lark mirror ล้มเหลว: D1 state ยังถือเป็นจริงและบันทึก structured warning
- Batch write สำเร็จบาง Chunk: status `partial_success`, count เฉพาะแถวที่ยืนยันได้, Critical alert และ reconcile รอบถัดไป
- DLQ: persist/alert เท่านั้น ห้าม execute job เดิม
- Unknown Queue: quarantine แบบ fail-closed
- Lock ownership หาย: หยุดก่อน Chunk ถัดไปและ retry

## Local quality gate

```bash
npm ci
npm test
npm run check
npm run deploy:dry-run
```

## ขั้นสร้าง Cloudflare DEV/Staging

1. สร้าง D1 database และแทน `database_id` ใน `wrangler.sync.jsonc`
2. Apply `migrations/0001_initial.sql` และ `0002_reliability.sql`
3. สร้าง Main Queue และ DLQ ตามชื่อใน config
4. ใส่ Lark secrets ด้วย `wrangler secret put`
5. แทน Lark Table IDs ของ DEV Base
6. รัน dry-run อีกครั้ง แล้วจึง deploy
7. ตรวจ Scheduled producer, D1 lock renewal, retry exhaustion, DLQ persistence และ Lark mirror บน resource จริง

## สิ่งที่ dry-run ไม่ยืนยัน

Dry-run และ workerd tests ยืนยัน bundle/config/routing contract แต่ยังไม่ยืนยัน D1/Queues/Lark จริงใน Cloudflare account จนกว่าจะสร้าง resources และทำ Live DEV gate.
