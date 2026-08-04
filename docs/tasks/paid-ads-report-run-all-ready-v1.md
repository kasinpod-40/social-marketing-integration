# Paid Ads Report + Run All Ready Channels v1

## Objective

เตรียมช่องทาง Paid Ads ให้ใช้ Shared Report Runtime เดิม และเพิ่มคำสั่งเดียวสำหรับ Materialize ทุกช่องทางที่ผ่าน Remote readiness แล้ว โดยช่องทางที่ยังไม่มีข้อมูลหรือยังเป็น Planned ต้องถูกข้ามอย่างปลอดภัย ไม่สร้าง Report หรือเลขศูนย์ปลอม

## Channel scope

```text
facebook       organic             uat_pending
instagram      organic             uat_pending
youtube        organic             active
meta_ads       paid_ads            uat_pending
google_ads     paid_ads            uat_pending
tiktok_ads     paid_ads            planned
woocommerce    commerce            active
chatwoot       customer_service    uat_pending
```

TikTok Organic ใช้ canonical closeout route เดิมที่มีอยู่แล้วและไม่ถูกย้ายเข้ากลุ่มนี้

## Existing authorities reused

Paid Ads ใช้ของกลางเดิมทั้งหมด:

```text
D1AdsReportSource
→ ads_daily_facts account level / no breakdown / no segment
→ ads_daily_facts ad level / no breakdown / no segment
→ calculateAdsPeriodMetrics
→ report_materializations
→ MKT_Report_Snapshots
→ MKT_Report_Metric_Values
→ MKT_Report_Top_Ads
```

- additive metrics ต้อง SUM ที่ report level เดียวก่อนคำนวณ CTR/CPC/CPM/CPA/ROAS
- Top Ads ใช้ Stable ad identity และ deterministic ranking เดิม
- Coverage ใช้ `dataset_key=ads_daily_facts`
- Report identity ใช้ canonical Integration Workspace account key `chemistry_k`
- ไม่มี Ads Report database, writer, Queue, Reliability engine หรือ Lark engine ใหม่

## Paid Ads readiness

`meta_ads` และ `google_ads` พร้อมเข้าสู่ closeout เมื่อมีครบ:

- completed Coverage และ source watermark
- period end ที่ถูกต้อง
- account-level facts มากกว่า 0 และ ad-level facts มากกว่า 0 หรือ Coverage เป็น `no_data_confirmed`
- no active Report work/lock
- no open Report DLQ/critical alert
- Lark Report tables และ Stable keys ครบ
- exact 1D/3D/7D/30D prestate ผ่าน

`tiktok_ads` ยังคง `planned` และถูกข้ามเสมอจน Source contract ถูก promote ผ่าน Workstream ของตัวเอง แม้มี readiness-shaped input ก็ห้ามสร้าง Report

## Run All behavior

Plan-only:

```bash
node scripts/report-all-ready-channels-terminal.mjs
```

Guarded execution หลัง Meta Remote lock release และ retained all-channel handoff พร้อม:

```bash
MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=<retained-all-channel-handoff.json> \
CONFIRM_REPORT_ALL_READY_CHANNELS=RUN_ALL_READY_CHANNEL_REPORTS \
node scripts/report-all-ready-channels-terminal.mjs --execute
```

Run All ทำงานตามลำดับช่องทางและเรียก `scripts/multichannel-report-live-closure-terminal.mjs` เดิมทีละช่องทาง:

1. เลือกเฉพาะ readiness `readyForLive=true`
2. ตรวจ per-channel closeout authority
3. Materialize 1D/3D/7D/30D
4. ตรวจ D1/Lark parity และ same-input replay
5. คืน Worker all-false ผ่าน existing `finally`
6. ไปช่องทางถัดไป

ช่องทางที่ยังไม่พร้อมจะอยู่ใน `waiting` พร้อม reason code เช่น:

```text
REPORT_SOURCE_PLANNED
REPORT_READINESS_MISSING
REPORT_READINESS_NOT_READY
REPORT_READINESS_TARGET_INVALID
REPORT_READINESS_WINDOWS_INVALID
REPORT_CLOSEOUT_AUTHORITY_MISSING
REPORT_CLOSEOUT_AUTHORITY_INVALID
```

ความล้มเหลวของช่องทางหนึ่งหยุด Run All หลัง existing channel operator ทำ Safe restore แล้ว เพื่อไม่ข้ามข้อผิดพลาดหรือเปิด Remote window ซ้อน

## Safety

```text
Repository implementation remote action   0
Provider request                           0
Queue send                                 0
Remote D1/Lark write                       0
Worker upload/deployment                   0
Schedule                                   disabled
Production                                 BLOCKED
```

งานนี้ไม่แก้ Meta connector/use-case/recovery paths, retained Meta evidence, numbered migration, Lark Native AI หรือ `docs/current-task.md` และไม่อนุญาต Live execution ขณะ Meta PR #421 ยังถือ Remote lock

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-closeout-reviewed-binding.test.js
node --test tests/scripts/report-channel-remote-readiness.test.js
node --test tests/scripts/report-all-ready-channels.test.js
node --test tests/scripts/report-runtime-closeout-operator.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
