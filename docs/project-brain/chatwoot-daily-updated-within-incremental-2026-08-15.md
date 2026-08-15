# Chatwoot Daily Updated-within Incremental — 2026-08-15

## Problem

Chatwoot Daily ใช้ stable-ID two-pass discovery แบบเดียวกับ Initial/Reconciliation. แม้ operation
จะเลือกเขียนเฉพาะ Conversation ที่เปลี่ยนใน rolling 3 days แต่ทุก Daily ต้องอ่าน mutable offset pages
ครบทั้งบัญชี แล้วเริ่มจาก page 1 อีกหนึ่ง pass เพื่อพิสูจน์ convergence. เมื่อ inventory มีประมาณ 7,800
Conversations จึงใช้ Provider requests และ Queue continuations จำนวนมากโดยไม่เพิ่มข้อมูลธุรกิจตามสัดส่วน.

## Confirmed source contract

- Public Conversations List documentation ไม่มี absolute updated-after cursor.
- Current Chatwoot source `ConversationFinder` รองรับ `updated_within` เป็นจำนวนวินาที และเมื่อใช้
  parameter นี้จะคืน relation ที่ `conversations.updated_at` ใหม่กว่าขอบเขตโดยไม่ใช้ offset pagination.
- Current Chatwoot Message callback อัปเดตทั้ง `last_activity_at` และ Conversation `updated_at` เมื่อมี
  Message ใหม่. Conversation state changes ใช้ normal update contract และเปลี่ยน `updated_at` เช่นกัน.
- Account Reporting Events มี `since`/`until` server-side filter อยู่แล้วและไม่ต้องใช้ full Conversation scan.

## Repository correction

Daily Incremental ใช้ Provider `updated_within` exactly once ต่อ operation โดยคำนวณช่วงจาก immutable
Queue window start ถึงเวลาที่ invocation เริ่ม พร้อม clock-skew overlap 5 นาที. Result ต้องเป็น page 1,
`hasMore=false`, อยู่ภายใต้ response/row bounds และถูก deduplicate เป็น stable numeric IDs ก่อน exact
Conversation detail reads. Runtime ยังคงตรวจ `created_at <= immutable end`, กรอง
`updated_at`/`last_activity_at`/`created_at` ใน rolling 3-day window และใช้ stable D1/Lark keys เดิม.

Initial 30-day และ legacy operation ที่เริ่ม full discovery ไปแล้วจะคง stable-ID two-pass path เดิม.
Additive durable-state fields ทำให้ deployment ไม่เปลี่ยน strategy กลาง operation: state เก่าที่มี discovery
progress จะ migrate เป็น `stable_identity_two_pass`; เฉพาะ fresh Daily state ใช้ `updated_within_once`.

## Safety and rollout

- ไม่มี Webhook, Queue admission, replay/redrive, manual Chatwoot run, schedule หรือ secret change ใน rollout.
- Daily continuation เดิมจบด้วย deployed code เดิมก่อน deploy patch จึงไม่มีการเปลี่ยน strategy กลางงาน.
- ก่อน deploy ต้องทำ GET-only Provider preflight ให้ยืนยันว่า tenant รองรับ `updated_within` และคืน bounded
  unpaginated result จากนั้นจึง reviewed merge/deploy และรอ fresh scheduled Daily evidence.
- Post-deploy acceptance: one Conversation discovery request, detail readsเฉพาะ changed IDs, exact
  checkpoint generation, zero new exact alert/DLQ, และ D1/Lark parity 15 targets.

## GET-only tenant preflight

หลัง exact Daily `chatwoot-daily-20260814` จบ `completed` โดย failed units, exact open alerts, DLQ และ
active locks เป็นศูนย์ ได้เรียก Provider GET-only หนึ่งครั้งด้วย `updated_within=259500` seconds. Tenant
คืน 51 rows / 51 unique numeric IDs, duplicates 0, `hasMore=false`, total count 51 และ transport attempt 1.
Preflight ไม่ส่ง Queue, ไม่เขียน D1/Lark, ไม่เปลี่ยน schedule/secret และไม่ deploy.

## Reviewed merge and deployment

PR #643 ผ่าน Branch Verification และ merge เข้า `main` ที่
`77f9c92efe36a6b36d6eed66bffc04e90326fe10`. Wrangler real-config dry-run ผ่านก่อน deploy.
Integration Worker version `9d768d22-4f96-48aa-87d7-f1dd86c991a6` รับ traffic 100% โดยใช้ deployment
message ที่ผูกกับ exact merge SHA. Config, secrets, schedules และ Queue topology เดิมไม่ถูกเปลี่ยน.

Immediate D1 readback หลัง deploy พบ system alert ใหม่ 0, DLQ ใหม่ 0, active lock 0 และไม่มี Chatwoot
Work ที่ถูกสร้างหรืออัปเดตหลัง deploy จึงยืนยันว่า rollout ไม่ได้ใช้ manual run เป็นหลักฐาน. Final live
acceptance ต้องรอ fresh scheduled Daily operation รอบถัดไปและตรวจ one-request discovery, exact detail
selection, checkpoint generation, alert/DLQ และ D1/Lark parity ตาม contract เดิม.

```text
DAILY_DISCOVERY          = UPDATED_WITHIN_ONCE
DAILY_WINDOW             = IMMUTABLE_ROLLING_3_DAYS_PLUS_5_MIN_CLOCK_SKEW
INITIAL_RECONCILIATION   = STABLE_IDENTITY_TWO_PASS
LEGACY_ACTIVE_STATE      = PRESERVE_EXISTING_TWO_PASS_STRATEGY
WEBHOOK_REQUIRED         = NO
CURRENT_ACTIVE_OPERATION = TERMINAL_COMPLETED
TENANT_PREFLIGHT         = PASS_51_UNIQUE_ONE_REQUEST_UNPAGINATED
MERGE_DEPLOY             = PR_643_MERGED_WORKER_9D768D22_100_PERCENT
POST_DEPLOY_READBACK     = PASS_ALERT_0_DLQ_0_LOCK_0_MANUAL_WORK_0
SCHEDULED_VALIDATION     = PENDING_NEXT_DAILY_0745_ASIA_BANGKOK
PRODUCTION               = BLOCKED
```
