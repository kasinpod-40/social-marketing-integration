# Storage Architecture and Migration Contract v1

## Status

```text
CONTRACT_VERSION = storage-architecture-v1
DECISION_STATUS = APPROVED_DESIGN
IMPLEMENTATION_STATUS = NOT_STARTED
REPOSITORY_AUDIT = COMPLETE_WITH_BLOCKERS
BASE_AUDIT = COMPLETE_FOR_CONFIGURATION_BASELINE
LIVE_ROW_LINEAGE = REQUIRED_BEFORE_WRITE
D1_CAPACITY_AUDIT = REQUIRED_BEFORE_RETENTION
CODE_MUTATION = NONE
LARK_MUTATION = NONE
D1_MIGRATION = NONE
SCHEDULE_CHANGE = NONE
PRODUCTION_CHANGE = NONE
```

เอกสารนี้เป็น Contract หลักสำหรับการจัดเก็บข้อมูลประวัติ, Dashboard ช่วงย้อนหลัง, Report, AI และ Notification ของระบบ MKT หลังตรวจ Repository `main`, Base ล่าสุด, Writer/Reader, Report Engine, D1 operational state และ Draft Google Ads PR แล้ว

เอกสารนี้อนุมัติ **Data model และลำดับ Migration** แต่ยังไม่อนุญาตให้เพิ่ม Migration, เปลี่ยน Runtime, Sync, Deploy, ลบ Records, เปลี่ยน Lark Schema หรือเปิด Schedule จนกว่าจะเปิด Current Task สำหรับ Implementation แยกต่างหาก

## 1. Business outcomes ที่ต้องรองรับ

Dashboard ลูกค้าต้องรองรับ Preset ต่อไปนี้เป็น Requirement บังคับ:

```text
3D
7D
9D
15D
30D
90D
CUSTOM_RANGE
```

ความหมายมาตรฐาน:

- `3D`, `7D`, `9D`, `15D`, `30D`, `90D` เป็น Rolling completed days;
- วันสิ้นสุด Default คือเมื่อวานตาม Reporting timezone;
- `30D` ใช้แทน “1 เดือนย้อนหลัง”;
- `90D` ใช้แทน “3 เดือนย้อนหลัง”;
- Calendar month, previous month, MTD, YTD และ Custom range เป็นคนละ Period contract;
- Comparison default ใช้ช่วงก่อนหน้าที่มีความยาวเท่ากัน;
- Dashboard ต้องแสดง `complete`, `partial`, `no_data_confirmed` หรือ `source_unavailable` อย่างชัดเจน;
- ห้ามแสดงข้อมูลก่อน Coverage start ว่าเป็นข้อมูลครบ;
- ช่วงเดิมต้องได้ผลเดิมเมื่อ Source ไม่มี Revision ใหม่;
- Ads อาจเปลี่ยนย้อนหลังจาก Attribution และต้องมี Source revision/watermark ประกอบผลลัพธ์.

## 2. Target architecture

```text
Platform API / Lark Native Sources
        ↓
Source-specific ingestion and validation
        ↓
D1 current state + historical facts + coverage
        ↓
Deterministic calculation and report materialization
        ↓
Lark current state + bounded cache + aggregate + report result
        ↓
Lark Dashboard / AI Summary / Notification

R2 = optional cold archive only after a separately approved capacity threshold
```

### Storage authority

| Layer | Authority |
| --- | --- |
| Platform/Lark Native | External source contract and provider evidence |
| D1 | Historical facts, current system state, coverage, report cache and runtime state |
| Lark `MKT_*` | Customer-facing current state, bounded detail, aggregates, configuration and materialized report results |
| R2 | Optional cold archive after capacity audit |

Lark ไม่เป็น Historical source of truth ระยะยาว และห้ามเก็บ Full history เป็น JSON ที่ต่อท้ายไม่จำกัดใน Cell

## 3. Metric semantics

ทุก Metric ต้องประกาศหนึ่งค่าใน:

```text
cumulative
period
snapshot
```

### Organic cumulative metrics

ตัวอย่าง Views, Likes, Comments และ Shares ของ Content:

```text
period value
= latest cumulative observation at period end
- latest cumulative observation before period start
```

กฎ:

- New Content ที่ Published ภายในช่วงและพบครั้งแรกในช่วงใช้ Baseline `0` ได้;
- Content เก่าที่ไม่มี Baseline ก่อนช่วงต้องเป็น `partial`;
- Missing metric เป็น `null` ไม่ใช่ `0`;
- Correction จาก Platform อาจทำให้ Delta ติดลบและต้องรักษาไว้;
- Sparse observation ใช้ได้เมื่อค่าเปลี่ยน, first observation, correction หรือ mandatory checkpoint;
- Sparse observation ต้องมี Coverage evidence ว่า Entity ถูกตรวจจริง.

### Organic period metrics

Metrics ที่ Source คืนเป็นรายวันหรือรายช่วงต้องเก็บตาม Source date/period โดยตรง ห้ามแปลงเป็น cumulative และห้ามเขียนทับ cumulative snapshot

### Ads daily facts

Spend, Impressions, Clicks, Conversions และ Conversion value เป็น Daily facts:

```text
period value = SUM(daily facts in selected range)
```

กฎ:

- รองรับ same-day และ old-day UPSERT;
- รองรับ Attribution lookback และ Conversion revision;
- Money ใช้ integer micros;
- Conversions อาจเป็นทศนิยมได้;
- Breakdown/segment/conversion action ที่ต่างกันห้าม Collapse ลง Stable key เดียว;
- Unsupported/missing metric เป็น `null`; observed zero เป็น `0`.

## 4. Exact D1 data contracts

ชื่อ Table ต่อไปนี้เป็นชื่อที่อนุมัติสำหรับ Implementation v1 การเปลี่ยนชื่อหรือ Grain ต้องแก้ Contract ก่อน

## 4.1 `organic_content_state`

หนึ่งแถวต่อหนึ่ง Canonical Content เป็น Current system state

### Grain

```text
customer_key + platform + account_key + external_content_id
```

### Primary key

```text
content_key = platform:account_key:external_content_id
```

### Fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `content_key` | TEXT PK | Yes | Canonical Stable key |
| `customer_profile` | TEXT | Yes | Runtime profile label |
| `customer_key` | TEXT | Yes | Customer business identity |
| `platform` | TEXT | Yes | Organic platform |
| `account_key` | TEXT | Yes | Configured Canonical account key |
| `source_account_id` | TEXT | No | External source account ID |
| `external_content_id` | TEXT | Yes | Provider content ID |
| `content_type` | TEXT | No | Canonical type |
| `published_at` | INTEGER | No | Source publish instant epoch ms |
| `first_seen_at` | INTEGER | Yes | First trusted observation |
| `last_observed_at` | INTEGER | Yes | Latest coverage-confirmed observation |
| `last_changed_at` | INTEGER | No | Latest metric/metadata change |
| `source_availability_status` | TEXT | Yes | available/missing/private/deleted/expired/unknown |
| `views` | INTEGER | No | Latest cumulative value |
| `likes` | INTEGER | No | Latest cumulative value |
| `comments` | INTEGER | No | Latest cumulative value |
| `shares` | INTEGER | No | Latest cumulative value |
| `unique_viewers` | INTEGER | No | Latest value when supported |
| `avg_watch_time_seconds` | REAL | No | Latest observed value |
| `total_watch_time_seconds` | REAL | No | Latest observed value |
| `completion_rate` | REAL | No | Ratio 0–1 |
| `metrics_hash` | TEXT | Yes | Stable hash of normalized metrics |
| `metadata_hash` | TEXT | Yes | Stable hash of normalized metadata |
| `last_coverage_run_id` | TEXT | Yes | Latest coverage proof |
| `last_sync_run_id` | TEXT | Yes | Runtime correlation |
| `created_at` | INTEGER | Yes | D1 audit time |
| `updated_at` | INTEGER | Yes | D1 audit time |

### Constraints and indexes

```text
PRIMARY KEY(content_key)
UNIQUE(platform, account_key, external_content_id)
INDEX(customer_key, platform, account_key, last_observed_at)
INDEX(customer_key, platform, account_key, published_at)
INDEX(source_availability_status, last_observed_at)
```

### UPSERT

- Latest-state fields update only after identity and coverage validation;
- `first_seen_at` never moves forward;
- `last_observed_at` moves only after Entity was actually observed;
- `last_changed_at` changes only when normalized hash changes;
- Missing Source rows do not zero metrics.

## 4.2 `organic_content_observations`

เก็บ Historical observations สำหรับคำนวณ Delta และ Correction

### Grain

```text
customer_key + platform + account_key + external_content_id + observed_at + observation_kind
```

### Stable key

```text
observation_key = content_key:observed_at:observation_kind:v1
```

### Fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `observation_key` | TEXT PK | Yes | Observation Stable key |
| `content_key` | TEXT | Yes | Canonical Content key |
| `customer_key` | TEXT | Yes | Customer identity |
| `platform` | TEXT | Yes | Platform |
| `account_key` | TEXT | Yes | Canonical account key |
| `external_content_id` | TEXT | Yes | Provider content ID |
| `observed_at` | INTEGER | Yes | Exact observation instant |
| `metric_date` | TEXT | Yes | Reporting date `YYYY-MM-DD` |
| `source_timezone` | TEXT | Yes | Date derivation timezone |
| `observation_kind` | TEXT | Yes | initial/changed/checkpoint/correction/backfill |
| `metric_semantics` | TEXT | Yes | `cumulative` for this table v1 |
| `views` | INTEGER | No | Cumulative observation |
| `likes` | INTEGER | No | Cumulative observation |
| `comments` | INTEGER | No | Cumulative observation |
| `shares` | INTEGER | No | Cumulative observation |
| `unique_viewers` | INTEGER | No | Observation when supported |
| `avg_watch_time_seconds` | REAL | No | Observation when supported |
| `total_watch_time_seconds` | REAL | No | Observation when supported |
| `completion_rate` | REAL | No | Ratio 0–1 |
| `metrics_hash` | TEXT | Yes | Normalized metric hash |
| `source_revision` | TEXT | No | Source watermark/revision |
| `coverage_run_id` | TEXT | Yes | Coverage proof |
| `fetched_at` | INTEGER | Yes | Connector fetch instant |
| `sync_run_id` | TEXT | Yes | Runtime correlation |
| `created_at` | INTEGER | Yes | D1 audit time |

### Constraints and indexes

```text
PRIMARY KEY(observation_key)
UNIQUE(content_key, observed_at, observation_kind)
INDEX(content_key, observed_at DESC)
INDEX(customer_key, platform, account_key, metric_date)
INDEX(coverage_run_id, content_key)
```

### Observation rules

สร้าง Observation เมื่อ:

- first trusted observation;
- normalized metrics changed;
- source correction;
- mandatory checkpoint;
- controlled backfill.

ไม่สร้าง Observation เพียงเพราะ Worker retry เดิม

## 4.3 `organic_account_daily_facts`

หนึ่งแถวต่อ Account/Date สำหรับ Dashboard ระดับบัญชี

### Stable key

```text
account_daily_key = platform:account_key:metric_date
```

### Fields

```text
account_daily_key TEXT PRIMARY KEY
customer_key TEXT NOT NULL
platform TEXT NOT NULL
account_key TEXT NOT NULL
source_account_id TEXT
metric_date TEXT NOT NULL
account_timezone TEXT NOT NULL
followers INTEGER
follows INTEGER
profile_views INTEGER
views INTEGER
reach INTEGER
accounts_engaged INTEGER
total_interactions INTEGER
net_follows INTEGER
data_status TEXT NOT NULL
coverage_run_id TEXT NOT NULL
source_revision TEXT
fetched_at INTEGER NOT NULL
sync_run_id TEXT NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

### Indexes

```text
UNIQUE(platform, account_key, metric_date)
INDEX(customer_key, platform, account_key, metric_date)
INDEX(data_status, metric_date)
```

Metric ที่ Platform ไม่รองรับต้องเป็น `null`

## 4.4 `ads_entity_state`

หนึ่งแถวต่อ Ads entity latest state

### Stable key

```text
entity_key = platform:account_key:entity_type:external_entity_id
```

### Fields

```text
entity_key TEXT PRIMARY KEY
customer_key TEXT NOT NULL
platform TEXT NOT NULL
account_key TEXT NOT NULL
source_account_id TEXT NOT NULL
entity_type TEXT NOT NULL
external_entity_id TEXT NOT NULL
parent_campaign_id TEXT
parent_ad_group_id TEXT
parent_ad_id TEXT
external_creative_id TEXT
entity_name TEXT
status TEXT
objective TEXT
currency TEXT
timezone TEXT
source_updated_at INTEGER
first_seen_at INTEGER NOT NULL
last_seen_at INTEGER NOT NULL
source_availability_status TEXT NOT NULL
metadata_hash TEXT NOT NULL
last_coverage_run_id TEXT NOT NULL
last_sync_run_id TEXT NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

### Indexes

```text
UNIQUE(platform, account_key, entity_type, external_entity_id)
INDEX(customer_key, platform, account_key, entity_type, last_seen_at)
INDEX(platform, account_key, parent_campaign_id)
INDEX(platform, account_key, parent_ad_group_id)
```

## 4.5 `ads_daily_facts`

เก็บ Daily facts ที่ Query ช่วงย้อนหลังได้และรองรับ Breakdown

### Stable key

```text
ads_fact_key
= platform:account_key:report_level:external_entity_id:metric_date:breakdown_key:segment_key
```

`breakdown_key` และ `segment_key` ต้องใช้ค่า `none` เมื่อไม่มี ไม่ใช้ `null` ใน Stable key

### Fields

```text
ads_fact_key TEXT PRIMARY KEY
customer_key TEXT NOT NULL
platform TEXT NOT NULL
account_key TEXT NOT NULL
source_account_id TEXT NOT NULL
report_level TEXT NOT NULL
entity_type TEXT NOT NULL
external_entity_id TEXT NOT NULL
external_campaign_id TEXT
external_ad_group_id TEXT
external_ad_id TEXT
external_creative_id TEXT
metric_date TEXT NOT NULL
account_timezone TEXT NOT NULL
breakdown_key TEXT NOT NULL
segment_key TEXT NOT NULL
ad_channel TEXT
currency TEXT NOT NULL
spend_micros INTEGER
impressions INTEGER
reach INTEGER
clicks INTEGER
conversions REAL
conversion_value_micros INTEGER
video_views INTEGER
video_view_rate REAL
average_cpv_micros INTEGER
actions_json TEXT
breakdown_json TEXT
data_status TEXT NOT NULL
coverage_run_id TEXT NOT NULL
source_revision TEXT
source_payload_hash TEXT NOT NULL
fetched_at INTEGER NOT NULL
sync_run_id TEXT NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

### Constraints and indexes

```text
UNIQUE(platform, account_key, report_level, external_entity_id, metric_date, breakdown_key, segment_key)
INDEX(customer_key, platform, account_key, metric_date)
INDEX(platform, account_key, report_level, external_entity_id, metric_date)
INDEX(platform, account_key, external_campaign_id, metric_date)
INDEX(coverage_run_id, metric_date)
```

### UPSERT

- Incoming revision ใหม่สามารถแก้วันเดิมได้;
- Money เปรียบเทียบเป็น micros;
- `source_payload_hash` ใช้ตรวจ no-op;
- Retry เดิมต้องไม่สร้างแถวใหม่;
- Partial response ห้ามลบ facts ที่ไม่ได้อยู่ใน Response;
- Complete reconciliation เท่านั้นจึงอนุญาตให้ mark missing entities ตาม Source contract.

## 4.6 `ads_conversion_daily_facts`

แยก Conversion action/Category/Segment ไม่ให้ถูก Collapse

### Stable key

```text
conversion_fact_key
= platform:account_key:report_level:external_entity_id:metric_date:conversion_action_key:conversion_category:segment_key
```

### Fields

```text
conversion_fact_key TEXT PRIMARY KEY
customer_key TEXT NOT NULL
platform TEXT NOT NULL
account_key TEXT NOT NULL
source_account_id TEXT NOT NULL
report_level TEXT NOT NULL
external_entity_id TEXT NOT NULL
external_campaign_id TEXT
external_ad_group_id TEXT
external_ad_id TEXT
metric_date TEXT NOT NULL
account_timezone TEXT NOT NULL
conversion_action_key TEXT NOT NULL
conversion_action_name TEXT
conversion_category TEXT NOT NULL
segment_key TEXT NOT NULL
currency TEXT NOT NULL
conversions REAL
all_conversions REAL
conversion_value_micros INTEGER
all_conversion_value_micros INTEGER
data_status TEXT NOT NULL
coverage_run_id TEXT NOT NULL
source_revision TEXT
source_payload_hash TEXT NOT NULL
fetched_at INTEGER NOT NULL
sync_run_id TEXT NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

### Indexes

```text
UNIQUE(platform, account_key, report_level, external_entity_id, metric_date, conversion_action_key, conversion_category, segment_key)
INDEX(customer_key, platform, account_key, metric_date)
INDEX(platform, account_key, conversion_action_key, metric_date)
INDEX(platform, account_key, external_campaign_id, metric_date)
```

## 4.7 `data_coverage_runs`

เก็บหลักฐานว่า Source scope ถูกตรวจครบหรือไม่

### Fields

```text
coverage_run_id TEXT PRIMARY KEY
sync_run_id TEXT NOT NULL
customer_key TEXT NOT NULL
platform TEXT NOT NULL
account_key TEXT NOT NULL
dataset_key TEXT NOT NULL
metric_semantics TEXT NOT NULL
scope_mode TEXT NOT NULL
period_start TEXT
period_end TEXT
source_timezone TEXT NOT NULL
status TEXT NOT NULL
expected_entities INTEGER
observed_entities INTEGER
expected_rows INTEGER
observed_rows INTEGER
written_rows INTEGER
failed_rows INTEGER NOT NULL DEFAULT 0
source_watermark TEXT
revisable_until INTEGER
started_at INTEGER NOT NULL
completed_at INTEGER
error_code TEXT
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

### Controlled values

```text
scope_mode = full_inventory | recent_window | exact_entities | report_range
status = complete | partial | no_data_confirmed | source_unavailable | not_observed | revisable
metric_semantics = cumulative | period | snapshot
```

### Indexes

```text
INDEX(customer_key, platform, account_key, dataset_key, completed_at)
INDEX(status, revisable_until)
INDEX(sync_run_id, dataset_key)
```

## 4.8 `data_coverage_entities`

ใช้เฉพาะ Scope ที่ไม่ใช่ Full inventory หรือเมื่อจำเป็นต้องพิสูจน์ Entity รายตัว

### Stable key

```text
coverage_entity_key = coverage_run_id:entity_type:external_entity_id
```

### Fields

```text
coverage_entity_key TEXT PRIMARY KEY
coverage_run_id TEXT NOT NULL
entity_type TEXT NOT NULL
external_entity_id TEXT NOT NULL
observation_status TEXT NOT NULL
source_revision TEXT
observed_at INTEGER
created_at INTEGER NOT NULL
```

ห้ามเขียน Entity coverage ทุกตัวใน Full inventory โดยอัตโนมัติเมื่อ Run-level proof เพียงพอ เพราะจะสร้าง Time-series volume ซ้ำโดยไม่จำเป็น

## 4.9 `report_materializations`

เก็บผลคำนวณ Deterministic ก่อนส่ง Lark/AI

### Stable key

```text
report_id
= report_setting_key:account_key:period_kind:period_start:period_end:formula_version
```

### Fields

```text
report_id TEXT PRIMARY KEY
report_setting_key TEXT NOT NULL
customer_key TEXT NOT NULL
platform_scope TEXT NOT NULL
account_key TEXT NOT NULL
report_type TEXT NOT NULL
period_kind TEXT NOT NULL
window_days INTEGER
period_start TEXT NOT NULL
period_end TEXT NOT NULL
compare_start TEXT
compare_end TEXT
data_status TEXT NOT NULL
coverage_rate REAL
formula_version TEXT NOT NULL
source_watermark TEXT
payload_json TEXT NOT NULL
payload_checksum TEXT NOT NULL
generated_at INTEGER NOT NULL
expires_at INTEGER
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

### Rules

- `payload_json` เป็น bounded materialized result ไม่ใช่ Raw history;
- Payload ต้องมี Version และ Size guard;
- AI อ่านจาก Report snapshot นี้เท่านั้น;
- Report เดิมที่ Source watermark เหมือนเดิมต้อง Reuse ได้;
- Report retry ต้องไม่สร้างผลซ้ำ.

## 4.10 `report_requests`

รองรับ Custom range ที่ลูกค้าร้องขอ

```text
request_id TEXT PRIMARY KEY
customer_key TEXT NOT NULL
account_key TEXT NOT NULL
platform_scope TEXT NOT NULL
period_start TEXT NOT NULL
period_end TEXT NOT NULL
comparison_mode TEXT NOT NULL
status TEXT NOT NULL
result_report_id TEXT
requested_at INTEGER NOT NULL
started_at INTEGER
finished_at INTEGER
error_code TEXT
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

Custom range ต้องผ่าน Queue/lock/idempotency และ Materialize ผลก่อน Dashboard แสดง ไม่ Query Detailed D1 facts จาก Lark โดยตรง

## 5. Dashboard period contract

### Preset materialization

ระบบต้อง Materialize Preset ต่อไปนี้ทุกวันหลัง completed day พร้อม:

```text
3D
7D
9D
15D
30D
90D
```

แต่ Schedule ยังปิดจน Manual validation ผ่าน

### Organic calculation

ต่อ Content:

1. หา latest observation `<= period_end`;
2. หา latest observation `< period_start`;
3. ถ้า Published ในช่วงและไม่มี Baseline ให้ใช้ zero baseline;
4. ถ้า Content เก่าและไม่มี Baseline ให้ mark partial;
5. รวม Delta เฉพาะ known values;
6. แสดง Coverage rate และ Data status.

### Ads calculation

1. Query facts `period_start..period_end` ตาม account/report level;
2. SUM additive metrics;
3. คำนวณ CTR/CPC/CPM/CPA/ROAS จาก Components หลัง Aggregate;
4. ห้าม Average ค่า Ratio รายวัน;
5. ใช้ Revision ล่าสุดต่อ Stable key;
6. แสดง Attribution/data freshness watermark.

### Timezone

- ใช้ Account reporting timezone เมื่อ Source กำหนด;
- Integration Workspace default เป็น `Asia/Bangkok` เมื่อ Source contract อนุญาต;
- UTC instant และ Source raw date ต้องเก็บแยกจาก reporting date;
- Date range เป็น Inclusive ทั้งวันเริ่มและวันสิ้นสุด.

## 6. Lark table responsibilities after cutover

| Lark table | Target role | Retention direction |
| --- | --- | --- |
| `MKT_Content` | One current row per Content | Retain while Content/customer exists |
| `MKT_Content_Daily` | Recent/diagnostic compatibility cache | Target bounded only after D1 parity and reader cutover |
| `MKT_Account_Daily` | Long-term account daily aggregate for Dashboard | Target at least 400 completed days |
| `MKT_Ads_Daily` | Recent customer-visible Ads detail cache | Target bounded only after D1 parity and attribution validation |
| `MKT_Report_Snapshots` | Materialized report header/payload | Target at least 400 completed days |
| `MKT_Report_Metric_Values` | Materialized KPI values | Same lifecycle as Report snapshot |
| `MKT_Report_Top_Content` | Materialized Top Content | Same lifecycle as Report snapshot |
| `MKT_Report_Top_Ads` | Materialized Top Campaign/Ad | Same lifecycle as Report snapshot |
| Protected/Native RAW (`RAW_TikTok_Creator_Videos`) | External source contract | Our Worker must not delete or mutate |
| Non-TikTok Source-specific/Shared RAW | Legacy Integration Base cleanup only | Retire after exact backup, D1 parity and zero-consumer proof |

`MKT_Content_Daily` และ `MKT_Ads_Daily` ยังห้ามลบ/หยุดเขียนใน Phase 1

## 7. `MKT_Content` field ownership

### System-managed and updateable

```text
content_key
platform
account_id
external_content_id
content_type
published_at
caption
content_url
thumbnail_url
duration_seconds
latest_views
latest_likes
latest_comments
latest_shares
latest_unique_viewers
avg_watch_time_seconds
completion_rate
first_seen_at
last_observed_at
last_changed_at
```

### Manual-managed / never overwrite after user edit

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

### Classification merge rule

- ระบบเติม Manual-managed classification fields ได้เฉพาะตอน Create หรือเมื่อ Existing value ว่าง;
- ถ้า `classification_source=manual` ให้ preserve Classification fields ทั้งชุด;
- `manual_tag_note` ห้ามเขียนทับทุกกรณีหลัง Record ถูกสร้าง;
- `classification_confidence` และ `classification_source` update ได้เฉพาะเมื่อไม่มี Manual override;
- Incoming `null` ห้ามล้าง Existing manual value;
- Formula, Lookup, Relation และ Lark audit fields ที่ไม่ได้อยู่ใน Incoming ownership mask ห้ามแตะ.

Implementation ต้องเพิ่ม Field-level merge policy ก่อน Canonical TikTok write

## 8. RAW lineage contract

### Protected TikTok Native

```text
RAW_TikTok_Creator_Videos
→ read-only normalize
→ D1 Organic state/observations/coverage
→ Lark MKT_Content current state
→ temporary MKT_Content_Daily compatibility write during migration
```

### YouTube

```text
D1 Organic state/observations/coverage
D1 youtube_analytics_daily_facts period facts
→ customer-facing MKT_Content / MKT_Content_Daily / MKT_Accounts
→ must not overwrite cumulative observations
```

### Meta Organic

```text
Provider payload → explicit cumulative/period/snapshot normalization
→ D1 state/facts/coverage → customer-facing MKT tables
```

### Paid Ads

```text
Provider payload → D1 entities/daily facts/coverage → Canonical Lark
```

ห้ามกลับมา Dual-write Lark RAW; legacy RAW tables ลบได้หลัง exact backup, D1 parity และ
zero-consumer proof ตาม retirement contract วันที่ 2026-08-14 เท่านั้น.

## 9. Feature flags for migration

ทุก Flag ต้อง Default `false`

```text
MKT_TIME_SERIES_D1_WRITE_ENABLED
MKT_TIME_SERIES_D1_BACKFILL_ENABLED
MKT_REPORT_D1_SHADOW_READ_ENABLED
MKT_REPORT_D1_READ_ENABLED
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED
MKT_LARK_DAILY_RETENTION_ENABLED
MKT_NOTIFICATION_RUNTIME_ENABLED
```

กฎ:

- Write flag ไม่เปิด Schedule;
- Shadow read ห้ามเปลี่ยน Customer-visible output;
- D1 read cutover ต้องแยกจาก Lark retention;
- Retention flag เปิดได้หลัง Backup/Parity/Rollback approval เท่านั้น;
- Production flags ปิดจน Customer-owned infrastructure ผ่าน Cutover gate.

## 10. Migration sequence

### Phase 0 — Documentation baseline

- Merge Contract นี้เข้า `main`;
- เปลี่ยน Current Task จาก TikTok write เป็น Storage foundation planning;
- ยังไม่มี Code/Lark/D1 mutation.

### Phase 1 — Runtime and ownership alignment

- เพิ่ม canonical `integration_workspace` profile;
- TikTok ใช้ `accountKey=chemistry_k`, source handle `chemistry_k`;
- Legacy profile names เป็น Compatibility aliases;
- แก้ Report setting identity;
- เพิ่ม Field-level ownership merge policy;
- Tests ต้องล็อก Contract ใหม่;
- ยังไม่เขียนข้อมูลจริง.

### Phase 2 — D1 schema foundation

- เพิ่ม Migration สำหรับ Tables/Indexes ในหัวข้อ 4;
- เพิ่ม Repository interfaces และ typed contracts;
- Replay migration บน Empty และ Existing local D1;
- ตรวจ Remote D1 capacity แบบ Read-only;
- Flags ทั้งหมดปิด.

### Phase 3 — Feature-flagged dual-write

- Manual one-shot เท่านั้น;
- Schedule ปิด;
- Source validation ก่อน write;
- เขียน D1 ก่อนหรือ Persist durable outbox ก่อน Lark ตาม exact failure contract;
- ห้ามเกิด D1/Lark split-brain แบบไม่ Reconcile;
- เก็บ Coverage และ Sync Log.

### Phase 4 — Controlled historical bootstrap

- TikTok Native RAW backfill สร้าง Current state และ first observation เท่าที่ Source พิสูจน์ได้;
- ห้ามสร้าง Daily history ปลอมย้อนหลัง;
- Coverage start ถูกบันทึก;
- Existing Lark Daily rows import ได้เฉพาะเมื่อ Stable key, date, account และ metric semantics ผ่าน Audit.

### Phase 5 — Report shadow read

- คำนวณจาก D1 โดยไม่เปลี่ยน Dashboard output;
- เปรียบเทียบกับ Reader เดิม;
- ตรวจ 3D/7D/9D/15D/30D/90D/Custom;
- เก็บ Diff evidence และ Coverage.

### Phase 6 — Report reader cutover

- เปิด `MKT_REPORT_D1_READ_ENABLED` เฉพาะ Integration Workspace;
- Materialize Presets เข้า `MKT_Report_*`;
- Rollback ได้ด้วย Flag เดียว;
- Reader เดิมยังอยู่จน Observation period ผ่าน.

### Phase 7 — Bounded Lark retention

- Export/backup Exact scope;
- Dry-run delete plan;
- Reconciliation ก่อนและหลัง;
- Retention job แยกจาก Sync;
- ไม่มีการลบ Protected Native RAW;
- เปิดหลัง User approval แยกต่างหาก.

### Phase 8 — Notification

- เพิ่ม customer configuration หลัง Report deterministic และ Coverage ผ่าน;
- AI อธิบาย Report snapshot ไม่คำนวณ Raw metrics;
- Queue/D1 จัดการ next run, lock, retry, idempotency และ delivery history.

### Phase 9 — Production

- ใช้ Customer-owned Lark/Cloudflare/D1/Queue/Secrets;
- Backfill, parity, schedule และ cutover มี Approval แยก.

## 11. Parity and acceptance gates

### Dashboard range matrix

```text
3D     PASS
7D     PASS
9D     PASS
15D    PASS
30D    PASS
90D    PASS
CUSTOM PASS
```

ทดสอบอย่างน้อย:

- cumulative Organic delta;
- New Content zero baseline;
- Old Content missing baseline = partial;
- negative correction;
- no-change sparse observation + complete coverage;
- period Organic metrics;
- Ads additive sums;
- fractional conversions;
- money micros exactness;
- Attribution revision;
- zero versus null;
- source unavailable;
- no-data confirmed;
- timezone/month/year boundary;
- duplicate delivery/retry;
- partial write/recovery;
- idempotent rerun;
- large account pagination;
- report materialization retry;
- source watermark change.

### Equality rules

- Integer counters: exact equality;
- Money micros: exact equality;
- Date and Stable key: exact equality;
- Ratios: calculate from aggregated components and compare within approved floating tolerance;
- `null`, `0`, `partial` และ `no_data_confirmed` ต้องไม่ถูกถือว่าเท่ากัน.

### Live gate

ก่อน Customer-visible cutover:

- Capture Source/API totals for the exact period;
- D1 result matches deterministic expected result;
- Lark materialization matches D1;
- Same request rerun creates zero duplicates;
- Failure/retry does not double-count;
- Dashboard displays data status and coverage;
- Schedule remains off until accepted.

## 12. Rollback contract

- Disable `MKT_REPORT_D1_READ_ENABLED` to return Reader to previous path before retention;
- Dual-write failures remain recoverable through Sync Log/outbox/reconciliation;
- No Lark historical deletion before D1 parity and backup;
- D1 migrations are additive in initial phases;
- Destructive/rebuild migration requires separate quiesce/backup/runbook;
- Retention deletion requires generated exact key list and post-delete reconciliation;
- Production rollback is separate from Integration Workspace rollback.

## 13. Capacity and retention gates

Phase 1 ห้ามเปิด Auto-delete ใน D1

ต้องเก็บ Read-only evidence ก่อนกำหนด Threshold:

```text
D1 current database size
row counts by table
average and maximum row size
index count and query plans
writes/day by connector
projected rows at 90D / 1Y / 3Y
report query latency
backup/export duration
```

หลัง Audit จึงอนุมัติ:

- D1 retention;
- R2 archive threshold;
- batch size;
- compaction/archive cadence;
- report cache expiry;
- notification log retention.

## 14. Pull request boundaries

แยก PR อย่างน้อยดังนี้:

1. Runtime/profile and field-ownership alignment;
2. D1 migration and repositories;
3. Organic dual-write and bootstrap;
4. Ads dual-write contracts;
5. Report shadow reader;
6. Report cutover/materialization;
7. Lark retention;
8. Notification configuration/runtime;
9. Google Ads signed-delivery rebuild/rebase.

ห้ามรวม Migration, Report cutover, Retention deletion, Notification และ Google Ads connector ไว้ใน PR เดียว

## 15. Current blockers

```text
RUNTIME_PROFILE_ALIGNMENT = BLOCKED
CONTENT_FIELD_OWNERSHIP = BLOCKED
D1_HISTORICAL_TABLES = NOT_IMPLEMENTED
D1_CAPACITY_EVIDENCE = MISSING
LIVE_ROW_LINEAGE = NOT_CAPTURED
REPORT_D1_READER = NOT_IMPLEMENTED
LARK_RETENTION = NOT_APPROVED
GOOGLE_ADS_PR_17 = HOLD
TIKTOK_CANONICAL_WRITE = BLOCKED
SCHEDULE = DISABLED
PRODUCTION = BLOCKED
```

## 16. Next authorized work after this docs baseline

งาน Implementation แรกที่เสนอให้เปิดแยกคือ:

```text
Storage Foundation Phase 1
= Runtime identity alignment
+ MKT_Content field ownership policy
+ Exact D1 migration implementation
+ repositories/tests
+ all feature flags false
+ no Live data write
```

การเริ่ม Phase 1 ต้องอ่าน Contract นี้, ตรวจ `main` ล่าสุด และอัปเดต `docs/current-task.md` ให้เป็น Implementation task ก่อนแก้ Source code
