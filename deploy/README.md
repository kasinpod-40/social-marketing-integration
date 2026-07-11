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

## Queue concurrency safety

`deploy/wrangler.sync.example.jsonc` กำหนด `max_concurrency=1` เพื่อไม่ให้ Cloudflare เปิด Sync consumer หลาย invocation เขียน Stable key เดียวกันพร้อมกัน ขณะนี้ระบบยังไม่มี Distributed lock/Unique reservation กลาง จึงห้ามเพิ่มค่านี้และห้ามรัน Local write พร้อม Production Queue

ภายในหนึ่ง Queue batch ตัว Workerยังประมวลผล Message ตามลำดับ และแชร์ Tenant token/Schema cache เพื่อลดคำขอ Lark ซ้ำ
