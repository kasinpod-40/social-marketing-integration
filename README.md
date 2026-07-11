# Social Marketing Data Integration

ระบบรวมข้อมูล Social Marketing เข้าสู่ Lark Base สำหรับ Daily Snapshot, Dashboard, AI Summary และ Alert โดยใช้ JavaScript ES Modules, Cloudflare Workers/Queues และ Lark Open API

## Baseline ปัจจุบัน

`v0.3.1-codebase-audit-hardening`

สถานะปัจจุบัน:

- DEV ใช้ Lark Base ของผู้พัฒนาและ TikTok `@ft.pumkin`
- Production profile `chemistry_k` เตรียมไว้ใน Source code แต่ Production จริงต้องใช้ Lark Base, App, Cloud และบัญชี Social ที่ลูกค้าเป็นเจ้าของ
- TikTok DEV Sync จริงผ่าน 20 Content + 20 Daily Snapshot แล้วก่อน Audit รอบนี้
- หลังเปลี่ยนเป็น v0.3.1 ต้องรัน Dry run และ Idempotency test กับ DEV Base อีกครั้ง

## โครงสร้างระบบ

```text
apps
  ├─ api-worker       HTTP health/status
  └─ sync-worker      Scheduled/Queue jobs

packages
  ├─ domain           Entity และ Value object ที่ไม่พึ่ง Infrastructure
  ├─ application      Use case และ Business flow
  ├─ sync-engine      Plan/Diff/Execute แบบ Storage-neutral
  ├─ connectors       Lark และ TikTok adapters
  ├─ config           Customer profile, table mapping และ build info
  └─ shared           Date, Error และ HTTP utilities กลาง
```

Dependency direction หลัก:

```text
apps -> application/domain/config
application -> domain/shared + connector ports/adapters ที่ประกอบจาก Runtime
connectors -> shared
sync-engine -> repository contract
```

## Dev และ Production

เลือก Environment ผ่านค่า Runtime โดยไม่แก้ Source code

DEV:

```env
MKT_ENV=development
MKT_CUSTOMER_PROFILE=dev_ft_pumkin
```

Production ของ Chemistry K:

```env
MKT_ENV=production
MKT_CUSTOMER_PROFILE=chemistry_k
```

ข้อมูลที่ไม่เป็นความลับ เช่น Customer key, Stable account key, Feature mapping และคำอธิบายภาษาไทยเก็บใน `packages/config/src/customer-profiles.js`

Secret ทั้งหมดต้องอยู่ใน `.dev.vars`, Cloudflare Secret หรือ Secret Manager ของลูกค้า:

```text
LARK_APP_ID
LARK_APP_SECRET
LARK_APP_TOKEN
API keys / access tokens / webhook secrets / passwords
```

## ตั้งค่า Local DEV

```bash
cp .dev.vars.example .dev.vars
```

กำหนดค่าอย่างน้อย:

```env
MKT_ENV=development
MKT_CUSTOMER_PROFILE=dev_ft_pumkin

LARK_APP_ID=...
LARK_APP_SECRET=...
LARK_APP_TOKEN=...

LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS=...
LARK_TABLE_MKT_CONTENT=...
LARK_TABLE_MKT_CONTENT_DAILY=...
LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY=...
```

`.dev.vars` ต้องไม่ Commit และไม่รวมใน ZIP Release

## คำสั่งตรวจและ Sync

ตรวจ Code:

```bash
npm test
npm run check
```

Dry run ด้วยเส้นทางเดียวกับ Production write path:

```bash
npm run validate:tiktok
```

Write จริงหลัง Dry run ผ่าน:

```bash
CONFIRM_WRITE=YES npm run sync:tiktok
```

Seed Metric definitions:

```bash
CONFIRM_WRITE=YES npm run seed:metrics
```

กำหนด Snapshot date เฉพาะรอบ:

```bash
METRIC_DATE=2026-07-11 npm run validate:tiktok
METRIC_DATE=2026-07-11 CONFIRM_WRITE=YES npm run sync:tiktok
```

## Safety ของ TikTok Sync

ก่อนเริ่มเขียน ระบบจะทำตามลำดับ:

1. อ่าน RAW TikTok และ Classification Dictionary
2. Normalize ทุกแถวและตรวจ Metric/URL/Date/Video ID แบบไม่เสีย precision
3. ตรวจ Source handle ให้ตรง Customer profile
4. ตรวจ Destination identity conflict ทั้ง Account และ Stable key เก่าจาก `platform + external_content_id`
5. โหลด Schema จริงของ Content และ Daily
6. Serialize/Preflight ทั้งสองตาราง
7. ค้น Existing record ด้วย Stable Key และสร้าง Create/Update/Skip plan
8. เมื่อทุกขั้นผ่านจึง Execute Content และ Daily

Stable keys:

```text
MKT_Content       tiktok:<account_key>:<video_id>
MKT_Content_Daily tiktok:<account_key>:<video_id>:<YYYY-MM-DD>
```

DEV:

```text
tiktok:ft_pumkin:<video_id>
```

Production Chemistry K:

```text
tiktok:chemistry_k:<video_id>
```

## Retry และ Idempotency

- Read/Update requests Retry เฉพาะ Error ชั่วคราว
- Batch Create Retry ภายใน Request เฉพาะ Rate limit ที่ Lark ตอบกลับชัดเจน
- Timeout/Network/5xx ที่ผล Create อาจกำกวมจะส่งกลับให้ Queue เริ่ม Job ใหม่
- Job ใหม่ต้อง Re-plan จาก Stable Key ก่อนเขียน จึงลดความเสี่ยงสร้างข้อมูลซ้ำ
- Permanent error เช่น Schema, Config, Source mismatch และ Invalid job จะไม่ Retry วน

Lark ไม่มี Transaction ข้าม `MKT_Content` และ `MKT_Content_Daily` ดังนั้น Network failure หลังตารางแรกสำเร็จยังอาจเกิด Partial write ได้ การรัน Job เดิมซ้ำจะ Reconcile ด้วย Stable Key และเติมเฉพาะส่วนที่ขาด

## Lark Classification Dictionary

`MKT_Classification_Dictionary` เป็น Source of truth ของคำธุรกิจ เช่น Course, Level, Theme, Funnel, CTA, Promotion และ Urgency

Field ที่อ่าน:

```text
rule_key
target_field
output_value
aliases
match_type
platform
applies_to
priority
confidence
enabled
note
```

เมื่อไม่มี Rule Match ระบบไม่เดาค่า แต่กำหนด:

```text
manual_tag_note = manual_review: no enabled dictionary rule matched
classification_confidence = 0.2
```

## Deployment

- API Worker example: `wrangler.example.jsonc`
- Sync Worker example: `deploy/wrangler.sync.example.jsonc`
- Deployment notes: `deploy/README.md`
- Full audit: `docs/full-codebase-audit-v0.3.1.md`
- Production checklist: `docs/PRODUCTION_CHECKLIST.md`
- Source of truth: `PROJECT_BRAIN.md`

## Definition of Done

Release จะยังไม่ถือว่าเสร็จจนกว่า Test, Syntax check, Secret scan, ZIP extraction test, DEV Dry run, Idempotency rerun และเอกสารหลักจะผ่านครบ
