# Report Reliability Hardening v0.7.1

## สถานะ

รุ่นนี้ซ่อม Release blockers ที่พบหลัง Review `v0.7.0-tiktok-organic-report-foundation` โดยไม่เปลี่ยน Lark Report Blueprint หรือสูตร Metric v1. Report schedule ต้องคง `false` จนกว่า Schema, Seed และ Live DEV UAT จะผ่าน

## Correctness ที่แก้

1. **Report failure status** — Error ก่อนเขียนแถวแรกโยน Cause เดิมและจบเป็น `failed`; สร้าง `PartialSyncError` เฉพาะเมื่อมี confirmed/unknown write progress จริง
2. **Deterministic scheduled dates** — Scheduler ใส่ `metricDate` สำหรับ TikTok Sync และ `periodEnd` สำหรับ Daily/Weekly Report จาก `scheduledTime` ตาม Timezone ตั้งแต่ Producer เพื่อให้ Retry/Queue delay ข้ามวันไม่เปลี่ยน identity
3. **Top Content consistency** — Resolve `effectiveTopContentLimit` ครั้งเดียว, จำกัด 1–100 และใช้ค่าเดียวกับ JSON snapshot กับ normalized table
4. **Stale rank cleanup** — เมื่อ Limit ลดลง ระบบอ่าน Rank เดิมและเขียน Rank ส่วนเกินเป็น `data_status=no_data`; Client View ต้องกรอง `data_status != no_data`

## Reliability ที่แก้

- `assertActive()` ตรวจ Lease expiry และหยุดก่อนเขียนเพิ่มด้วย `SYNC_LOCK_LEASE_EXPIRED`
- `beforeChunk` อยู่ใน write failure boundary เพื่อรักษา confirmed progress ของ Chunk ก่อนหน้า
- HTTP 429 / Lark code `1254290` ที่ Retry หมดยังคงเป็น retryable rejection ไม่ถูกเปลี่ยนเป็น ambiguous/unknown write
- Local file lease manager serialize acquire/renew/release ด้วย exclusive guard file และ fail closed หาก Guard ค้าง
- Repository hygiene ปฏิเสธ `.dev.vars` และ `wrangler.sync.jsonc` ที่ยังถูก Git Track

## Observability

`wrangler.sync.example.jsonc` เปิด persisted Workers Logs และ Traces ที่ sampling 100% สำหรับ DEV Reliability UAT. Production ต้องเลือก sampling ตามปริมาณงานและงบใน Config ของลูกค้า

## Local config migration

Repository ที่เคย Track `wrangler.sync.jsonc` ต้องรันครั้งเดียว:

```bash
git rm --cached wrangler.sync.jsonc
```

ไฟล์จริงยังอยู่ในเครื่องและถูก `.gitignore` ต่อไป. ห้ามนำ DEV D1/Lark resource IDs ไปใช้เป็น Production profile

## Release gate

```bash
npm ci
npm run check
npm test
npm run deploy:dry-run
```

หลัง Code gate ผ่านจึงดำเนินงานตาม `tiktok-organic-report-blueprint-v0.7.0.md`:

1. Apply Lark Schema
2. Configure local Table IDs
3. Seed Metric Definitions และ Report Settings พร้อม idempotent rerun
4. Manual Daily/Weekly Queue UAT
5. Failure/retry/partial-write UAT
6. Client Views และ Permission
7. เปิด Report schedule หลังผ่านครบเท่านั้น
