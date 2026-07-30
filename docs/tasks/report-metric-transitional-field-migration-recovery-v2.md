# Report Metric Transitional Field Migration Recovery v2

## Incident

Organic Dashboard readiness Live operator หยุดอย่างปลอดภัยที่
`report-metric-value-field-migration-preview` ก่อน Schema Apply และก่อน Runtime activation.

Sanitized blockers ที่ยืนยันจาก Live tenant:

```text
display_name
  REPORT_METRIC_FIELD_MIGRATION_CANONICAL_WITHOUT_SOURCE
  canonical Text มีค่าบน Records รุ่นใหม่ แต่ retained legacy SingleSelect ว่าง

window_days
  REPORT_METRIC_FIELD_MIGRATION_STATE_UNSUPPORTED
  canonical-name field และ retained legacy v1 field เป็น SingleSelect ทั้งคู่
```

Attempt นี้ไม่มี Lark schema/data mutation, Worker deployment, Queue send, Remote D1 write,
Schedule/AI activation หรือ Production action.

## Root cause

Migration v1 รองรับเส้นทางเริ่มต้นและ partial state แบบ canonical target + legacy source แต่ยังไม่รองรับ
transitional state สองแบบที่เกิดจริง:

1. Canonical Text เป็น authority ของ Record รุ่นใหม่โดยไม่มี legacy value.
2. Interrupted `window_days` migration ทิ้ง SingleSelect source สอง Field ที่อาจมีค่าอยู่คนละ Record.

การถือ canonical-only value เป็น conflict ทำให้ false blocker. การพยายามเลือก SingleSelect Field ใด Field
หนึ่งโดยไม่รวมค่าทั้งสองจะเสี่ยงทำข้อมูลหาย.

## Recovery contract

Normal state ยังคงใช้ Migration v1 เดิม. Recovery adapter ทำงานเฉพาะเมื่อ blocker ทุกตัวอยู่ใน exact
allowlist:

```text
REPORT_METRIC_FIELD_MIGRATION_CANONICAL_WITHOUT_SOURCE
REPORT_METRIC_FIELD_MIGRATION_STATE_UNSUPPORTED
```

### `display_name`

- Canonical-only Text value: ยอมรับเป็นค่าที่ถูกต้อง.
- Legacy-only value: backfill ไป Canonical Text.
- Legacy + Canonical ตรงกัน: converge.
- Legacy + Canonical ไม่ตรงกัน: fail closed ก่อน mutation.

### `window_days`

Exact resumable phases:

```text
archive retained legacy v1 -> retained legacy v2
rename wrong-type canonical Select -> retained legacy v1
create Number canonical window_days
backfill canonical from lossless union of retained Select sources
fresh bounded verification
```

Retained identities:

```text
__mkt_legacy_window_days_single_select_v1
__mkt_legacy_window_days_single_select_v2
```

ค่าจาก source fields ทุก Field ถูก normalize เป็น canonical preset day และรวมต่อ Record:

- ไม่มีค่า: Canonical คง null.
- มีค่าเดียว: ใช้ค่านั้น.
- มีหลาย Fieldแต่ค่าเดียวกัน: ใช้ค่านั้น.
- มีหลายค่าขัดกัน: fail closed ก่อน mutation.

## Integrity and resume

- Record count ถูกตรึงตลอด operation.
- Legacy values fingerprint แยกตาม immutable Field ID ก่อนและหลัง.
- Rename/Create/Backfill แต่ละ Phase มี fresh bounded readback.
- Interrupted execution สามารถ resume จาก State ปัจจุบันโดยไม่ทำ Phase เดิมซ้ำ.
- Legacy Field/value mutation count ต้องเป็น 0.
- Delete count ต้องเป็น 0.
- Canonical batch write ทำเฉพาะ Missing values.

## Repository implementation

```text
Branch        hotfix/report-metric-transitional-field-migration-v2
PR            #307
Base main     9a0d06e268713ad349fc7a4d6623a3dcfcda125e
Remote action none
```

Files:

```text
scripts/lib/report-metric-value-field-migration-recovery.js
scripts/migrate-report-metric-value-field-types.mjs
tests/scripts/report-metric-value-field-migration-recovery.test.js
```

## Verification

Branch Verification #1239 / run `30555829788` passed:

```text
Syntax / Architecture / Repository hygiene   PASS
Focused staged TikTok regression             PASS
Unit and Workers runtime tests               PASS
Report reliability regression                PASS
Dependency audit                             PASS
Wrangler dry-run                             PASS
```

Focused recovery regressions prove:

- canonical-only display rows are accepted;
- legacy-only display values are copied losslessly;
- dual Select `window_days` values are merged safely;
- both legacy fields survive with exact values;
- conflicting source values block before mutation;
- sanitized evidence excludes physical IDs and Business values.

## Post-merge Live recovery

Use a new evidence root. Preserve the failed v1 evidence directory unchanged.

The existing Organic Dashboard readiness one-command operator remains the only authorized Live path.
It will run Report Finalizer first, then exact 1D/3D/7D/30D stabilized refresh, same-job replay,
D1/Lark parity and all-false Worker restore.

Do not rerun a partially mutated recovery automatically. Any interruption after a recorded field mutation
requires evidence inspection before resume, even though the implementation is phase-resumable.

## Safety

```text
Business-fact deletion      forbidden
Legacy field deletion       forbidden
Legacy value overwrite      forbidden
Manual Lark editing         forbidden
Remote D1 mutation          none in implementation
Worker deployment           none in implementation
Queue/DLQ action            none in implementation
Schedule / AI               disabled
Production                  blocked
```
