# Time-series Retention and Lark Notification Direction

## Status

```text
DECISION_STATUS = SUPERSEDED_BY_EXACT_STORAGE_CONTRACT_V1
REPOSITORY_AUDIT = COMPLETE_WITH_BLOCKERS
LARK_BASE_AUDIT = COMPLETE_FOR_CONFIGURATION_BASELINE
EXACT_STORAGE_CONTRACT = docs/project-brain/storage-architecture-and-migration-contract-v1.md
IMPLEMENTATION_STATUS = NOT_STARTED
CODE_MUTATION = NONE
LARK_MUTATION = NONE
D1_MIGRATION = NONE
SCHEDULE_CHANGE = NONE
PRODUCTION_CHANGE = NONE
```

เอกสารนี้เก็บทิศทางระดับ Architecture และ Notification ส่วนชื่อ Table, Grain, Stable key, Fields, Indexes, Migration phases, Dashboard presets, parity และ rollback ให้ยึด Contract ที่มีอำนาจสูงกว่า:

`docs/project-brain/storage-architecture-and-migration-contract-v1.md`

## Integration Workspace boundary

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

ก่อน Production ใช้ Integration Workspace เดียว Production แยกและต้องใช้ทรัพยากรลูกค้า

## Confirmed problem

ห้ามใช้ `MKT_Content_Daily` และ `MKT_Ads_Daily` เป็นคลัง Detailed history แบบเพิ่มทุก Entity ทุกวันตลอดอายุระบบ เพราะจำนวน Records โตตาม Entity, Date, Breakdown, Segment และ Conversion action

แนวทางที่ห้ามใช้:

- Full history ทั้งหมดใน Lark;
- History JSON ต่อท้ายไม่จำกัดใน Cell;
- ลบข้อมูลเก่าก่อนมี D1 historical truth, parity, backup และ rollback;
- แตก Table รายเดือน/Platform โดยไม่มี Architecture กลาง;
- เปลี่ยน Daily Grain หรือ Reader โดยไม่ตรวจทุก dependency;
- สร้างข้อมูลย้อนหลังปลอมจาก Current cumulative value.

## Target flow

```text
Platform/Lark Native Sources
      ↓
Worker / Queue
      ↓
D1 current state + historical facts + coverage
      ↓
Deterministic calculation / Report materialization
      ↓
Lark current state + bounded cache + aggregate + report result
      ↓
Dashboard / AI / Lark Group Notification
```

R2 เป็น optional cold archive หลัง Capacity threshold ผ่าน Audit แยกเท่านั้น

## Storage roles

### D1

D1 เป็น Operational and historical source of truth สำหรับ:

- Organic Content current state and observations;
- Organic Account daily facts;
- Ads entity current state;
- Ads and Conversion daily facts with revisions;
- Coverage/completeness;
- Report materializations and custom requests;
- Notification runtime state and delivery history;
- Existing locks, retry, checkpoint, Queue/DLQ and resumable work.

### Lark

Lark เป็น Customer-facing presentation/configuration layer:

- `MKT_Content` current state;
- bounded recent detail after cutover;
- `MKT_Account_Daily` aggregates;
- `MKT_Report_*` deterministic outputs;
- customer-editable settings;
- latest delivery status.

## Dashboard requirement

ต้องรองรับ:

```text
3D / 7D / 9D / 15D / 30D / 90D / CUSTOM_RANGE
```

- Preset เป็น Rolling completed days;
- Default จบเมื่อวานตาม Reporting timezone;
- Organic cumulative = End observation − Pre-period baseline;
- Ads = SUM Daily facts;
- Missing baseline = partial;
- Missing metric = null;
- Ads revision/Attribution ต้อง UPSERT วันเดิม;
- Dashboard ต้องแสดง Coverage/Data status.

## Lark responsibilities

### `MKT_Content`

หนึ่ง Record ต่อ Content เป็น Current state ห้ามใช้เป็น Full historical source

Manual classification fields และ `manual_tag_note` ต้องมี Field-level ownership protection ก่อน Sync

### `MKT_Content_Daily`

ปัจจุบันยังเป็น cumulative snapshot source ที่ Report Engine อ่านโดยตรง จึงห้ามหยุดเขียน ลบ หรือเปลี่ยน Grain จนกว่า D1 Reader parity และ rollback ผ่าน

Target หลัง Cutover คือ bounded recent/diagnostic compatibility cache

### `MKT_Ads_Daily`

Target คือ bounded recent Ads detail ส่วน exact historical daily facts อยู่ D1 และรองรับ revision/lookback

### `MKT_Account_Daily`

เป็น Account×Date aggregate สำหรับ Dashboard ระยะยาว เป้าหมาย Retention ขั้นต้นอย่างน้อย 400 completed days หลัง Contract ถูก Implement

### `MKT_Report_*`

เก็บ Materialized KPI, comparison, Top Content และ Top Ads ไม่เก็บ Detailed history ทั้งหมด

## Metric semantics

ทุก Metric ต้องประกาศ:

```text
cumulative | period | snapshot
```

Coverage state อย่างน้อย:

```text
complete
partial
no_data_confirmed
source_unavailable
not_observed
revisable
```

Zero, null และ no-data ห้ามใช้แทนกัน

## RAW lineage

ห้ามตัดสินว่า Table ซ้ำจากชื่อ ต้องพิสูจน์ Writer/Reader และ Grain

Connector ต้องประกาศหนึ่งเส้นทาง:

```text
Provider-specific RAW → Shared RAW → Canonical
```

หรือ

```text
Provider-specific RAW → Canonical
Shared RAW not used by that Connector
```

Dual-write RAW สองชั้นต้องมี parity/reconciliation contract

`RAW_TikTok_Creator_Videos` เป็น Protected Lark Native source อ่านได้อย่างเดียว

`RAW_YouTube_Analytics_Daily` เป็น Period fact และห้ามเขียนทับ cumulative Content snapshot

## Customer-configurable Lark Group Notification

Report generation แยกจาก Notification delivery

### Proposed customer configuration

`MKT_Notification_Settings`:

- enabled;
- rule name;
- destination relation;
- report type;
- Organic/Ads/All scope;
- Platform/account scope;
- Daily/interval/weekly/monthly cadence;
- send time/timezone;
- rolling/calendar period;
- AI summary/recommendation;
- Top Content/Top Ads/Data quality;
- send when no material change;
- language;
- latest visible status.

`MKT_Notification_Destinations`:

- destination key/name/type;
- non-secret identifier;
- enabled/verified;
- latest delivery status.

Secret, Bot token, App secret และ signing credential อยู่ Cloudflare Secret store เท่านั้น

### Runtime

ใช้ Scheduler/Cron กลาง ไม่สร้าง Cron ต่อ Setting

D1/Queue ดูแล:

- `next_run_at`;
- distributed lock;
- idempotency;
- retry/DLQ;
- delivery attempts/history;
- report/payload checksum;
- AI generation state;
- redacted diagnostics.

Candidate idempotency input:

```text
notification_setting_key
+ period_start
+ period_end
+ report_version
+ destination_key
```

### AI rule

- Metrics คำนวณแบบ deterministic ก่อน;
- AI อธิบาย Report snapshot เท่านั้น;
- reuse AI result เมื่อ Scope/language/template/version ตรงกัน;
- Coverage ต่ำต้องลดความมั่นใจ, งด Recommendation หรือ Skip ตาม Setting;
- ห้ามให้ AI คำนวณตัวเลขเองจาก Raw payload.

## Safe migration order

1. Merge exact Storage documentation baseline;
2. Align `integration_workspace`, Chemistry K identity and `MKT_Content` Field ownership;
3. Add additive D1 schema/repositories with all flags false;
4. Manual dual-write with schedules disabled;
5. Controlled bootstrap without fake history;
6. Shadow Report reader and parity for 3D/7D/9D/15D/30D/90D/Custom;
7. Reader cutover with one-flag rollback;
8. Bounded Lark retention after backup/reconciliation approval;
9. Notification implementation after deterministic Report parity;
10. Production cutover separately.

## Current boundary

```text
TIKTOK_CANONICAL_WRITE = BLOCKED
D1_HISTORICAL_FACTS = NOT_IMPLEMENTED
REPORT_D1_READER = NOT_IMPLEMENTED
LARK_RETENTION = NOT_APPROVED
NOTIFICATION_RUNTIME = NOT_STARTED
GOOGLE_ADS_PR_17 = HOLD
SCHEDULE = DISABLED
PRODUCTION = BLOCKED
```

This document does not authorize Code, Lark, D1, Queue, Schedule or Production mutation
