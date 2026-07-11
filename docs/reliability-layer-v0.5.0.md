# Reliability Layer v0.5.0

## เป้าหมาย

Release นี้ทำงาน 4 ส่วนเป็นแกนกลางร่วมสำหรับ Connector ทุกช่องทาง:

1. `sync_run_id` และ `MKT_Sync_Log`
2. Reconciliation / Recovery จาก Stable key
3. Distributed lease lock บน Cloudflare D1
4. Retry / Dead Letter Queue / `MKT_System_Alerts`

## Lark Base contract ที่ใช้งานจริง

Release นี้ **ไม่เพิ่มหรือเปลี่ยน Field ใน Lark Base** และเขียนกับโครงสร้างที่มีอยู่แล้ว:

### MKT_Sync_Log

| Field | Type | ใช้งาน |
|---|---|---|
| `sync_id` | Text | Stable key ของรอบ Sync |
| `platform` | Single select | เช่น `tiktok` |
| `sync_type` | Single select | Release นี้ map TikTok native sync เป็น `native_import` |
| `status` | Single select | `pending`, `running`, `success`, `partial_success`, `failed`, `skipped` |
| `records_pulled` | Number | จำนวน Raw records ที่อ่าน |
| `records_written` | Number | Create + Update ของทุกตารางในรอบนั้น |
| `error_message` | Text | Error code, message และ sync_run_id เมื่อมีปัญหา |

### MKT_System_Alerts

| Field | Type | ใช้งาน |
|---|---|---|
| `alert_id` | Text | Stable key ของ Alert |
| `severity` | Single select | `info`, `warning`, `critical` |
| `platform` | Single select | Platform หรือ `system` |
| `alert_message` | Text | สาเหตุ, sync_run_id, error code และคำแนะนำ |
| `status` | Single select | `open`, `acknowledged`, `resolved` |

รายละเอียดเชิง Operational ที่ Lark ไม่มี Field เช่น timestamps, created/updated/skipped แยกกัน, retry count, error details และ reconciliation metadata จะเก็บใน D1 เพื่อไม่บังคับแก้ Base ตอนนี้

## D1 schema

Migration `migrations/0002_reliability.sql` เพิ่ม:

- `sync_runs`
- `sync_locks`
- `dead_letter_jobs`
- `system_alerts`

D1 เป็น operational source of truth สำหรับ Worker ส่วน Lark เป็น user-facing mirror

## Sync run lifecycle

```text
สร้าง sync_run_id
→ ขอ lock ตาม customer_profile + platform + account_key + sync_type
→ เขียน MKT_Sync_Log = running
→ Prepare/Preflight ทั้ง Content และ Daily
→ Execute Content
→ Execute Daily
→ เขียน success หรือ partial_success/failed
→ สร้าง Alert เมื่อจำเป็น
→ ปล่อย lock
```

## Reconciliation / Recovery

ระบบเทียบ Plan ของ `MKT_Content` และ `MKT_Content_Daily` ก่อน Write:

- Content มีแล้ว แต่ Daily ขาด → รอบปัจจุบันสร้างเฉพาะ Daily ที่ขาด
- Daily มีแล้ว แต่ Content ขาด → รอบปัจจุบันสร้างเฉพาะ Content ที่ขาด
- ตารางแรกสำเร็จ แต่ตารางหลังล้มเหลว → โยน `SYNC_PARTIAL_WRITE` แบบ retryable และบันทึก `partial_success`
- Queue Retry จะเริ่ม Plan ใหม่จาก Stable key จึงไม่สร้างข้อมูลฝั่งที่สำเร็จไปแล้วซ้ำ

ผลลัพธ์ Sync มี `reconciliation` ระบุ `required`, จำนวนแถวที่ขาด และสถานะ `recovered`

## Lock contract

Cloudflare ใช้ D1 lease lock แบบ atomic SQL:

```text
lock_key = <customer_profile>:<platform>:<account_key>:<sync_type>
owner_id = sync_run_id
```

- Lock หมดอายุอัตโนมัติตาม `MKT_SYNC_LOCK_LEASE_MS`
- Release ลบได้เฉพาะ owner เดิม
- Local script ใช้ file lease lock ใน `.mkt-locks/` เพื่อกันหลาย Terminal บนเครื่องเดียวกัน
- Local file lock ไม่ครอบ Cloudflare ดังนั้นห้ามรัน Local write พร้อมกับ Cloud Cron ของ Environment เดียวกัน

## Retry และ DLQ

- Retry เฉพาะ Error ที่ประกาศ `retryable=true`
- Permanent error Ack และบันทึก terminal failure ลง D1 เมื่อ D1 พร้อม
- Queue หลักกำหนด `dead_letter_queue`
- Message ที่ Retry ครบจะถูกส่งไป `social-mkt-sync-dlq`
- DLQ consumer เก็บ payload แบบ redact secret-like keys ลง `dead_letter_jobs` และสร้าง Critical alert ใน D1 พร้อม Mirror ไป Lark เมื่อ config พร้อม
- DLQ consumer ไม่ Execute งานเดิมซ้ำ

## Required Runtime values

Local:

```env
LARK_TABLE_MKT_SYNC_LOG=
LARK_TABLE_MKT_SYSTEM_ALERTS=
MKT_SYNC_LOCK_LEASE_MS=600000
MKT_LOCAL_LOCK_DIR=.mkt-locks
```

Cloudflare:

```text
D1 binding: MKT_STATE_DB
MKT_DLQ_QUEUE_NAME=social-mkt-sync-dlq
MKT_QUEUE_RETRY_DELAY_SECONDS=30
MKT_SYNC_LOCK_LEASE_MS=600000
```

## Known limitation

Lark Base ไม่มี Transaction ข้ามตาราง จึงยังรับประกัน Atomic write สองตารางไม่ได้ แต่ Release นี้ทำให้ Partial write:

- ตรวจพบได้
- มี sync_run_id อ้างอิง
- แจ้งเตือนได้
- Retry แล้วเติมเฉพาะส่วนที่ขาดได้
- ไม่รายงาน Success แบบเงียบ ๆ

Lease ไม่มี heartbeat ต่ออายุระหว่างงาน จึงต้องตั้ง `MKT_SYNC_LOCK_LEASE_MS` ให้ยาวกว่าระยะเวลา Sync สูงสุดที่คาดไว้ ก่อนเพิ่มข้อมูลปริมาณมากควรเพิ่ม lock renewal heartbeat
