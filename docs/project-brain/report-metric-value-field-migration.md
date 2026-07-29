# Report Metric Value Field Migration

## Current decision

`MKT_Report_Metric_Values.display_name` และ `window_days` ใน Integration Workspace มี
Historical records อยู่ใน SingleSelect fields แต่ Canonical Report contract ต้องเป็น Text และ
Number ตามลำดับ. ห้ามใช้ in-place type conversion และห้ามลบ Historical fields.

Canonical migration ใช้ side-by-side contract:

```text
display_name legacy  __mkt_legacy_display_name_single_select_v1
window_days legacy   __mkt_legacy_window_days_single_select_v1
```

Field เดิมต้องคง `field_id`, Select properties/options และ Record values. Field canonical ใหม่
รับเฉพาะ lossless values และ Finalizer เดินต่อได้เมื่อ fresh read ยืนยัน parity ครบทุก Record.

## Durable operator behavior

- Preview อ่าน metadata และ Records ไม่เกิน 500 rows; ไม่มี write.
- Apply ส่ง Rename/Create write ครั้งเดียวต่อขั้น แล้วรอ bounded fresh metadata read.
- ห้าม retry Create เมื่อ metadata ยัง stale เพื่อไม่สร้าง Field ซ้ำ.
- Batch update เขียนเฉพาะ Canonical values ที่ยังขาดครั้งเดียวต่อ Field.
- Rerun resume จาก Live state หลัง Rename/Create/partial record write ได้.
- Canonical conflict, conversion ambiguity, Primary Field, duplicate identity และ record bound
  mismatch ต้อง Fail closed.
- Evidence ใช้ counts/fingerprints เท่านั้น; ไม่แสดง IDs หรือ Business values.

## Integration order

```text
repository gates
-> Report Metric value-preserving migration
-> Report schema preview
-> empty-field conflict recovery (ถ้ายังมี conflict อื่น)
-> Report schema apply
-> Dashboard settings reconcile
-> Report window materialization
```

## Safety state

Implementation/CI ไม่มี Live Lark/D1/Queue/Worker/Provider/Schedule/Production action. Live write
อนุญาตเฉพาะ confirmed one-command operator หลัง exact-main CI และ merge.

Detailed contract:

```text
docs/tasks/report-metric-value-field-migration-v1.md
```
