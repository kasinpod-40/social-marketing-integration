# Report Metric `display_name` Select Recovery v3

## Incident

Organic Dashboard readiness operator หยุดอย่างปลอดภัยระหว่าง Report Finalizer preview บน
`main@a1b04a02627db22a47ba1e83e9e445a6a2043258`.

```text
Stage                  report-metric-value-field-migration-preview
Blocker                REPORT_METRIC_FIELD_MIGRATION_RECOVERY_DISPLAY_STATE_UNSUPPORTED
Table                  MKT_Report_Metric_Values
Field                  display_name
Observed canonical     SingleSelect / type 3 / exactly one Field
Apply                  not started
Worker deploy          0
Queue send             0
Production             blocked
```

Evidence root จาก attempt นี้ต้องเก็บไว้และห้ามใช้ซ้ำ:

```text
outputs/organic-dashboard-readiness-refresh-v4-worktree-a1b04a02
```

## Root cause

Recovery v2 รองรับ `display_name` เมื่อ Canonical Text มีอยู่แล้วและอาจมี retained legacy
SingleSelect แต่ยังไม่รองรับ Live state ที่ Field เดิมยังใช้ชื่อ `display_name` และยังเป็น SingleSelect.

Finalizer จึง fail closed ก่อน Schema Apply ซึ่งเป็นพฤติกรรมที่ถูกต้อง แต่ Organic Dashboard refresh ยังไปต่อไม่ได้.

## Recovery contract

Recovery v3 เป็น Adapter หน้า Recovery v2 และทำงานเฉพาะ transitional `display_name` states.
หลัง Display converged แล้ว งาน `window_days` และ Normal states ทั้งหมดยังคงส่งต่อให้ Recovery v2 เดิม.

### Single Select canonical state

```text
rename display_name Select
  -> __mkt_legacy_display_name_single_select_v1
create display_name Text
backfill only missing Text values
fresh verification
continue through Recovery v2
```

### Dual Select state

เมื่อมีทั้ง Select ที่ใช้ชื่อ Canonical และ retained legacy v1:

```text
archive retained legacy v1
  -> __mkt_legacy_display_name_single_select_v2
rename canonical-name Select
  -> __mkt_legacy_display_name_single_select_v1
create display_name Text
backfill from lossless union of v1 + v2
fresh verification
continue through Recovery v2
```

## Value-preserving rules

- ทุก Source Field เก็บ Field ID เดิม.
- Legacy values ต้องมี fingerprint เท่าเดิมก่อนและหลัง.
- ไม่มี Field delete.
- ไม่มี Legacy value overwrite.
- Canonical Text เขียนเฉพาะ Record ที่ยังว่าง.
- Canonical-only Text values ที่มีอยู่แล้วถือเป็น authority ได้.
- Source หลาย Field ที่ให้ค่าเดียวกัน merge ได้.
- Source หลาย Field ที่ให้ค่าขัดกัน fail closed ก่อน mutation.
- Canonical Text กับ Source ที่ไม่ตรงกัน fail closed.
- Record count ต้องไม่เปลี่ยนตลอด operation.

## Resume states

Recovery v3 ตรวจและ resume ได้จากทุก Phase:

```text
canonical Select only
legacy v1 only after rename
canonical Text + legacy v1 before/after backfill
canonical Select + legacy v2 after archive
canonical Text + legacy v1 + legacy v2
```

State ที่มี Canonical Select พร้อม legacy v1 และ legacy v2 ครบทั้งสองชื่อถูกบล็อก เพราะไม่มี deterministic archive identity ว่างสำหรับ rename เพิ่ม.

## Repository scope

```text
Branch      hotfix/report-display-select-migration-recovery-v3
Base        a1b04a02627db22a47ba1e83e9e445a6a2043258
Remote      none during implementation
Production  blocked
```

Files:

```text
scripts/lib/report-metric-value-field-migration-recovery-v3.js
scripts/migrate-report-metric-value-field-types.mjs
tests/scripts/report-metric-value-field-migration-recovery-v3.test.js
```

`docs/current-task.md` ไม่ถูกเขียนทับ เพราะยังเป็น Authority ของ WooCommerce closeout / Meta handoff.
งานนี้ใช้ Scoped task document เพื่อไม่ชน Parallel workstream.

## Acceptance

```text
Preview migration count                2
Preview blocker count                  0
Display SingleSelect retained          true
Canonical display Text created         true
Canonical backfill                     lossless
Legacy value mutation count            0
Delete count                           0
Window migration                       delegated to v2
Interrupted phase resume               pass
Source conflict                        fail before mutation
Safe evidence                          no IDs / Business values
Repository gates                       all pass
Live execution                         separate after merge
```

## Safety boundary

Repository Implementation และ CI ห้ามทำ Lark mutation, D1 mutation, Worker deploy, Queue/DLQ send,
Provider call, Schedule/AI enable, Secret change หรือ Production action.

หลัง Merge ต้องใช้ Organic Dashboard readiness launcher เดิมจาก current exact `main` พร้อม Evidence root ใหม่.
หาก Live execution หยุดหลัง Field mutation ต้องเก็บ Output/Evidence และวิเคราะห์ Phase ก่อน Resume; ห้าม blind rerun.
