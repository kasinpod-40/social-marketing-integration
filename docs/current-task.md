# Current Task — Full Codebase Pre-Meta Hardening v0.11.1

## Task metadata

- **Status:** `approved_for_implementation`
- **Source baseline:** `fc796a40440bf10b3f382ba30ec9dc1b65d568bf`
- **Working branch:** `work/pre-meta-hardening-v0.11.1`
- **Working release:** `v0.11.1-pre-meta-hardening`
- **Environment:** developer-owned DEV profile `dev_ft_pumkin`
- **Production ownership:** customer-owned resources only
- **Implementation gate:** `hardening_approved_meta_connector_still_blocked`
- **Last updated:** `2026-07-20`

## Previous task closeout

- TikTok DEV durable resume, guarded deploy, scheduled smoke and final D1 health passed on `d7b28c9`.
- Final TikTok active work/phase/unit/lock/open DLQ/open alert = `0/0/0/0/0/0`.
- YouTube remains `dev_ready`; customer-owned 837-video Live UAT remains a Production blocker.
- Meta Blueprint draft exists but requires contract parity corrections before approval.
- Production remains disabled.

## Security prerequisite

YouTube API/OAuth credentials visible in a previous screenshot must be rotated before the next external UAT or deploy. Update only local ignored configuration and the Cloudflare secret store. Offline source hardening and tests may continue, but do not use the old credentials for external calls.

## Objective

แก้ Technical debt และช่องว่างที่พบจาก Full Repository Audit ให้ Foundation รองรับ Facebook Organic, Instagram Organic และ Meta Ads โดยไม่คัดลอกปัญหาเดิมไปยัง Connector ใหม่ พร้อมรักษา TikTok/YouTube behavior, stable-key idempotency, durable resume, reliability และ customer-owned Production contract เดิม

## Approved implementation scope

### 1. Contract and timezone hardening

- ทำ Canonical Organic/Ads date contract ให้รับ Source timezone หรือ source-derived epoch โดยไม่ hardcode Bangkok ใน Domain กลาง
- ทำ Duplicate resolution policy กลางที่ deterministic และใช้ความหมายเดียวกันทั้ง Normalizer/Sync Engine
- แก้ Meta Blueprint/Source parity โดยเฉพาะ Canonical Ads key field names
- เพิ่ม Contract parity tests สำหรับ Source/Blueprint artifacts ที่อยู่ใน Repository

### 2. Bounded large-account processing

- สร้าง Shared single-page source contract ที่มี cursor guard, max-page guard และ exact completeness metadata
- ปรับ Meta Graph transport ให้รองรับ single-page reads, bounded retry/backoff, body timeout และ safe usage/rate-budget telemetry
- ห้าม Meta implementation ใช้ full-edge accumulator สำหรับ full backfill
- ปรับ TikTok durable flow ให้ normalize/plan/write เป็น bounded units โดยไม่ประกอบทุก staged record กลับเป็น Array เดียว
- รักษา generation fence ก่อน source read, staging, plan, write chunk และ checkpoint

### 3. Reliability and D1

- ป้องกัน resolved alert ถูก incident เดิมเปิดซ้ำโดยไม่ตั้งใจ
- ลด Lark mirror latency จาก critical path ของ D1 primary ด้วย durable/bounded mirror delivery contract
- ใช้ additive migration เท่านั้นและต้องผ่าน empty/existing migration replay
- ตรวจ retention/cleanup ของ durable work, alert, DLQ และ mirror outbox

### 4. Runtime architecture

- แยก `apps/sync-worker/src/index.js` เป็น queue boundary, scheduler, runtime composition และ job handlers ตาม platform/use case
- เอา TikTok-specific report assumptions ออกจาก generic routing
- รวม result/partial-write/reliability mapping เฉพาะส่วนที่มี semantics ตรงกัน
- ห้ามเปลี่ยน Queue payload schema หรือ Production behavior โดยไม่มี migration/compatibility test

### 5. Report performance

- เพิ่ม filtered query contract สำหรับ `account_id + platform + metric_date range`
- ห้าม Report อ่าน Daily history ทั้งหมดแล้วคัดช่วงเวลาใน Memory เมื่อสามารถกรองที่ Source ได้
- เพิ่ม large-history fixture และ bounded-read assertions

### 6. Security and operational redaction

- ครอบคลุม Page ID, Instagram account ID, Ad account ID, account key, customer profile, Lark table ID และ generic external identity
- แยก internal debug context ออกจาก Operational Log/D1/Lark mirror payload
- รักษา counters/completeness ที่ปลอดภัยและห้าม Redact จนใช้งานไม่ได้
- เพิ่ม secret/identity leak regression tests

### 7. Cleanup and automated audit gates

- ตรวจ usage ก่อนลบ compatibility exports, aliases, files และ legacy D1 tables
- Mark deprecated พร้อม removal evidence เมื่อยังลบไม่ได้อย่างปลอดภัย
- เพิ่ม unused/dead candidate, duplicate-code, complexity/file-size และ large-account gates
- ห้ามแก้ migration ที่ Apply แล้ว

### 8. Meta Blueprint correction

- แก้ Canonical key names ให้ตรง Source (`ads_campaign_key`, `ads_ad_group_key`, `ads_ad_key`, `ads_creative_key`)
- ล็อก timezone, null, aggregate/breakdown, money micros, conversion และ ownership semantics
- Meta Connector implementation, Lark Apply, external Meta API UAT และ schedule ยังถูก Block จน hardening gates และ Blueprint review ผ่าน

## Out of scope for this release

- Facebook/Instagram/Meta Ads business adapters หรือ production connectors
- Meta token/app-review live operations
- Lark Meta schema Apply หรือ record writes
- Cloudflare DEV/Production deploy ก่อน source gates ผ่านและผู้ใช้อนุมัติ rollout
- Customer Production changes
- Ads write operations

## Required tests and gates

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

เพิ่ม focused gates:

- Meta single-page/repeated-cursor/body-timeout/rate-limit tests
- timezone contract tests รวม non-Bangkok และ DST timezone
- deterministic duplicate-resolution tests
- operational identity/secret leak tests
- resolved-alert non-reopen tests
- D1 migration replay tests
- TikTok 1,000+ record interrupted/resume and bounded-memory tests
- Report large-history/date-range tests
- repository unused/duplicate/complexity audits

## Definition of Done

- Scope ข้างต้นผ่าน Test และ Review ครบ
- TikTok/YouTube regression ผ่านโดยไม่มี behavior drift ที่ไม่อนุมัติ
- ไม่มี unbounded full-source accumulator ใน runtime path ที่ใช้กับบัญชีใหญ่
- D1 primary และ reliability state ยังคง fail-closed/idempotent
- Meta Blueprint ตรงกับ Canonical Source contract
- Repository ไม่มี Secret/local config/generated artifact/dead file ที่พิสูจน์แล้ว
- `docs/current-task.md`, Project Brain, README และ CHANGELOG อัปเดตตามหลักฐานจริง
- DEV rollout แยกเป็นขั้นตอน guarded และ Production ยังคงปิด

## Implementation result

`in_progress`

### Started

- Created branch `work/pre-meta-hardening-v0.11.1` from `fc796a40440bf10b3f382ba30ec9dc1b65d568bf`.
- Full-repository audit findings accepted as implementation scope.

### Not yet claimed

- No test, migration, external API call, Lark mutation, Worker deploy, schedule change or Production mutation has been performed in this hardening branch yet.
