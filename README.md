# Social Marketing Data Integration

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base สำหรับ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ JavaScript ES Modules, Cloudflare Workers, D1, Queues และ Lark Open API

## Read first

```text
AGENTS.md
→ docs/current-task.md
→ PROJECT_BRAIN.md
→ docs/project-brain/storage-architecture-and-migration-contract-v1.md
→ docs/project-brain/* relevant files
→ README.md / CHANGELOG.md
→ Source and Tests
```

- `docs/current-task.md` เป็น Current authority สำหรับ Scope และ Acceptance criteria
- ห้ามเริ่ม Connector/Storage implementation จากแชทเพียงอย่างเดียวเมื่อ Repository ใหม่กว่า
- Credential, Live write, Migration, Schedule, Retention และ Production ต้องผ่าน Gate แยก

## Current baseline

- Main baseline reviewed for Storage audit: `430b503cf074443776ac7fc5a011d2843192ec9c`
- Application package line: `0.11.0`
- Exact Storage contract: `docs/project-brain/storage-architecture-and-migration-contract-v1.md`
- Current task: documentation-only Storage Architecture closeout
- Lark Formula/View/Filter closeout: complete; do not rerun
- Google Ads signed delivery: Draft PR `#17`, HOLD / do not merge yet

## Integration Workspace

ก่อน Production ใช้ **Integration Workspace เพียงชุดเดียว** ไม่แยก DEV/UAT ในการปฏิบัติงาน

```env
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

`MKT_ENV=development` เป็น Technical runtime label เท่านั้น

ทรัพยากรปัจจุบันเป็นของผู้พัฒนา:

- Lark Base
- Cloudflare Worker
- D1
- Queue/DLQ
- Secret store

Source ownership ติดตามราย Connector และอาจเป็นข้อมูลผู้พัฒนาหรือลูกค้าปะปนกันชั่วคราว

Production ใช้:

```env
MKT_ENV=production
MKT_CUSTOMER_PROFILE=chemistry_k
```

และต้องใช้ Lark, Cloudflare, D1, Queue, credentials และ Platform assets ที่ลูกค้าเป็นเจ้าของ

## Current Lark state

```text
Physical tables             42
Fields                     737
Views                      133
Filtered Views              42
Sorted Views                 6
Views with hidden fields     7
Duplicate table names        0
Google Ads Formula fields    4/4 PASS
Google Ads managed filters  19/19 PASS
Shared-table filters        17/17 PASS
Report Views                 6/6 PASS
```

Relevant TikTok inventory:

```text
RAW_TikTok_Creator_Videos   2,021 records
MKT_Content                    22 records
MKT_Content_Daily             208 records
```

`RAW_TikTok_Creator_Videos` เป็น Protected Lark Native source ระบบอ่านได้แต่ห้ามแก้ Table/Field/Record

## Current blocking decision

ยังห้าม Sync Chemistry K TikTok RAW เข้า Canonical ตอนนี้

Repository/Base audit พบ:

- TikTok Report loader จำกัด Content `800` และ Daily snapshots `50,000`;
- `MKT_Content_Daily` ยังเป็น Report baseline source;
- `MKT_Content` ยังไม่มี Field ownership mask สำหรับข้อมูล Manual;
- Runtime ยังไม่ตรง `integration_workspace`/Chemistry K contract ทั้งหมด;
- D1 ยังไม่มี Marketing historical facts;
- RAW lineage และ D1 capacity ยังไม่ปิด Contract เชิงปฏิบัติการ.

```text
TIKTOK_CANONICAL_SYNC = BLOCKED
REPORT_READER_CUTOVER = BLOCKED
LARK_RETENTION = BLOCKED
SCHEDULE = DISABLED
PRODUCTION = BLOCKED
```

## Storage Architecture v1

```text
Platform/Lark Native Sources
→ validated ingestion
→ D1 current state + historical facts + coverage
→ deterministic calculation
→ Lark current state + bounded cache + aggregate + report result
→ Dashboard / AI / Notification
```

Exact D1 Tables:

```text
organic_content_state
organic_content_observations
organic_account_daily_facts
ads_entity_state
ads_daily_facts
ads_conversion_daily_facts
data_coverage_runs
data_coverage_entities
report_materializations
report_requests
```

ชื่อ Table, Grain, Keys, Fields, Indexes และ UPSERT rules อยู่ใน Storage contract

## Dashboard range contract

Customer Dashboard ต้องรองรับ:

```text
3D / 7D / 9D / 15D / 30D / 90D / CUSTOM_RANGE
```

- Preset เป็น Rolling completed days จบเมื่อวานตาม Reporting timezone
- `30D` คือหนึ่งเดือนย้อนหลังแบบ Rolling
- `90D` คือสามเดือนย้อนหลังแบบ Rolling
- Organic cumulative ใช้ End observation ลบ Baseline ก่อนช่วง
- Ads ใช้ SUM Daily facts และรองรับ Attribution revision
- Old Content ที่ไม่มี Baseline เป็น `partial`
- Missing metric เป็น `null`; observed zero เป็น `0`
- Dashboard ต้องแสดง Coverage/Data status

## Lark roles after cutover

| Table | Target role |
| --- | --- |
| `MKT_Content` | Current-state Content พร้อม Manual field protection |
| `MKT_Content_Daily` | Bounded recent/diagnostic cache หลัง D1 parity |
| `MKT_Account_Daily` | Account×Date Dashboard aggregate |
| `MKT_Ads_Daily` | Bounded recent Ads detail หลัง D1 parity |
| `MKT_Report_*` | Materialized KPI/comparison/Top results |
| Protected RAW | External source; no Worker mutation |

ยังไม่มีสิทธิ์ลบ Daily/RAW records จาก Contract นี้

## `MKT_Content` ownership

System-managed fields อัปเดตจาก Source ได้หลัง Validation

Manual-managed fields ต้อง preserve:

```text
course_name
course_level
course_type
content_theme
funnel_stage
cta_type
cta_destination
promotion_type
urgency_level
manual_tag_note
```

- เติมได้ตอน Create หรือ Existing blank
- `classification_source=manual` ต้อง preserve ชุด Classification
- `manual_tag_note` ห้ามทับหลัง Create
- Incoming `null` ห้ามล้าง Manual value

## Connector status

| Connector | Current state | Direction |
| --- | --- | --- |
| TikTok Organic | Chemistry K Native RAW populated | Storage foundation before Canonical write |
| YouTube Organic | Runtime foundation exists on developer source | Migrate cumulative/period facts into new Storage contract |
| Facebook Organic | Access/schema ready | Shared Meta connector after Storage foundation |
| Instagram Organic | Access/schema ready | Shared Meta connector after Storage foundation |
| Meta Ads | Access valid/no data | Ads facts/revision contract first |
| Google Ads | Read-only source passed; Draft PR #17 | Rebuild/rebase against Storage/RAW lineage |
| TikTok Ads | Access/design preflight | Controlled API/Worker connector later |
| WooCommerce | Planned | Connector pending |
| Chatwoot | Planned | Connector pending |

Planned connectors fail closed even if a Feature flag is accidentally enabled

## Google Ads status

Completed:

- Chemistry K account link/selectability
- Manager Script read-only Preview
- six bounded non-empty datasets
- errors/truncation `0/0`
- Lark schema/Relations/Views/Formulas
- direct API Basic Access application submitted `2026-07-21`, review pending

Draft PR `#17` is not `main`, not deployed and not external LIVE validated

It must not merge until:

- rebased to current `main`;
- RAW path is chosen explicitly;
- segment/conversion keys preserve Grain;
- D1 facts/coverage/revision contract is implemented;
- Full Gate and external validation pass.

Draft PR `#11` is obsolete/superseded and must not be merged

## Migration feature flags

All default `false`:

```env
MKT_TIME_SERIES_D1_WRITE_ENABLED=false
MKT_TIME_SERIES_D1_BACKFILL_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
MKT_LARK_DAILY_RETENTION_ENABLED=false
MKT_NOTIFICATION_RUNTIME_ENABLED=false
```

Reader cutover, Retention, Notification and Schedule are separate approvals

## Migration sequence

1. Documentation baseline
2. Runtime/profile and `MKT_Content` Field ownership alignment
3. Additive D1 schema/repositories with flags false
4. Manual dual-write with schedules disabled
5. Controlled bootstrap without fake history
6. D1 shadow Report read and range parity
7. Reader cutover with one-flag rollback
8. Lark retention after backup/reconciliation
9. Notification after deterministic Report parity
10. Customer-owned Production separately

## Next proposed Implementation task

```text
Storage Foundation Phase 1
= integration_workspace identity alignment
+ Chemistry K TikTok identity
+ MKT_Content Field ownership policy
+ additive D1 schema/repositories/tests
+ all new flags false
+ no Live business-data write
```

Implementation must be opened as a separate Current Task after this documentation baseline is merged

## Default verification gates

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Add focused migration, storage, report parity and rollback tests without reducing existing gates

## Safety

- No Secret in Source or logs
- No fake history
- No missing→zero conversion
- No Protected RAW mutation
- No Record deletion from old Profile labels
- No Lark Formula/View Apply rerun
- No D1 retention before Capacity evidence
- No Schedule before manual parity/idempotency
- No Production resources owned by the developer
