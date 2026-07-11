# Deployment Configs

โปรเจกต์นี้มี Worker แยกหน้าที่กันชัดเจน:

- `wrangler.example.jsonc` — API Worker และ Queue producer
- `deploy/wrangler.sync.example.jsonc` — Sync Queue consumer

ไม่ใช้ Queue consumer ใน API Worker เพราะ `main` หนึ่งไฟล์ Deploy ได้เพียง Worker entry point เดียว การแยกไฟล์ป้องกันกรณี Config ชี้ไป `api-worker` แต่คาดหวังให้ `sync-worker` รับ Queue ซึ่งจะไม่ทำงานจริง

## Secret ที่ต้องตั้งด้วย Wrangler/Cloudflare Secret

- `LARK_APP_ID`
- `LARK_APP_SECRET`

ห้ามใส่ Secret จริงลงไฟล์ JSONC หรือ Commit เข้า Git

## Queue concurrency safety

`deploy/wrangler.sync.example.jsonc` กำหนด `max_concurrency=1` เพื่อไม่ให้ Cloudflare เปิด Sync consumer หลาย invocation เขียน Stable key เดียวกันพร้อมกัน ขณะนี้ระบบยังไม่มี Distributed lock/Unique reservation กลาง จึงห้ามเพิ่มค่านี้และห้ามรัน Local write พร้อม Production Queue

ภายในหนึ่ง Queue batch ตัว Worker ยังประมวลผล Message ตามลำดับ และแชร์ Tenant token/Schema cache เพื่อลดคำขอ Lark ซ้ำ
