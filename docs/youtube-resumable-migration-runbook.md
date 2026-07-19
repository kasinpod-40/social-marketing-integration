# YouTube Resumable Sync — Migration 0005–0006 DEV Runbook

เอกสารนี้ใช้สำหรับ Apply `migrations/0005_resumable_sync_reliability.sql` และ
`migrations/0006_dead_letter_redrive_status.sql` ก่อน Deploy Source patch โดยไม่ให้
Queue รุ่นเก่าหรือ Schedule ทำงานข้ามช่วงเปลี่ยน Contract

## ข้อกำหนดก่อนเริ่ม

- ใช้เฉพาะ DEV/Staging ที่เป็นทรัพยากรของผู้พัฒนา/ลูกค้าตาม Environment นั้น
- Production ต้องปิด
- Backup/export D1 ตามกระบวนการของ Environment
- เก็บ Secret และ Live IDs ใน ignored config/Secret store เท่านั้น
- ห้ามแก้ Migration 0001–0004 ที่ Apply แล้ว

## Phase 1 — Quiesce Producer

1. ตั้งค่าใน DEV runtime:

```text
MKT_SCHEDULE_YOUTUBE_ENABLED=false
MKT_YOUTUBE_ANALYTICS_ENABLED=false
MKT_DLQ_REDRIVE_ENABLED=false
```

2. Deploy เฉพาะ Config ที่ปิด Producer โดยยังใช้ Worker known-good เดิม
3. ยืนยัน Cron อื่นของ TikTok/Report ไม่ถูกเปลี่ยน
4. รอ Main Queue และ Retry delivery ของ YouTube หมด

## Phase 2 — Read-only preflight

ต้องได้ผลลัพธ์เป็นศูนย์ก่อน Apply:

```sql
SELECT COUNT(*) AS active_work_count FROM sync_work_runs;

SELECT COUNT(*) AS active_lock_count
FROM sync_locks
WHERE expires_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000;
```

ตรวจเพิ่มเพื่อเก็บหลักฐาน:

```sql
SELECT COUNT(*) AS cursor_count FROM sync_cursors;
SELECT COUNT(*) AS source_state_count FROM source_record_states;
SELECT COUNT(*) AS open_dlq_count FROM dead_letter_jobs WHERE status = 'open';
```

หาก `active_work_count` หรือ `active_lock_count` ไม่เป็นศูนย์ ให้หยุดและตรวจ Queue/Lock ห้ามลบแถวเพื่อบังคับ Migration ผ่าน

## Phase 3 — Apply Migrations 0005–0006

1. Preview pending migrations ตาม guarded Cloudflare workflow ของ Repository
2. Apply 0005 ก่อน 0006 ตามลำดับของ Wrangler
3. Migration 0005 มี SQL guard และจะ Fail closed หากยังมี Work หรือ Active lock
4. Migration 0006 rebuild เฉพาะ `dead_letter_jobs` เพื่อขยาย CHECK constraint และมี copy-count guard
5. ห้าม Deploy Source ใหม่หาก Migration ใดล้ม หรือ Schema verification ไม่ครบ

## Phase 4 — Verify Schema และ Bootstrap

ตรวจว่ามี:

- `sync_generation_fences`
- `sync_warning_outbox`
- `sync_work_runs.generation/requested_at/lifecycle_status/...`
- `sync_cursors.generation/generation_work_key/requested_at`
- `dead_letter_jobs.replay_payload_json/redrive_requested_at/redrive_reference/redriven_at`
- `dead_letter_jobs.status` ต้องยอมรับ `redrive_pending` และ `redriven` หลัง 0006
- Generation fence จาก `sync_cursors.last_successful_sync_at` โดยมี Work key รูปแบบ `legacy-checkpoint:<cursor_key>`

ตัวอย่าง read-only verification:

```sql
SELECT cursor_key, generation, requested_at, work_key
FROM sync_generation_fences
ORDER BY cursor_key;

SELECT lifecycle_status, COUNT(*) AS total
FROM sync_work_runs
GROUP BY lifecycle_status;

SELECT status, COUNT(*) AS total
FROM sync_warning_outbox
GROUP BY status;
```

ห้ามแสดง Cursor key/External identity ใน Log หรือเอกสารที่ส่งออกนอกทีมผู้ดูแล

## Phase 5 — Deploy Source patch แบบปิด Schedule

1. Deploy Source patch โดย YouTube Schedule/Analytics ยังปิด
2. ตรวจ Health/Bindings/Queue names/D1 binding
3. รัน Manual healthy Full หรือ Incremental ขนาดเล็ก
4. ตรวจ:
   - Generation fence ถูก Claim
   - Checkpoint มี Generation/Work key ปัจจุบัน
   - Work จบเป็น `completed`
   - ไม่มี Active lock ค้าง
   - Stable-key duplicate = 0

## Phase 6 — Controlled reliability smoke

ทำเฉพาะ DEV แบบไม่เปิดเผย Secret/External identity:

1. Stale generation no-op: A เก่า → B ใหม่ → A Retry ต้องเป็น `skipped/SYNC_WORK_SUPERSEDED`
2. Warning replay: Alert persist ล้มหนึ่งครั้ง → Job ใหม่เข้าก่อน Retry → Warning เดิมต้องถูกส่งหนึ่งรายการและ Outbox เป็น `delivered`
3. Permanent failure: ต้องมี Terminal work, Dead-letter exact secret-filtered replay payload และ deterministic queue alert
4. Redrive: เปิด `MKT_DLQ_REDRIVE_ENABLED=true` ชั่วคราวเฉพาะ Incident ที่อนุมัติ, ใช้ `npm run job:redrive-dead-letter`, ส่ง Admin command แล้วปิด Flag คืนทันที
5. TTL cleanup: ห้ามลบ Active/Locked/Pending-warning work

## Phase 7 — Re-enable DEV Schedule

เปิดกลับเมื่อ Phase 1–6 ผ่านทั้งหมด:

```text
MKT_SCHEDULE_YOUTUBE_ENABLED=true
MKT_YOUTUBE_ANALYTICS_ENABLED=true
MKT_YOUTUBE_ANALYTICS_TIME=07:50
MKT_DLQ_REDRIVE_ENABLED=false
```

จากนั้น Observe Full/Incremental/Analytics และหนึ่ง Natural 07:50 Asia/Bangkok run

## Rollback

- ปิด YouTube Schedule/Analytics
- Redeploy prior known-good Worker
- Migration 0005 เป็น additive; migration 0006 rebuild เฉพาะ Dead-letter schema โดยรักษา rows เดิม
- ห้ามลบ `sync_cursors`, `source_record_states` หรือ Lark Business rows
- Pending warning ต้องถูกส่ง/ซ่อมก่อน cleanup
- Redrive record ที่เป็น `redrive_pending` ต้องตรวจ Queue delivery ก่อนทำคำสั่งซ้ำ เพราะระบบตั้งใจ reuse Generation เดิมเพื่อให้ Duplicate ถูก Fence

## DEV execution record — 2026-07-20

- Quiesce ผ่านด้วย active work/lock/pending warning/redrive pending = 0/0/0/0
- Export D1 แยกก่อน migration 0005 และก่อน migration 0006 สำเร็จ; ไฟล์เก็บเฉพาะ local `/tmp` ด้วย permission `0600`
- Migration 0005 และ 0006 Apply สำเร็จ; Final migration list ว่าง
- Migration 0006 รักษา Dead-letter 8 rows, 16 columns และ 2 required indexes
- Healthy incremental, stale generation และ Permanent identity fault ผ่าน expected classification
- Controlled Redrive เปลี่ยน incident เป็น `redriven`; replay สำเร็จ retry 0 และไม่สร้าง Stable-key row ใหม่
- Redrive flag ถูกปิดกลับ; YouTube Schedule/Analytics เปิดกลับเฉพาะ DEV บน Worker `adc0f825-68e5-4231-847b-4b41a6592204`
- Final D1 active work/lock/pending warning/redrive pending = 0/0/0/0
- Natural schedule observation และ Customer-owned 837-video Live UAT ยังเป็นงานหลัง rollout; Production ยังคงปิด
