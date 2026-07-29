# Report Metric Value Field Migration v1

## Incident

Organic Dashboard one-command repair หยุดที่ `report-schema-conflict-recovery-preview`
หลัง read-only Report schema preview ยืนยัน populated type conflicts สองรายการใน
`MKT_Report_Metric_Values`:

```text
display_name  expected Text(1)   actual SingleSelect(3)  records 38 / populated 38
window_days   expected Number(2) actual SingleSelect(3)  records 38 / populated 20
```

Empty-field recovery ทำงานถูกต้องที่ Fail closed เพราะการเปลี่ยนชนิด Field ที่มีค่าด้วย
Field update โดยตรงอาจเปลี่ยนหรือทำลาย Historical values.

Attempt นี้หยุดก่อน Report schema Apply, Dashboard settings Apply, Worker deployment,
Queue/DLQ message, Remote D1 mutation และ Report window materialization.

## Root cause decision

Live metadata และ Record counts ยืนยันแล้วว่า Field ทั้งสองถูกสร้างเป็น SingleSelect ในอดีต
แต่ Repository contract ปัจจุบันกำหนด:

```text
display_name = Text
window_days  = Number / formatter 0
```

จึงไม่ใช่ Empty-field mismatch และห้ามใช้ in-place type conversion. แนวทางที่รักษา Business
facts ได้คือ Side-by-side migration: rename Field เดิมเป็น Legacy, สร้าง Canonical Field ใหม่
แล้วคัดลอกเฉพาะค่าที่แปลงแบบ lossless ได้.

## Migration contract

```text
Table                         MKT_Report_Metric_Values
Record bound                  <= 500
Legacy field deletion         0
Legacy value mutation         0
Canonical overwrite conflict  blocked
Field write retry             0
Record write attempts         1 per field
Verification                  fresh bounded metadata + Record reads
```

### display_name

```text
Legacy name   __mkt_legacy_display_name_single_select_v1
Source type   SingleSelect(3)
Target type   Text(1)
Conversion    exact selected text -> Text
```

### window_days

```text
Legacy name   __mkt_legacy_window_days_single_select_v1
Source type   SingleSelect(3)
Target type   Number(2), formatter 0
Conversion    unambiguous preset-day label -> Number
Allowed days  1, 3, 7, 9, 15, 30, 90
Read forms    3 | 3D | 3 days | rolling:3d
```

Read-form normalization เกิดเฉพาะใน in-memory migration model; Raw Legacy cell ไม่ถูกแก้.
รูปแบบที่มี semantic ไม่ชัด เช่น `03`, `3 weeks`, `custom`, `365D` ต้องคงค่าดิบไว้เพื่อให้
Migration Fail closed ก่อน write.

SingleSelect หลายค่า, Canonical value ที่ไม่ตรง Legacy, Canonical value ที่มีอยู่โดยไม่มี Legacy
source, Field identity ambiguity, Primary Field หรือ Record count เกิน bound ต้อง Fail closed.

## Controlled sequence

```text
read schema + all bounded records
-> validate every conversion and build semantic fingerprints
-> rename original Field once, preserving field_id/property/options
-> bounded fresh metadata verification; no write retry
-> bounded fresh Record-name/value parity verification
-> create canonical Field once
-> bounded fresh metadata verification; no create retry
-> batch-update only missing canonical values once
-> bounded fresh Record verification
-> require both migrations converged
-> run normal Report schema preview/apply
```

Migration รองรับ deterministic resume หลัง interruption ที่เกิดหลัง Rename, Create หรือ partial
record write โดยอ่าน Live state ใหม่และเขียนเฉพาะขั้น/Record ที่ยังขาด. ห้ามสร้าง Legacy หรือ
Canonical Field ซ้ำ.

## Finalizer integration

`report-runtime-finalize-operator.mjs` ต้องรัน migration preview/apply ก่อน Report schema preview.
Tenant ที่มี Canonical Text/Number fields ถูกต้องและไม่มี Legacy fields ต้องได้สถานะ
`not_required`. Tenant ที่ยังไม่มี Report table อยู่ใน Bootstrap scope ของ Schema installer และ
ต้องถูกจัดการแยกจาก Historical populated-field migration contract นี้.

หลัง migration สำเร็จ Schema preview ต้องเหลือ type conflict เป็นศูนย์ก่อน Schema/Settings Apply.

## Evidence boundary

Terminal/evidence แสดงได้เฉพาะ:

- logical table/field names;
- state/next step;
- record/populated/pending counts;
- semantic SHA-256 fingerprints;
- field/batch mutation counts;
- zero legacy mutation and zero delete.

ห้ามแสดง physical Table/Field/Record IDs, Select values, captions, metrics, token หรือ Secret.

## Safety

Repository implementation และ CI:

- ไม่มี Live Lark mutation;
- ไม่มี Worker deployment;
- ไม่มี Queue/DLQ message;
- ไม่มี Remote D1 action;
- ไม่มี Provider request;
- ไม่มี Schedule/AI activation;
- Production blocked.

Live migration เกิดได้เฉพาะภายใน confirmed one-command operator หลัง Squash Merge และ exact-main
repository gates ผ่านแล้ว.
