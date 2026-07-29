# Lark Dashboard Shared Dimensions Backfill v1

## Status

```text
TASK_STATUS           = IMPLEMENTED_FOR_CI
BASE_MAIN             = f4c74a855072f92a2249b2132c4ca1e256f2cd0f
BRANCH                 = agent/lark-dashboard-shared-dimensions-backfill-v1
REMOTE_ACTIONS         = 0
LARK_APPLY             = NOT_RUN
WORKER_DEPLOYMENT      = 0
QUEUE_MESSAGE          = 0
PROVIDER_CALL          = 0
SCHEDULE_MUTATION      = 0
```

## Problem

หลัง Apply `report-materialization-schema-v3` Field ใหม่ของ Phase A มีอยู่จริง แต่ Report rows
ที่เขียนก่อน Phase A ยังไม่มีค่า:

```text
customer_key
capability
period_kind
window_days
coverage_rate
```

Lark Dashboard Slicer จึงเห็นเพียง `(Empty)`. ห้ามกรอกหรืออนุมานค่าด้วยมือจาก Platform,
Account หรือชื่อ Setting เพราะจะทำลาย authoritative materialization contract.

## Objective

เติมเฉพาะ Shared dimension fields จาก `report_materializations` ที่ตรวจ Storage contract,
payload checksum และ metadata parity ผ่านแล้ว ไปยัง Lark Report rows เดิมผ่าน:

```text
Remote D1 read-only SELECT
→ D1ReportMaterializationReader validation
→ writeDashboardMaterializationToLark row construction
→ restricted-field TableSyncEngine planning
→ existing stable-key Lark updates only
```

Operator ไม่สร้าง Report ใหม่ ไม่เรียก Provider ไม่ Deploy Worker ไม่ส่ง Queue และไม่เปิด Schedule.

## Scope

Target ถูกล็อกเป็น:

```text
environment      development
profileKey       integration_workspace
customerKey      chemistry_k
infrastructure   developer
report_type      dashboard_performance_report
platform_scope   facebook, instagram, tiktok, youtube
```

Remote D1 query ถูกจำกัดเริ่มต้นไม่เกิน 100 materializations และ fail closed เมื่อเกินขอบเขต.

## Fields allowed to change

| Table | Allowed fields |
| --- | --- |
| `MKT_Report_Snapshots` | `customer_key`, `capability`, `coverage_rate` |
| `MKT_Report_Metric_Values` | `customer_key`, `capability`, `period_kind`, `window_days`, `coverage_rate` |
| `MKT_Report_Top_Content` | `customer_key`, `capability`, `period_kind`, `window_days`, `coverage_rate` |
| `MKT_Report_Top_Ads` | `customer_key`, `capability`, `period_kind`, `window_days`, `coverage_rate` |

Stable key ถูกส่งเข้า Plan เพื่อหาแถวเดิม แต่ไม่ถือเป็น Business-field mutation.

ห้ามเปลี่ยน:

```text
metric/current/compare/change values
Top Content metrics/rank/URL
source_snapshot_count
baseline_coverage_rate
data_status
generated_at
period dates
Report JSON
```

## Safety gates

1. ต้องรันบน clean `main` ที่ตรง `origin/main`.
2. Preview เป็น Default และทำ Remote D1/Lark reads เท่านั้น.
3. Query ต้องคืน Materialization IDs ไม่ซ้ำและไม่เกิน Bound.
4. ทุก row ต้องผ่าน `D1ReportMaterializationReader` checksum/metadata validation.
5. Plan ทุก Materialization และทุก Table ต้องเสร็จก่อน Write แรก.
6. ถ้า Plan มี `createRows > 0` ให้ block ทั้ง Apply; Operator อัปเดตแถวเดิมเท่านั้น.
7. Apply ต้องยืนยันสองค่า:

```text
CONFIRM_WRITE=YES
CONFIRM_LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL=BACKFILL_VALIDATED_MATERIALIZATIONS
```

8. หลัง Apply ต้อง Re-plan และได้ `createRows=0`, `updateRows=0`.
9. Null Coverage และ `window_days=null` ต้องคงเป็น null; observed zero ต้องคงเป็น 0.

## Commands after merge

Read-only Preview:

```bash
node scripts/lark-dashboard-shared-dimensions-backfill.mjs
```

Apply หลังตรวจ Preview และอนุมัติแยก:

```bash
CONFIRM_WRITE=YES \
CONFIRM_LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL=BACKFILL_VALIDATED_MATERIALIZATIONS \
node scripts/lark-dashboard-shared-dimensions-backfill.mjs --apply
```

Preview ซ้ำหลัง Apply:

```bash
node scripts/lark-dashboard-shared-dimensions-backfill.mjs
```

Expected post-Apply summary:

```text
createRows = 0
updateRows = 0
```

## Required tests

- Argument and exact confirmation gates.
- Customer/Organic/report-type SQL scope and row bound.
- Wrangler D1 JSON parsing and failure handling.
- Duplicate report ID and overflow rejection.
- Restricted-field filtering.
- `custom_range` null and observed-zero preservation.
- No Lark write during Preview.
- Full preflight before Apply.
- Create-row block before Write.
- Post-Apply zero-drift assertion.
- Existing Report, TikTok and Shared Core regressions.

## Remote boundary during implementation

```text
Remote D1 read/write     0 / 0
Lark read/write          0 / 0
Worker deployment        0
Queue/DLQ                0
Provider call            0
Schedule/Cron            0
Secret mutation          0
Production               blocked
```

`docs/current-task.md` ไม่ถูกแก้ เพราะมี YouTube UAT Workstream เป็น Current authority อยู่แล้ว;
เอกสารนี้เป็น Parallel task file และห้ามลบ Business facts ของ Workstream อื่น.
