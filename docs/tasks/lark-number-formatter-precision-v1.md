# Lark Number Formatter Precision Canonicalization Hotfix

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
  - `0.0000`
  - grouping เช่น `#,##0.00`
- ใช้กฎเดียวกันทั้ง incoming serialization และ existing-record normalization.
- Formatter ที่ไม่รองรับ เช่น percent/currency/custom format คง exact behavior เดิมและห้ามเดา precision.
- `null`/missing ยังคงต่างจาก observed `0`.
- NaN/Infinity ยัง fail closed.
- Normalize `-0` เป็น `0` เพื่อไม่ให้ `Object.is` สร้าง false update.
- ห้ามเปลี่ยน D1 payload, checksum, stable keys, write allowlist หรือ Apply confirmation.
- ห้ามเพิ่ม global tolerance ใน `TableSyncEngine`.

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
createRows       0
updateRows       0
recoveryDecision previous_apply_converged_no_apply_needed
```

เมื่อ `updateRows=0` ห้ามรัน Apply ซ้ำ.
