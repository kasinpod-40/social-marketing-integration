# Time-series Retention and Lark Notification Direction

## Status

```text
DECISION_STATUS = APPROVED_DIRECTION
IMPLEMENTATION_STATUS = NOT_STARTED
REPOSITORY_AUDIT = REQUIRED_BEFORE_IMPLEMENTATION
LARK_BASE_AUDIT = REQUIRED_BEFORE_IMPLEMENTATION
CODE_MUTATION = NONE
LARK_SCHEMA_MUTATION = NONE
D1_MIGRATION = NONE
SCHEDULE_CHANGE = NONE
PRODUCTION_CHANGE = NONE
```

เอกสารนี้บันทึกทิศทางที่ผู้ใช้อนุมัติสำหรับการรองรับข้อมูลจำนวนมากและการส่ง AI Summary/Recommendation เข้า Lark Group เท่านั้น ยังไม่ใช่ใบอนุญาตให้แก้ Code, Lark Base, D1, Schedule หรือ Production

ลำดับงานปัจจุบันใน `docs/current-task.md` ยังคงมีอำนาจสูงกว่า เอกสารนี้ต้องถูกนำไปตรวจเทียบกับ Repository `main` และ Base ล่าสุดทั้งหมดก่อนสร้าง Implementation task ใหม่

## Integration Workspace boundary

ทิศทางนี้ใช้ภายใต้ Integration Workspace เดียวตาม `docs/project-brain/integration-workspace.md`

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

ห้ามนำรูปแบบ DEV/UAT แยกชุดกลับมาใช้กับงานนี้ Production ยังคงแยกต่างหากและต้องใช้ทรัพยากรที่ลูกค้าเป็นเจ้าของ

## Problem statement

`MKT_Content_Daily` และ `MKT_Ads_Daily` ไม่ควรถูกใช้เป็นคลังประวัติละเอียดแบบเพิ่มหนึ่ง Record ต่อทุก Entity ต่อทุกวันตลอดอายุระบบ เพราะจำนวน Records จะโตตามจำนวน Content, Campaign, Ad group, Ad, Asset, Segment และจำนวนวันที่เก็บ

แนวทางที่ห้ามใช้เป็น Source of truth ระยะยาว:

- เก็บ Full history ทั้งหมดใน Lark;
- เก็บ History เป็น JSON ที่ต่อท้ายไม่จำกัดในหนึ่ง Cell;
- ลบข้อมูลเก่าก่อนมี Historical source of truth, reconciliation และ rollback;
- แตกตารางตามเดือนหรือ Platform โดยไม่มี Retention/Query contract กลาง;
- เปลี่ยนความหมายของ Daily tables โดยไม่ตรวจ Writer, Reader, Report และ Dashboard dependency ทั้งหมดก่อน

## Target storage roles

```text
Platform Sources
      ↓
Cloudflare Worker / Queue
      ↓
D1 current state + historical facts + coverage
      ↓
Calculation / Report / AI layer
      ↓
Lark current tables + bounded caches + aggregates + report results
      ↓
Lark Dashboard / Lark Group Notification

R2 = optional cold archive after a separately approved capacity threshold
```

### Lark

Lark เป็น Customer-facing presentation/configuration layer:

- current state;
- bounded recent detail;
- account-level daily aggregates;
- materialized report results;
- customer-editable report/notification settings;
- latest delivery status.

### D1

D1 เป็น Operational and historical source of truth:

- exact/sparse Content metric observations;
- Ads daily facts and attribution revisions;
- account-level daily facts;
- source coverage/completeness;
- report query cache;
- schedule state, locks, retry, idempotency and delivery history.

### R2

R2 เป็น optional cold archive สำหรับประวัติเก่ามากเมื่อ D1 ถึง Threshold ที่ผ่าน Capacity audit แล้ว ห้ามกำหนด Threshold หรือเปิด Archive job จากเอกสารนี้เพียงอย่างเดียว

## Lark table responsibilities

### `MKT_Content`

ใช้หนึ่ง Record ต่อหนึ่ง Content เป็น Current state และ Customer-facing metrics เช่น:

- stable content identity and metadata;
- `first_seen_at`, `last_observed_at`, `last_changed_at`;
- initial observed metrics;
- current metrics;
- precomputed display fields เช่น 1D, 7D, 30D, 365D, MTD และ YTD ตาม Contract ที่ตรวจแล้ว.

ค่า Initial และ Current เพียงสองจุดไม่เพียงพอสำหรับ arbitrary date range, weekly, monthly และ yearly comparison จึงห้ามใช้หนึ่งแถวนี้เป็น Historical source of truth ทั้งระบบ

### `MKT_Content_Daily`

ทิศทางปลายทางคือ bounded recent/diagnostic cache ไม่ใช่ Full history ตลอดชีวิต

Candidate uses หลัง Audit:

- recent changed Content;
- new Content;
- Top/Trend/Anomaly Content;
- bounded report window;
- reconciliation and diagnostic rows.

ยังห้ามหยุดเขียน ลบ หรือเปลี่ยน Grain ของตารางนี้ เพราะต้องตรวจ Report Engine และทุก Reader/Writer ก่อน

### `MKT_Ads_Daily`

ทิศทางปลายทางคือ bounded recent Ads detail cache ไม่ใช่ Full Ads history ตลอดชีวิต

Ads metrics เช่น Spend, Impression, Click, Conversion และ Conversion value เป็น Daily facts และอาจถูกแก้ย้อนหลังจาก Attribution จึงต้องมี D1 fact table ที่รองรับ lookback และ UPSERT วันเดิม

Retention ใน Lark ต้องกำหนดตาม Grain หลัง Audit เช่น Account, Campaign, Ad group, Ad, Asset และ Segment โดยยังไม่ล็อกจำนวนวันหรือ Hard cap ในเอกสารนี้

### `MKT_Account_Daily`

เป็น Candidate หลักสำหรับ Lark Dashboard ระยะยาว เพราะ Grain เล็กกว่า:

```text
customer + platform + account + metric_date
```

ใช้เก็บ aggregate ที่ Dashboard ต้องใช้ เช่น Views, Reach, Engagement, Followers, Spend, Impressions, Clicks, Conversions, Conversion value และ ROAS ตาม Metric semantics ของแต่ละ Source

### `MKT_Report_*`

เก็บ materialized report results และ Top rows ที่คำนวณจาก D1 แล้ว ไม่โหลด Detailed history ทั้งหมดกลับเข้า Lark

### JSON field policy

อนุญาตเฉพาะ bounded cache หรือ compact diagnostic payload ที่มี Version และ Size/point limit ชัดเจน

```text
BOUNDED_JSON_CACHE = ALLOWED_AFTER_CONTRACT
UNBOUNDED_HISTORY_JSON = FORBIDDEN
JSON_AS_HISTORICAL_SOURCE_OF_TRUTH = FORBIDDEN
```

## Candidate D1 data contracts

ชื่อจริง, Fields, Index และ Retention ต้องตรวจจาก Code/Base ก่อน แต่ Candidate responsibilities คือ:

```text
content_metric_observations
ads_daily_facts
account_daily_facts
sync_coverage_states
report_query_cache
notification_schedule_states
notification_deliveries
```

### Organic Content semantics

Content metrics ที่เป็น cumulative counters อาจใช้ Sparse observation ได้เมื่อ:

- เก็บครั้งแรก;
- ค่าเปลี่ยน;
- Source correction;
- required checkpoint;
- มี coverage evidence ว่า Entity ถูกตรวจจริง.

ถ้าไม่มี Coverage evidence ห้ามสรุปว่าค่าไม่เปลี่ยน เพราะอาจเป็น Source unavailable, recent-only query หรือ partial result

Initial observation เป็น Lifetime cumulative value ณ วันที่ระบบพบครั้งแรก ไม่ใช่ประวัติย้อนหลังที่เกิดก่อนติดตั้ง เว้นแต่ Source มี Historical period API ที่ยืนยันได้

### Ads semantics

Ads ต้องเก็บ Daily facts และรองรับ:

- exact metric date;
- report level and entity identity;
- optional segment identity;
- same-day/old-day UPSERT;
- attribution lookback;
- valid zero versus missing/partial/source unavailable;
- reconciliation by period and entity scope.

ห้ามใช้กฎ `metric ไม่เปลี่ยนจึงไม่เก็บ` กับ Ads daily facts

### Coverage states

ต้องแยกอย่างน้อย:

```text
complete
partial
no_data_confirmed
source_unavailable
not_observed
revisable
```

ชื่อจริงและ State machine ต้องตรวจร่วมกับ Runtime reliability contract เดิมก่อน

## Lark Dashboard query model

Lark Dashboard ไม่ Query D1 โดยตรง

Default Dashboard flow:

```text
D1 facts
→ Worker aggregation
→ MKT_Account_Daily / MKT_Report_*
→ Lark Dashboard
```

Custom historical detail flow:

```text
Customer report request
→ Worker queries D1
→ deterministic calculation
→ materialize only KPI/Top rows into MKT_Report_*
→ Dashboard/View displays result
```

ห้ามนำ Detailed history หลายแสนหรือหลายล้าน Records กลับเข้า Lark เพียงเพื่อให้ Dashboard Filter

Web Dashboard เป็น optional future product direction สำหรับ instant multi-level drill-down แต่ไม่ใช่ Scope ปัจจุบัน

## Customer-configurable Lark Group Notification

ต้องแยก Report generation ออกจาก Notification delivery

### Existing/target role of `MKT_Report_Settings`

ใช้กำหนดว่าจะสร้าง Report อะไร ช่วงเวลาใด และ Data scope ใด ไม่ใช้เป็นที่เก็บ Destination/Delivery runtime ทั้งหมด

### Proposed `MKT_Notification_Settings`

หนึ่ง Record เท่ากับหนึ่ง Customer-owned delivery rule เช่น:

- enabled;
- setting name;
- destination relation;
- report type;
- Organic / Ads / All scope;
- Platform/account scope;
- cadence: daily, interval days, weekly, monthly;
- send time and timezone;
- weekday/month day/anchor date ตาม cadence;
- rolling or calendar period;
- include AI summary;
- include AI recommendations;
- include Top Content/Top Campaign/Data quality;
- send when no material change;
- language;
- customer-visible `next_run_at`, `last_sent_at`, `last_status` และ redacted error summary.

ชื่อ Field และ Type จริงต้องผ่าน Full Base audit ก่อน ห้ามสร้าง Table/Field จากรายการ Candidate นี้โดยตรง

### Proposed `MKT_Notification_Destinations`

เก็บ allowlisted Lark destinations ที่ลูกค้าเลือกได้ เช่น:

- destination key and display name;
- destination type;
- non-secret destination identifier;
- enabled/verified status;
- latest delivery status.

Bot token, App secret, signing secret, webhook secret และ credential ห้ามเก็บใน Lark ต้องอยู่ใน Cloudflare Secret store

### Cadence semantics

- Daily: สรุปวันปฏิทินก่อนหน้าที่จบแล้ว;
- Every 3 days: ใช้ Calendar window หรือ explicit anchor ไม่เลื่อนตามเวลาที่ Retry สำเร็จ;
- Weekly/Every 7 days: เลือกวันส่งและสรุป completed calendar week หรือ Contract ที่ระบุชัด;
- Monthly: ส่งหลังเดือนปฏิทินจบ โดยเลือก delay ที่เหมาะกับ Attribution/data freshness หลัง Audit.

### Notification runtime

ใช้ Cron กลางหรือ Scheduler กลางตรวจรายการที่ถึงเวลา ห้ามสร้าง Cloudflare Cron แยกต่อ Setting

D1/Queue ดูแล:

- durable `next_run_at`;
- distributed lock;
- idempotency;
- retry and DLQ;
- delivery attempt history;
- payload/report checksum;
- AI generation state;
- redacted failure diagnostics.

Candidate idempotency input:

```text
notification_setting_key
+ period_start
+ period_end
+ report_version
+ destination_key
```

Exact key contract ต้องตรวจว่าระบบต้องส่ง Report เดียวกันหลาย Destination อย่างไร และต้องไม่ทำให้ Queue retry ส่งข้อความซ้ำ

### AI generation rule

Report metrics ต้องถูกคำนวณแบบ deterministic ก่อน แล้ว AI จึงอธิบายและให้คำแนะนำจาก Report snapshot

AI Summary ของ Report period/version เดียวกันควรถูก reuse ระหว่างหลาย Destination เมื่อ Content scope/language/template ตรงกัน ไม่เรียก AI ใหม่โดยไม่จำเป็น

เมื่อ Coverage/Data quality ต่ำกว่าระดับที่กำหนด ต้องลดระดับความมั่นใจ งดคำแนะนำเชิงตัดสินใจ หรือ Skip ตาม Customer setting

## Required audit before implementation

ต้องตรวจใหม่จาก `main` และ Base ล่าสุดอย่างน้อย:

1. `AGENTS.md`, `docs/current-task.md`, `PROJECT_BRAIN.md` และ Modular Project Brain;
2. Table/Field/View/Formula/Relation/Record-grain ของ Base ล่าสุดทั้งหมด;
3. ทุก Writer/Reader ของ `MKT_Content`, `MKT_Content_Daily`, `MKT_Ads_Daily`, `MKT_Account_Daily` และ `MKT_Report_*`;
4. TikTok, YouTube, Meta และ Google Ads normalization/write plans;
5. Report Engine, Dashboard contract, AI and planned Notification job;
6. D1 migrations, current tables, indexes, retention and capacity;
7. stable keys, idempotency, reconciliation, lookback, retry, lock, DLQ and redrive;
8. cumulative metrics versus period metrics and null/zero semantics;
9. customer-visible configuration, permissions and secret boundaries;
10. impact on Draft PR `#17` without treating that branch as `main`.

## Safe implementation sequence after a separate approval

1. Full repository and Base dependency audit;
2. approve exact Time-series/Notification data contracts;
3. add D1 migrations and feature-flagged dual-write with schedules disabled;
4. prove parity against existing Lark Daily/report behavior;
5. migrate Report Engine reads to the approved D1/aggregate path;
6. introduce bounded Lark retention only after backup/reconciliation/rollback evidence;
7. implement customer Notification settings and destinations;
8. run manual Preview/negative/idempotency/retry validation;
9. enable schedules only through a separate acceptance gate;
10. plan customer-owned Production cutover separately.

## Current sequencing rule

The authoritative current task remains the bounded TikTok Chemistry K RAW → Canonical sync in `docs/current-task.md`

That task must:

- use the existing Canonical schema and stable-key contract;
- remain manual and bounded;
- keep schedules disabled;
- prove reconciliation and idempotent rerun;
- avoid deleting old rows or introducing Retention/migration behavior.

The Time-series/Notification architecture becomes a separate approved Implementation task only after its required audit and explicit user approval
