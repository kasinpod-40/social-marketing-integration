# Deployment Configs

โปรเจกต์นี้มี Worker แยกหน้าที่กันชัดเจน:

- `wrangler.example.jsonc` — API Worker และ Queue producer
- `deploy/wrangler.sync.example.jsonc` — Sync Queue consumer

ไม่ใช้ Queue consumer ใน API Worker เพราะ `main` หนึ่งไฟล์ Deploy ได้เพียง Worker entry point เดียว การแยกไฟล์ป้องกันกรณี Config ชี้ไป `api-worker` แต่คาดหวังให้ `sync-worker` รับ Queue ซึ่งจะไม่ทำงานจริง

## Secret ที่ต้องตั้งด้วย Wrangler/Cloudflare Secret

- `LARK_APP_ID`
- `LARK_APP_SECRET`

ห้ามใส่ Secret จริงลงไฟล์ JSONC หรือ Commit เข้า Git

## Connector feature flags

Production/DEV ต้องเปิดเฉพาะ Connector ที่มี Implementation จริง:

```env
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_CONNECTOR_YOUTUBE_ENABLED=false
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_CONNECTOR_CHATWOOT_ENABLED=false
```

Connector ที่ยังเป็น `planned` จะทำให้ Runtime config ล้มเหลวทันทีเมื่อเปิดเป็น `true`

TikTok handle จริงเปลี่ยนผ่าน Environment ได้โดยไม่แก้ Source code:

```env
TIKTOK_SOURCE_HANDLE=chemistry_k
```

Stable `accountKey` ยังมาจาก Customer profile และห้ามเปลี่ยนหลังเริ่มเขียนข้อมูลจริง

## Queue job contract

- Queue schema ปัจจุบันคือ version `1`
- Job เดิมที่ไม่มี `schemaVersion` จะถูก Normalize เป็น version `1`
- Job ที่ไม่รู้จักเป็น Permanent error
- Job ที่ลงทะเบียนไว้แต่ยังไม่ Implement เป็น `SYNC_JOB_NOT_IMPLEMENTED`
- Unknown/Planned/Disabled job จะหยุดก่อนสร้าง Lark client และไม่แตะ Credential

## D1 และ Reliability binding

Sync Worker ต้องมี D1 binding ชื่อ:

```text
MKT_STATE_DB
```

ก่อน Deploy ให้สร้าง D1 และ Apply migrations:

```bash
npx wrangler d1 create social-mkt-state-chemistry-k
npx wrangler d1 migrations apply social-mkt-state-chemistry-k --remote
```

D1 เก็บ Sync runs, Distributed lease locks, Dead letters และ System alerts รายละเอียดเต็ม ส่วน Lark Base เป็น mirror สำหรับผู้ใช้

## Queue concurrency safety

`deploy/wrangler.sync.example.jsonc` กำหนด `max_concurrency=1` เป็นค่าเริ่มต้นสำหรับ UAT แม้มี D1 distributed lease lock แล้ว ห้ามเพิ่ม concurrency จนกว่าจะผ่าน Load/Failure test

Lock key แยกตาม `customer_profile + platform + account_key + sync_type` และหมดอายุตาม `MKT_SYNC_LOCK_LEASE_MS`

Local file lock ป้องกันได้เฉพาะ Process บนเครื่องเดียวกัน จึงยังห้ามรัน Local write กับ Base เดียวกันระหว่างเปิด Cloud scheduled sync

## Dead Letter Queue

Queue หลักต้องกำหนด:

```jsonc
"dead_letter_queue": "social-mkt-sync-dlq"
```

และ Worker เดียวกันต้องเป็น Consumer ของ DLQ ด้วย โดยตั้ง:

```env
MKT_DLQ_QUEUE_NAME=social-mkt-sync-dlq
```

DLQ consumer จะ Persist Message ลง D1 และสร้าง Critical alert โดยไม่ Execute งานเดิมซ้ำ

ภายในหนึ่ง Queue batch ตัว Workerยังประมวลผล Message ตามลำดับ และแชร์ Tenant token/Schema cache เพื่อลดคำขอ Lark ซ้ำ
