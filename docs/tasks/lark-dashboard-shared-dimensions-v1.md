# Lark Universal Dashboard Phase A — Shared Report Dimensions

## Status

```text
REPOSITORY_IMPLEMENTATION = COMPLETE
FULL_VALIDATION           = PASS
REMOTE_ACTIONS            = 0
LARK_SCHEMA_APPLY         = NOT_RUN
STACKED_BASE              = agent/lark-native-universal-dashboard-v1
```

## Objective

เติม Shared dimensions ที่ Lark Base Native Dashboard ใช้กรองและ map ข้าม Source ให้ Report
output ทั้งสี่ตาราง โดยคง Dashboard/View ชุดกลางและไม่สร้าง View แยก Platform หรือ Account:

```text
MKT_Report_Snapshots
MKT_Report_Metric_Values
MKT_Report_Top_Content
MKT_Report_Top_Ads
```

ทุก Dashboard row มีมิติร่วม:

```text
customer_key
customer_profile
capability
platform
account_id
report_setting_key
report_type
period_kind
window_days
period_start
period_end
data_status
coverage_rate
generated_at
```

## Schema additions

Schema เป็น Additive only และใช้ installer เดิม:

| Table | Fields added |
| --- | --- |
| `MKT_Report_Snapshots` | `customer_key`, `capability`, `coverage_rate` |
| `MKT_Report_Metric_Values` | `customer_key`, `capability`, `period_kind`, `window_days`, `coverage_rate` |
| `MKT_Report_Top_Content` | `customer_key`, `capability`, `period_kind`, `window_days`, `coverage_rate` |
| `MKT_Report_Top_Ads` | `customer_key`, `capability`, `period_kind`, `window_days`, `coverage_rate` |

Field contract:

```text
customer_key    Text
capability      Text / extensible lowercase key
period_kind     SingleSelect: rolling_days, custom_range
window_days     Number / formatter 0
coverage_rate   Number / formatter 0.0000
```

`baseline_coverage_rate` ของ Snapshot ยังคงอยู่และไม่ถูก Rename/Delete/แทนที่:

```text
coverage_rate           = Coverage รวมของ Report materialization
baseline_coverage_rate  = Organic baseline coverage เดิม
```

เพื่อรักษา Compatibility ของ Writer เดิม Phase A ยังคงเขียน
`baseline_coverage_rate=payload.coverageRate` สำหรับทุก Capability โดยไม่ reinterpret หรือล้าง
ค่าของ Paid Ads ระหว่าง normal rerun. Field ใหม่ `coverage_rate` เป็น Universal shared Coverage
dimension; การ cleanup ความหมายหรือข้อมูลเก่าของ `baseline_coverage_rate` ต้องเป็น workstream
แยกที่ผ่านการ Review และ confirmation.

Focused schema preview จำลอง Base ที่มี schema ก่อน Phase A ครบแล้ว ได้ 18
`create_field`, `create_table=0`, `update_field=0`, `conflicts=0` และ
`readyToApply=true`.

## Writer mapping

เส้นทางเดิมยังคงเป็น:

```text
validated report_materializations row + checksummed payload
→ writeDashboardMaterializationToLark
→ existing TableSyncEngine planByKey/executePlan
→ Snapshot / Metric Values / Top Content / Top Ads
```

Writer สร้าง Shared dimension object หนึ่งครั้งต่อ validated materialization แล้วใช้ object
เดียวกันกับทุก output row. D1 reader ตรวจ Storage contract, Stable report ID, payload checksum
และ metadata parity ของ Platform, Report type, Period, Status, Coverage และ Generated time
ก่อน writer ทำงาน. Writer ไม่คำนวณ Business metric ใหม่และไม่มี Detailed D1 fact read.

Stable keys เดิมไม่เปลี่ยน:

```text
Snapshot     report_id
Metric       report_id::metric_key::summary::all
Top Content  report_id::rank:N
Top Ads      report_id::rank:N
```

## Compatibility

- Schema Apply เป็น Additive only.
- แถวเก่าไม่ถูกลบ แก้ Business facts หรือ Remote backfill ระหว่าง Implementation.
- Writer ใหม่เติม Shared dimensions เมื่อ materialization ถูกเขียน/อัปเดตรอบถัดไป.
- `custom_range` คง `window_days=null`.
- `coverage_rate=null` คง `null`; observed zero คง `0`.
- Snapshot `baseline_coverage_rate` คง legacy write behavior จาก `payload.coverageRate` ทุก
  Capability เพื่อไม่ให้ Paid Ads rerun ล้างค่าที่มีอยู่.
- ไม่เดา `customer_key`, `capability` หรือ Coverage ของแถวเก่าจากชื่อ Platform.
- หากต้อง backfill แถวเก่า ให้เปิด operator/workstream แยกที่มี Preview และ explicit
  confirmation.

## Test evidence

Focused Phase A:

```bash
node --test tests/application/lark-dashboard-shared-dimensions.test.js
```

ครอบคลุม schema ทั้งสี่ตาราง, type/formatter, extensible capability, additive-only preview,
Snapshot/Metric/Top Content/Top Ads mapping, custom null, observed zero, Stable keys,
idempotent rerun, materialization metadata parity และ View hardcode guard.

Expanded Report/Dashboard regression:

```bash
node --test \
  tests/application/lark-dashboard-shared-dimensions.test.js \
  tests/config/lark-report-schema-v2.test.js \
  tests/config/lark-report-views.test.js \
  tests/application/report-output-rows.test.js \
  tests/application/multichannel-report-runtime.test.js \
  tests/application/generate-tiktok-organic-report.test.js \
  tests/application/report-snapshot.test.js
```

ผล focused ปัจจุบัน: Phase A `7/7 PASS`; expanded regression `34/34 PASS`.

Full Repository validation:

```text
npm ci                                      PASS
npm run check                               PASS / 390 files / 1012 deps / 0 cycles
npm test                                    Node 1406/1406 PASS
npm run test:worker                         14/14 PASS outside restricted sandbox
npm run test:report-reliability             100/100 PASS
npm audit                                   PASS / 0 vulnerabilities
npm run deploy:dry-run                      PASS / API + Sync Worker / no deployment
npx wrangler deploy --dry-run
  --config wrangler.sync.jsonc
  --env development                         PASS / no deployment
git diff --check                            PASS
```

Workers suite ต้อง rerun นอก restricted sandbox เพราะ Wrangler log path และ localhost listener
ถูก sandbox ปฏิเสธด้วย `EPERM`; rerun เดิมผ่าน `14/14`. Exact `wrangler.sync.jsonc --env
development` dry-run ผ่านพร้อม warning ว่า config ใช้ top-level development settings และไม่มี
named `[env.development]`; ไม่มี deployment.

Review correction หลัง Draft PR `#237` คืน legacy
`baseline_coverage_rate=payload.coverageRate` สำหรับ Paid Ads Snapshot และเพิ่ม regression ที่
ยืนยัน observed zero คงเป็น `0` แทนการ clear เป็น `null`. Focused, expanded และ Full Repository
gates ด้านบน rerun ผ่านบน corrected tree.

## Remote boundary

Implementation นี้ทำเฉพาะ Repository:

```text
Worker deployment       0
Remote D1 action        0
Queue/DLQ message       0
Lark Table/View/Record  0
Dashboard mutation      0
Schedule/Cron           0
Secret/config mutation  0
Production              blocked
```

ห้ามรัน Apply ใน workstream นี้.

## Preview and Apply commands

หลัง stacked PR merge และก่อน Apply ให้รัน Read-only Preview:

```bash
npm run setup:report-schema
```

Apply เป็น operation แยกและต้องได้รับ explicit confirmation:

```bash
CONFIRM_WRITE=YES npm run setup:report-schema:apply
```

## Post-apply verification

หลัง Apply ที่ได้รับอนุมัติแยก:

1. รัน `npm run setup:report-schema` อีกครั้งและต้องได้ zero actions/conflicts.
2. ยืนยัน 18 Field ใหม่ด้วย exact names/types/formatters.
3. ยืนยัน `baseline_coverage_rate` ยังอยู่และ type/formatter ไม่เปลี่ยน.
4. Materialize หนึ่ง `custom_range` และตรวจ `window_days` ว่างทุก output row.
5. ตรวจหนึ่ง null Coverage และหนึ่ง observed-zero case โดยไม่ปะปน.
6. Rerun materialization เดิมและยืนยันไม่มี Stable-key duplicate.
7. ตรวจ `🧭 Dashboard Reports`, `🧭 Dashboard Metrics`, `🧭 Dashboard Top Content`,
   `🧭 Dashboard Top Ads` ว่ายังคงกรองเฉพาะ shared Report contract และไม่ hardcode Platform
   หรือ Account.

## Dashboard dependency

Phase A เป็น stacked dependency ของ PR `#236`
(`agent/lark-native-universal-dashboard-v1`). หลัง schema apply และ post-apply verification
ผ่าน จึงเริ่มสร้าง `🌱 Organic Performance` ใน Lark UI ตาม Public OpenAPI boundary ของ PR
ดังกล่าว.
