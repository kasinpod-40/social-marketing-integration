# Lark Dashboard Backfill Table Discovery Hotfix v1

## Status

```text
TASK_STATUS       = IMPLEMENTED_FOR_CI
BASE_MAIN         = 90a5d27f4c5964a13bae0a668379d7e7dfffc9c8
BRANCH            = hotfix/lark-dashboard-backfill-table-discovery-v1
REMOTE_ACTIONS    = 0
LARK_WRITE        = 0
REMOTE_D1_WRITE   = 0
```

## Incident

Read-only Preview ของ `lark-dashboard-shared-dimensions-backfill-v1` หยุดก่อน Remote D1 query ด้วย:

```text
LARK_TABLE_CONFIG_INVALID
Missing required env LARK_TABLE_MKT_REPORT_METRIC_VALUES
```

Lark Base มี Report tables อยู่แล้ว แต่ `.dev.vars` ไม่ได้เก็บ Table ID ใหม่ครบทุกตัว การบังคับให้ผู้ใช้ค้นหาและกรอก ID เองเพิ่มความเสี่ยงต่อการ map ตารางผิด.

## Correction

Operator v1.1:

1. อ่าน Table ID ที่มีอยู่ใน Environment ก่อน.
2. ถ้าขาดแม้แต่หนึ่งค่า ให้ใช้ `LarkBitableClient.listTables()` แบบ read-only หนึ่ง inventory pass.
3. Match เฉพาะชื่อ exact จาก Shared `LARK_REPORT_SCHEMA_V2` (`createName`, aliases และ logicalName).
4. Inject Table ID เฉพาะ process รอบนั้น; ไม่แก้ `.dev.vars` และไม่ Commit ID.
5. ถ้าหาไม่พบ, พบ alias มากกว่าหนึ่งตาราง หรือหนึ่ง physical ID ถูกใช้กับหลาย logical keys ให้ fail closed ก่อน D1 query.
6. Output แสดงเฉพาะ source/count/matched table name; ไม่แสดง Table ID.

## Required tables

```text
MKT_Report_Snapshots
MKT_Report_Metric_Values
MKT_Report_Top_Content
MKT_Report_Top_Ads
```

## Safety

```text
Preview Lark reads       list tables + metadata/record planning
Preview Lark writes      0
Remote D1 reads          unchanged / bounded SELECT after table resolution
Remote D1 writes         0
Worker deployment        0
Queue/DLQ                0
Provider call            0
Schedule/Secret          0
Production               blocked
```

## Verification

Focused tests cover:

- configured-ID preservation;
- exact alias discovery;
- no substring match;
- missing-table rejection;
- ambiguous alias rejection;
- physical-ID conflict rejection.

No Remote action is authorized by this hotfix implementation or CI.
