# Runbook — Chatwoot Remote Readiness and Migration 0018

## วัตถุประสงค์

Runbook นี้ใช้กับ Integration Workspace เท่านั้น เพื่อยืนยัน Remote D1 readiness ของ Chatwoot และ
Migration `0018_chatwoot_analytics.sql` แบบ evidence-driven ก่อนเริ่ม Chatwoot Provider, Lark หรือ
Business-data UAT

Operator:

```text
scripts/chatwoot-remote-readiness-operator.mjs
```

Default invocation เป็น plan-only และไม่รัน Git, Wrangler, D1, Worker, Queue, Lark หรือ Chatwoot
Provider command

## Scope ที่ Operator รองรับ

```text
plan
→ preflight
→ backup
→ migrate
→ schema-readback
```

Operator ไม่มี phase สำหรับ Provider request, Queue send, DLQ, Lark, Worker deploy, Schedule,
Webhook, retention/delete หรือ Production

## Target ที่ล็อกไว้

```text
MKT_ENV                         = development
MKT_CUSTOMER_PROFILE            = integration_workspace
MKT_CONNECTION_CUSTOMER_KEY     = chemistry_k
MKT_CHATWOOT_ROLLOUT_DATABASE_NAME = social-mkt-state-dev
Worker                          = social-mkt-sync-worker
Expected pending migration      = 0018_chatwoot_analytics.sql only
Migration 0017                  = already applied / do not rerun
```

ต้องกำหนด local path ของ Wrangler config ที่เป็น all-flags-false ผ่าน:

```text
MKT_CHATWOOT_ROLLOUT_WRANGLER_CONFIG
```

ไฟล์ config และ Secret values ห้าม Commit เข้า Repository

## Plan-only

คำสั่งนี้ปลอดภัยและไม่ต้องใช้ confirmation:

```bash
npm run rollout:chatwoot-readiness
```

การใส่ phase แต่ไม่ใส่ `--execute` จะพิมพ์ Preview เท่านั้น:

```bash
node scripts/chatwoot-remote-readiness-operator.mjs --phase=preflight
```

## Phase 1 — Remote read-only preflight

Confirmation:

```text
CONFIRM_CHATWOOT_REMOTE_PREFLIGHT=READ_ONLY_CHATWOOT_REMOTE_PREFLIGHT
```

คำสั่ง:

```bash
CONFIRM_CHATWOOT_REMOTE_PREFLIGHT=READ_ONLY_CHATWOOT_REMOTE_PREFLIGHT \
npm run rollout:chatwoot-readiness:preflight
```

Preflight ตรวจ:

- Git branch ต้องเป็น `main`, Working Tree สะอาด และมี reviewed baseline เป็น ancestor
- local Migration `0018` ต้องมี 14 exact tables, 15 exact indexes และไม่มี destructive SQL
- Wrangler config ต้องชี้ Integration Workspace/D1 ที่ถูกต้อง
- ทุก Business, Schedule, Webhook, Report, Retention และ DLQ-redrive gate ต้องเป็น `false`
- D1/Queue/DLQ topology ต้องครบ
- `wrangler whoami`, D1 info และ Secret-name list ต้องอ่านได้
- only pending migration ต้องเป็น `0018_chatwoot_analytics.sql`
- active durable work และ active lock ต้องเป็นศูนย์
- Chatwoot tables/indexes ต้องยังไม่มี
- เก็บเฉพาะ Secret-name count/fingerprint และ boolean ว่ามีชื่อ Secret ของ Chatwoot หรือไม่

Phase นี้ไม่มี Remote mutation และไม่เรียก Chatwoot Provider

## Phase 2 — Backup

Confirmation:

```text
CONFIRM_CHATWOOT_REMOTE_BACKUP=BACKUP_BEFORE_0018_CHATWOOT
```

คำสั่ง:

```bash
CONFIRM_CHATWOOT_REMOTE_BACKUP=BACKUP_BEFORE_0018_CHATWOOT \
npm run rollout:chatwoot-readiness:backup
```

Backup ต้องมี preflight evidence ที่ผ่านและยังตรงกับ target/Migration source ปัจจุบัน Operator จะ:

- ตรวจ pending migration ซ้ำ
- Export Remote D1 เป็น local SQL
- ปฏิเสธไฟล์ว่าง
- สร้าง SHA-256 sidecar
- บันทึก evidence แบบ permission จำกัด

ห้ามข้าม Backup ไป Migrate

## Phase 3 — Migration 0018

Confirmation:

```text
CONFIRM_CHATWOOT_REMOTE_MIGRATION=APPLY_0018_CHATWOOT_ANALYTICS
```

คำสั่ง:

```bash
CONFIRM_CHATWOOT_REMOTE_MIGRATION=APPLY_0018_CHATWOOT_ANALYTICS \
npm run rollout:chatwoot-readiness:migrate
```

Migration phase ต้องผ่านเงื่อนไขทั้งหมด:

- preflight evidence ผ่าน
- backup evidence ผ่านและ checksum ตรงกับไฟล์จริง
- target fingerprint และ Migration SHA ตรงกันทั้ง chain
- pending migration มีเพียง `0018`
- หลัง apply ต้องไม่มี pending migration

การผ่าน phase นี้ยังไม่ถือว่า Migration ปิดงานจน `schema-readback` ผ่าน

## Phase 4 — Schema read-back

Confirmation:

```text
CONFIRM_CHATWOOT_SCHEMA_READBACK=READ_BACK_0018_CHATWOOT_SCHEMA
```

คำสั่ง:

```bash
CONFIRM_CHATWOOT_SCHEMA_READBACK=READ_BACK_0018_CHATWOOT_SCHEMA \
npm run rollout:chatwoot-readiness:schema-readback
```

Read-back ต้องยืนยัน:

```text
Chatwoot tables                 = 14
Chatwoot indexes                = 15
Chatwoot Business rows          = 0 ทุก table
Active durable work             = 0
Active locks                    = 0
Shared count drift              = 0
Pending migrations              = 0
```

Shared count parity ครอบคลุม Sync, Coverage, TikTok state/observations, open DLQ และ open Alerts ที่
จับไว้ใน preflight evidence

## Evidence

Default directory:

```text
outputs/chatwoot-remote-readiness/
```

เปลี่ยนได้ด้วย:

```text
MKT_CHATWOOT_READINESS_EVIDENCE_DIR
```

Evidence JSON และ Backup files ต้องไม่ Commit และต้องไม่ส่ง Secret, Token, raw Wrangler config,
Provider response หรือ PII เข้า PR/Issue/Chat

## สิ่งที่ยังไม่อนุญาตหลัง Schema read-back

แม้ `schema-readback` ผ่าน ก็ยังห้ามทำสิ่งต่อไปนี้จนเปิดงานใหม่และอนุมัติแยก:

```text
Chatwoot exact identity/permission GET-only preflight
Chatwoot Token read/rotation
Lark 15-table schema apply/mapping
Worker deployment
Queue send
State-only D1 UAT
Lark parity UAT
Full-snapshot report UAT
Schedule or Webhook activation
Production
```

## Emergency rule

หาก pending migration ไม่ตรง, backup checksum ไม่ผ่าน, active work/lock ไม่เป็นศูนย์, schema count
ไม่ตรง หรือ Shared count drift เกิดขึ้น ให้หยุดทันที ห้าม rerun migration, ห้ามส่ง Queue และห้าม
เปิด Chatwoot Connector เพื่อพยายามแก้ข้อมูล
