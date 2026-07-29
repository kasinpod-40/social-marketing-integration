# Lark Number Formatter Precision Canonicalization Hotfix

## Status

```text
Incident main                       142d742fd27df9fdd1728a371836dd395dcc88ea
Merged source correction            PR #248 / 78aaf1416f5f7fc528c0c4bbfc2da409bb169a34
Follow-up base                      78aaf1416f5f7fc528c0c4bbfc2da409bb169a34
Follow-up branch                    hotfix/lark-number-formatter-precision-v1-followup
Backfill operator                   lark-dashboard-shared-dimensions-backfill-v1.3
Remote action count                 0
```

ชื่อ branch เดิมถูกใช้และ Merge แล้วใน PR `#248`. Follow-up เริ่มจาก Current Remote Main
เพื่อปิด official grouped-formatter, operator-version และ documentation requirements
โดยไม่แก้หรือ force-push branch ที่ Merge ไปแล้ว.

## Objective

หยุด false update ของ Lark Number fields เมื่อ Lark เก็บหรืออ่านค่ากลับตาม fixed precision ของ formatter เช่น `0.0000` แต่ Domain source ยังมี precision มากกว่า โดยไม่ใช้ global epsilon และไม่เปลี่ยน Business value ใน D1/materialization.

## Confirmed incident evidence

Read-only diagnostics บน Integration Workspace ยืนยัน:

```text
source materializations                 2
matching Lark records                  32
coverage_rate missing/invalid          0
exact_equal                            0
equal_after_formatter_precision       32
0-1 vs 0-100 unit mismatch             0
Remote mutations                       0
```

ทั้ง 32 แถวมีค่า `coverage_rate` อยู่จริงใน Lark และต่างจาก source เฉพาะ precision ตาม formatter `0.0000`.

## Root cause

`lark-field-serializer.js` เคย serialize และ normalize Number เป็น raw finite number ขณะที่ `TableSyncEngine` ใช้ exact comparison. เมื่อ source เป็นค่าความละเอียดสูงและ Lark อ่านกลับตาม fixed formatter precision จึงเกิด update plan ซ้ำตลอด แม้ค่าเชิงธุรกิจเดียวกัน.

## Correction contract

- Canonicalize เฉพาะ Lark Number formatter แบบ fixed decimal ที่ระบุชัดเจน:
  - `0`
  - `0.0`
  - `0.00`
  - `0.000`
  - `0.0000`
  - official grouping `1,000` และ `1,000.00`
- Spreadsheet aliases ใช้ Shared `normalizeLarkNumberFormatter()` ก่อนอ่าน precision.
- ใช้กฎเดียวกันทั้ง incoming serialization และ existing-record normalization.
- Formatter ที่ไม่รองรับ เช่น percent/currency/custom format คง exact behavior เดิมและห้ามเดา precision.
- `null`/missing ยังคงต่างจาก observed `0`.
- NaN/Infinity ยัง fail closed.
- Normalize `-0` เป็น `0` เพื่อไม่ให้ `Object.is` สร้าง false update.
- ห้ามเปลี่ยน D1 payload, checksum, stable keys, write allowlist หรือ Apply confirmation.
- ห้ามเพิ่ม global tolerance ใน `TableSyncEngine`.

Repository audit พบว่า Source fix ที่ Merge ใน PR `#248` recognize `#,##0.00` โดยตรง
แต่ Shared Field contract แปลงค่านี้เป็น official `1,000.00` ก่อนส่ง/อ่าน schema.
Follow-up จึงใช้ Shared normalizer เดิมและ allowlist เฉพาะ official fixed-precision enums;
`0.00000` และ `1,000.000` ยังคง unsupported/exact.

## Regression contract

- `0.833333333333` กับ formatter `0.0000` canonical เป็น `0.8333`.
- Existing `0.8333` เทียบ incoming full precision แล้ว `skipped=1`, `updateRows=0`.
- Exact value, negative decimal, integer formatter และ zero คง semantic.
- null/undefined/empty omit; null/missing ยังคงต่างจาก zero.
- unsupported formatter ไม่ถูกปัด; NaN/Infinity fail.
- official `1,000`/`1,000.00` และ spreadsheet aliases ใช้ precision เดียวกัน.
- persistent numeric difference หลัง canonicalization ยัง update.
- URL/Text/Select/Date, Stable key, D1/checksum, Allowed fields, no-create guard และ
  Apply confirmation ไม่เปลี่ยน.

Focused command:

```bash
node --test \
  tests/connectors/lark-number-formatter-precision.test.js \
  tests/connectors/lark-field-serializer.test.js \
  tests/connectors/lark-record-repository.test.js \
  tests/shared/lark-field-contract.test.js \
  tests/sync-engine/table-sync-engine.test.js \
  tests/scripts/lark-dashboard-shared-dimensions-backfill.test.js
```

Current result: `39/39 PASS`.

Full validation:

```text
npm ci                                              PASS (80 packages)
npm run check                                       PASS (399 files, 1027 deps, 0 cycles)
npm test                                            PASS (Unit 1444/1444, Workers 15/15)
npm run test:report-reliability                     PASS (100/100)
npm audit                                           PASS (0 vulnerabilities)
npm run deploy:dry-run                              PASS
npx wrangler deploy --dry-run
  --config wrangler.sync.jsonc --env development    PASS
```

Wrangler exact-config dry-run แสดง warning เดิมว่าไม่มี `[env.development]` section แต่
build สำเร็จและจบด้วย `--dry-run: exiting now`; ไม่มี Worker deployment หรือ Remote mutation.
Final-head Branch Verification CI ยัง pending จนกว่าจะ Push Draft PR.

## Safety boundary

Implementation/CI เท่านั้น:

```text
Lark write           0
Remote D1 write      0
Worker deployment    0
Queue/DLQ send       0
Provider call        0
Schedule mutation    0
Secret mutation      0
Production/UAT       0
```

## Recovery validation after merge

รัน read-only Preview:

```bash
node scripts/lark-dashboard-shared-dimensions-backfill.mjs
```

ผลที่ต้องการ:

```text
ok               true
mode             preview
operatorVersion  lark-dashboard-shared-dimensions-backfill-v1.3
createRows       0
updateRows       0
recoveryDecision previous_apply_converged_no_apply_needed
```

เมื่อ `updateRows=0` ห้ามรัน Apply ซ้ำ.
