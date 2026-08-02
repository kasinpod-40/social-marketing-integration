# Lark Native AI & Notification Readiness v1

## Status

```text
WORKSTREAM                         = LARK_NATIVE_AI_NOTIFICATION_READINESS_V1
BRANCH                             = design/lark-native-ai-notification-v1
BASE_MAIN_SHA                      = 1c15195dab950cf9e8eca367b56f3d7488711bb7
MODE                               = REPOSITORY_AND_BASE_AUDIT_DESIGN_ONLY
CONTRACT_VERSION                   = report_to_lark_ai_v1
CHANNEL_SCOPE                      = ALL_EXPECTED_CHANNELS_EVERY_WINDOW
TIKTOK_GOLDEN_DATASET_ROLE         = POPULATED_FIXTURE_NOT_SCOPE_BOUNDARY
FROZEN_REPORT_OUTPUT_CONTRACT      = REQUIRED
LARK_NATIVE_AI                     = NOT_CONFIGURED
LARK_GROUP_NOTIFICATION            = DISABLED
LARK_AUTOMATION_SCHEDULE           = DISABLED
PREVIEW_MODE                       = REQUIRED
REMOTE_LARK_WRITE                  = 0
REMOTE_D1_QUERY_WRITE              = 0
QUEUE_DLQ_ACTION                   = 0
WORKER_DEPLOYMENT                  = 0
PROVIDER_ACTION                    = 0
PRODUCTION                         = BLOCKED
```

## Corrected objective

AI Preview และ Executive Preview ต้องครอบคลุมทุกช่องทางตั้งแต่รอบแรก ไม่ใช่แสดงเฉพาะ TikTok Organic

กฎหลัก:

```text
ช่องทางมี validated Report ใน window นั้น
→ แสดง Metric ที่มีจริง + Summary + Insight + Recommendation ตาม Coverage

ช่องทางไม่มี validated Report ใน window นั้น
→ แสดงสถานะ “ยังไม่มีข้อมูล” หรือสถานะสาเหตุที่ตรงจริง
→ ห้ามหายไปจากรายงาน
→ ห้ามสร้างตัวเลข, Insight หรือ Recommendation ทางธุรกิจปลอม

Executive summary
→ แสดงสถานะครบทุกช่องทาง
→ สรุปเฉพาะหลักฐานที่มีจริง
→ ระบุช่องทางที่ยังไม่มีข้อมูลอย่างชัดเจน
```

TikTok Organic เป็น Golden Dataset สำหรับพิสูจน์ Positive path เท่านั้น ส่วนช่องทางอื่นเป็น Negative/Readiness path ที่ต้องปรากฏใน Preview เดียวกัน

---

# 1. Evidence audited

## 1.1 Repository authority

อ่านและยึด:

- `AGENTS.md`
- `docs/current-task.md`
- `PROJECT_BRAIN.md`
- `docs/project-brain/storage-architecture-and-migration-contract-v1.md`
- `docs/project-brain/time-series-retention-and-notification.md`
- `docs/tasks/multichannel-report-coverage-v1.md`
- Frozen Report payload, Lark output schema, writer, views and Dashboard contracts

Parallel boundary:

- ไม่แก้ `docs/current-task.md`;
- ไม่แก้ Meta continuation files หรือ retained evidence;
- ไม่แก้ Report materializer/writer/Metric Matrix files;
- ไม่ Replay Provider หรือส่ง Queue;
- ไม่ทำ Remote Lark/D1/Worker mutation.

## 1.2 Exact Base audit

Audited artifact:

```text
file        Social MKT Data Hub(14).base
sha256      6dab2da7a8184d65c9e257747aa65ef3717f8d015b44214e199ddaebd165d128
base name   Social MKT Data Hub
physical tables 72
dashboards      6
automations     0
```

`gzipAutomation=[]` ยืนยันว่า Base snapshot นี้ไม่มี Automation อยู่เดิม

## 1.3 Existing AI and notification inventory

### `🧠 MKT_AI_Report_Runs`

Existing table, `0` records. ต้อง Reuse ห้ามสร้าง AI summary table ใหม่ซ้ำ

Existing fields:

```text
report_id
platforms
report_type
period_start
period_end
compare_start
compare_end
comparison_mode
metric_summary_json
insight_summary
strengths
weaknesses
recommendations
course_filter
sent_to_group
sent_at
```

Existing Views:

```text
📅 Daily Reports
🗓️ Weekly Reports
📆 Monthly Reports
🧾 Yearly Reports
🕘 Latest Reports
```

Current gaps:

- ไม่มี Stable AI run key;
- ไม่มี channel/readiness/data-status fields;
- ไม่มี severity, dedupe, cooldown หรือ preview fields;
- `platforms` ยังไม่มี `woocommerce` และ `chatwoot`;
- `report_type` options ยังไม่รองรับ Dashboard channel-status และ cross-channel executive contract;
- ไม่มี records และไม่มี Lark Native AI prompt binding.

### `⚙️ MKT_Report_Settings`

Existing table, `68` records. ใช้เป็น AI/Notification setting authority v1 ห้ามสร้าง Settings table ซ้ำ

Existing relevant fields:

```text
report_setting_key
customer_profile
report_type
platforms
period_kind
window_days
comparison_mode
enabled
ai_enabled
notification_enabled
group_id
language
send_time
send_weekday
timezone
utc_offset
top_content_limit
top_ads_limit
```

Exact state:

```text
enabled=true             66
enabled=false             2
ai_enabled=false         68
notification_enabled=false 68
```

Platform setting records:

```text
tiktok       12
facebook      8
instagram     8
youtube       8
meta_ads      8
google_ads    8
tiktok_ads    8
woocommerce   8
chatwoot      0
```

Chatwoot thereforeต้องแสดง `configuration_missing` จน Report workstream เพิ่ม exact setting/option ที่อนุมัติแล้ว ห้าม AI workstream เติมเองโดยเงียบ

### Frozen Report outputs in Base

```text
🧾 MKT_Report_Snapshots       13 records
📊 MKT_Report_Metric_Values   86 records
🏆 MKT_Report_Top_Content     20 records
📣 MKT_Report_Top_Ads          0 records
```

Dashboard materializations ที่มีจริง:

```text
TikTok Organic 1D   partial
TikTok Organic 3D   partial
TikTok Organic 7D   partial
TikTok Organic 30D  partial
```

แต่ละ window มี `17` Dashboard metric rows:

```text
available             11
baseline_incomplete    6
```

รวม Dashboard rows `68`; อีก `18` rows เป็น Legacy daily/weekly TikTok metrics

ไม่มี Dashboard Report Snapshot/Metric row สำหรับ Facebook, Instagram, YouTube, Meta Ads, Google Ads, TikTok Ads, WooCommerce หรือ Chatwoot ใน Base snapshot นี้

### Missing existing objects

Exact Base readback ไม่พบ:

- Lark Automation;
- Notification attempt/log table;
- Group message template table;
- Native AI prompt configuration evidence;
- Notification destination table.

V1 จะ Reuse `group_id` ใน `MKT_Report_Settings`; ไม่สร้าง destination table จนกว่าจะมี requirement หลายปลายทางหรือ verification lifecycle ที่ตารางเดิมรองรับไม่ได้

---

# 2. Locked architecture

```text
Source / Connector
→ Normalized + Daily
→ validated report_materializations
→ Lark Report Snapshot / Metric / Top rows
→ Lark Native AI in MKT_AI_Report_Runs
→ Lark Automation
→ Lark Group Notification
```

AI input allowlist:

```text
MKT_Report_Snapshots
MKT_Report_Metric_Values
MKT_Report_Top_Content
MKT_Report_Top_Ads
```

Forbidden:

- Raw tables;
- Canonical entity/detail tables;
- Daily detail tables;
- Detailed D1 facts;
- External AI provider or AI API;
- Custom model runtime;
- AI Worker/Queue หรือ token-cost engine;
- AI calculation, aggregation, ratio recomputation or metric correction;
- zero substitution for null/N/A;
- hidden omission of a channel that lacks data.

---

# 3. Expected channel registry

ทุก `window_days=1|3|7|30` ต้องสร้าง status slot ครบรายการต่อไปนี้ แม้ไม่มี Report

| channel_key | capability | Report platform | Current Base setting | Current Base Report |
|---|---|---|---|---|
| `tiktok_organic` | organic | `tiktok` | present | present, partial, 1/3/7/30 |
| `facebook_organic` | organic | `facebook` | present | missing |
| `instagram_organic` | organic | `instagram` | present | missing |
| `youtube_organic` | organic | `youtube` | present | missing |
| `meta_ads` | paid_ads | `meta_ads` | present | missing |
| `google_ads` | paid_ads | `google_ads` | present | missing |
| `tiktok_ads` | paid_ads | `tiktok_ads` | present | missing |
| `woocommerce` | commerce | `woocommerce` | present | missing |
| `chatwoot` | customer_service | `chatwoot` | missing | missing |

`operations` เป็น supporting evidence สำหรับ Data Quality และ severity แต่ไม่ใช่ Marketing channel slot

---

# 4. Report-to-Lark-AI Contract v1

## 4.1 Run grain

Channel run:

```text
customer_key
+ channel_key
+ account_id
+ window_days
+ period_start
+ period_end
+ template_version
```

Executive run:

```text
customer_key
+ executive
+ window_days
+ period_start
+ period_end
+ sorted channel status vector
+ template_version
```

Required Preview output per window:

```text
9 channel rows
+ 1 executive row
= 10 AI rows per window
```

Four windows produce `40` Preview rows

## 4.2 Report selection

For each expected channel/window:

1. Resolve enabled `MKT_Report_Settings` identity;
2. select exact `dashboard_performance_report` output by customer, platform, capability, account, period and window;
3. require validated Stable key/checksum and matching Snapshot/Metric dimensions;
4. use the latest `generated_at` only when all identity fields match;
5. duplicate conflicting outputs fail closed;
6. absence does not remove the channel slot.

## 4.3 Readiness states

| readiness_status | Meaning | Metrics shown | Business AI | Default message |
|---|---|---:|---:|---|
| `report_available` | validated Report `complete` | available values | allowed | `มีข้อมูล Report พร้อมใช้งาน` |
| `report_partial` | validated Report `partial` or incomplete Coverage | known values only | bounded; must disclose limitations | `มีข้อมูลบางส่วน ยังไม่ครบ` |
| `no_data_confirmed` | source scope checked and no rows | none; never synthetic zero | no business recommendation | `ตรวจสอบแล้ว แต่ไม่มีข้อมูลในช่วงนี้` |
| `source_unavailable` | source/connector unavailable | none | forbidden | `แหล่งข้อมูลยังไม่พร้อม` |
| `not_observed` | no trusted observation | none | forbidden | `ยังไม่มีข้อมูลสังเกตการณ์` |
| `report_missing` | setting exists but no validated Report for window | none | forbidden | `ยังไม่มีข้อมูล Report สำหรับช่วงนี้` |
| `configuration_missing` | expected channel lacks approved setting/mapping | none | forbidden | `ยังไม่ได้ตั้งค่า Report สำหรับช่องทางนี้` |
| `validation_failed` | Report exists but contract/parity fails | none | forbidden | `ข้อมูล Report ไม่ผ่านการตรวจสอบ` |

## 4.4 Null/N/A semantics

```text
observed zero               = 0
missing/unsupported metric  = null + N/A
baseline incomplete         = null + N/A + baseline message
report missing              = no metric values
no_data_confirmed           = no metric values, not all metrics = 0
partial                     = display known values; unknown values remain N/A
```

AI must not use phrases such as “ลดลงเหลือศูนย์” when the value is null or the Report is absent

## 4.5 Channel output contract

Every channel row contains:

```text
channel identity
window and period
readiness_status
readiness_message
data_status
coverage_rate when present
available metrics only
N/A metric inventory
Top Content/Top Ads/collections when present
summary
insight with evidence references
recommendation or explicit withheld reason
severity
notification_eligible
preview_mode
```

A missing channel still receives a complete status row with no fabricated metric payload

## 4.6 Executive output contract

Executive summary must contain:

1. status count by readiness state;
2. one line for every expected channel;
3. highlights only from channels with validated Report evidence;
4. data-quality limitations and missing channels;
5. recommendations only where evidence supports them;
6. no cross-channel arithmetic across incompatible units/currencies;
7. overall coverage state:

```text
complete_coverage
partial_coverage
no_reports_available
validation_blocked
```

Current Base Preview must be `partial_coverage`: TikTok Organic has partial Report evidence and the other expected channels remain missing/configuration-missing

---

# 5. Existing table reuse and additive Lark design

## 5.1 Reuse `🧠 MKT_AI_Report_Runs`

Do not create `MKT_AI_Briefs` or another AI output table

Existing output fields remain authoritative:

```text
metric_summary_json
insight_summary
strengths
weaknesses
recommendations
sent_to_group
sent_at
```

Additive fields required before Preview:

```text
ai_run_key                 Text / deterministic unique identity
scope_type                 SingleSelect: channel, executive
channel_key                SingleSelect: nine expected channels, executive
capability                 Text
account_id                 Text
window_days                SingleSelect: 1, 3, 7, 30
data_status                SingleSelect matching Report contract
readiness_status           SingleSelect matching section 4.3
readiness_message          Text
coverage_rate              Number 0.0000
source_report_ids_json     Text / bounded JSON array
source_report_checksum     Text
channel_status_vector_json Text / executive only, bounded
severity                   SingleSelect: info, warning, critical
notification_eligible      Checkbox
notification_reason        Text
dedupe_key                 Text
cooldown_until             DateTime
preview_mode               Checkbox
generation_status          SingleSelect: pending, generated, skipped, failed
failure_code               Text
template_version           Text
generated_at               DateTime
```

Option extensions:

```text
platforms    add woocommerce, chatwoot
report_type  add dashboard_channel_status, dashboard_executive_summary
```

No rename/delete/type mutation of existing fields

## 5.2 Reuse `⚙️ MKT_Report_Settings`

Use existing:

```text
ai_enabled
notification_enabled
group_id
language
send_time
send_weekday
timezone
```

No new Settings or Destination table in v1

Required Report-owned future change:

```text
platforms option add chatwoot
approved Chatwoot 1/3/7/30 report settings
```

Until that change, Chatwoot remains visible as `configuration_missing`

## 5.3 Notification log

Base has no notification log. Create only one new table after Preview contract passes:

`MKT_Notification_Log`

Minimum fields:

```text
notification_attempt_key
ai_run_key
dedupe_key
destination_key_hash
window_days
period_start
period_end
severity
payload_checksum
attempt_status
attempted_at
sent_at
failure_code
redacted_failure_message
preview_mode
```

Do not store tokens, webhook URLs or raw group identifiers in the log

---

# 6. Lark Native AI templates

## 6.1 Channel summary

```text
คุณกำลังสรุป validated Report ของช่องทาง {{channel_name}} ช่วง {{window_days}} วัน

สถานะข้อมูล: {{readiness_status}} — {{readiness_message}}

กฎ:
- ใช้เฉพาะ Metric ที่ value ไม่เป็น null และมี availability_status=available
- ค่า null/N/A ห้ามตีความเป็น 0
- ห้ามคำนวณ Metric หรือ Ratio ใหม่
- ถ้าไม่มี Report ให้ตอบเพียงสถานะว่า “ยังไม่มีข้อมูล” พร้อมสาเหตุ
- ถ้า partial ให้ระบุข้อจำกัดก่อนข้อสรุป
- อ้าง Evidence ด้วย metric_key/report_id ไม่อ้าง Raw record
```

## 6.2 Insight

```text
สร้าง Insight ไม่เกิน 3 ข้อจากหลักฐานที่ส่งให้เท่านั้น
แต่ละข้อระบุ Evidence keys
ห้ามอธิบายสาเหตุเชิงธุรกิจที่ข้อมูลไม่ได้พิสูจน์
ถ้า readiness ไม่ใช่ report_available/report_partial ให้ตอบว่า Insight ถูกงดเพราะข้อมูลยังไม่พร้อม
```

## 6.3 Recommendation

```text
สร้าง Recommendation เฉพาะเมื่อมี Evidence ที่สัมพันธ์โดยตรง
ระบุ action, evidence, expected check และ review window
ถ้า Report missing, source unavailable, not observed หรือ no_data_confirmed:
งด Recommendation ทางธุรกิจ และให้ได้เฉพาะ Data-readiness next step
```

## 6.4 Executive summary

```text
สร้างรายงานผู้บริหารจาก Channel Status ทั้งหมดตาม registry
ต้องแสดงทุกช่องทางแม้ไม่มีข้อมูล
เริ่มด้วยจำนวนช่องทางที่พร้อม/บางส่วน/ยังไม่มีข้อมูล/ตั้งค่าไม่ครบ
สรุป Highlight เฉพาะช่องทางที่มี validated Report
แยก “ผลการดำเนินงาน” ออกจาก “สถานะความพร้อมของข้อมูล”
ห้ามรวมเงินต่างสกุลหรือ Metric ต่างความหมาย
```

## 6.5 Group message

```text
📊 Marketing Update — {{window_days}}D
ช่วง: {{period_start}} ถึง {{period_end}}

พร้อมใช้งาน: {{available_count}}
ข้อมูลบางส่วน: {{partial_count}}
ยังไม่มีข้อมูล: {{missing_count}}
ตั้งค่าไม่ครบ: {{configuration_missing_count}}

{{one_line_per_channel}}

Highlights:
{{evidence_backed_highlights_or_none}}

Recommendations:
{{evidence_backed_recommendations_or_data_readiness_only}}

Data status: {{overall_coverage_state}}
```

---

# 7. Severity, eligibility, dedupe and cooldown

## 7.1 Deterministic severity

AI does not choose severity freely

```text
critical
- validation_failed affecting an otherwise enabled/previously healthy channel
- stale or conflicting Report identity that blocks Executive output

warning
- report_partial
- source_unavailable
- configuration_missing
- expected Report missing after its approved materialization deadline

info
- report_available
- no_data_confirmed
- not_observed before source activation
- report_missing before source activation
```

## 7.2 Notification eligibility

Global prerequisites:

```text
preview_mode=false
MKT_Report_Settings.ai_enabled=true
MKT_Report_Settings.notification_enabled=true
verified non-empty group_id
Lark Automation enabled by separate approval
```

Channel-only message default:

- eligible for `report_available` or approved `report_partial`;
- not eligible for `report_missing`, `configuration_missing`, `not_observed` or `source_unavailable` unless a separately approved data-quality alert rule exists.

Executive digest:

- may be eligible when at least one channel has a validated Report;
- must include all missing channels in the same message;
- must not suppress the digest merely because some channels lack data.

## 7.3 Dedupe key

```text
customer_key
+ destination key hash
+ scope_type
+ window_days
+ period_start
+ period_end
+ sorted source report checksums
+ sorted channel readiness vector
+ template_version
+ language
```

Same key cannot send twice

## 7.4 Cooldown

```text
info       24 hours
warning     6 hours
critical    1 hour
```

A changed Report checksum, changed readiness vector or severity escalation creates a new candidate; unchanged payload remains deduped

---

# 8. AI readiness matrix

## 8.1 Current channel readiness from Base

| Channel | 1D | 3D | 7D | 30D | Preview behavior now |
|---|---|---|---|---|---|
| TikTok Organic | partial | partial | partial | partial | show 11 available metrics, 6 N/A baseline metrics |
| Facebook Organic | missing | missing | missing | missing | show `ยังไม่มีข้อมูล Report สำหรับช่วงนี้` |
| Instagram Organic | missing | missing | missing | missing | show `ยังไม่มีข้อมูล Report สำหรับช่วงนี้` |
| YouTube Organic | missing | missing | missing | missing | show `ยังไม่มีข้อมูล Report สำหรับช่วงนี้` |
| Meta Ads | missing | missing | missing | missing | show `ยังไม่มีข้อมูล Report สำหรับช่วงนี้` |
| Google Ads | missing | missing | missing | missing | show `ยังไม่มีข้อมูล Report สำหรับช่วงนี้` |
| TikTok Ads | missing | missing | missing | missing | show `ยังไม่มีข้อมูล Report สำหรับช่วงนี้` |
| WooCommerce | missing | missing | missing | missing | show `ยังไม่มีข้อมูล Report สำหรับช่วงนี้` |
| Chatwoot | configuration missing | configuration missing | configuration missing | configuration missing | show `ยังไม่ได้ตั้งค่า Report สำหรับช่องทางนี้` |

## 8.2 Dashboard readiness

| Dashboard | AI readiness | Rule |
|---|---|---|
| 📊 Executive Marketing Overview | ready for all-channel Preview after AI fields/prompts | display all nine channel states; summarize available evidence only |
| 🌱 Organic Performance | partial | TikTok populated; Facebook/Instagram/YouTube status rows required |
| 💰 Paid Ads Performance | no current Report rows | show Meta/Google/TikTok Ads as no data, not empty page |
| 🛒 Commerce & Conversion | no current Report rows | show WooCommerce no-data status until Report arrives |
| 💬 Customer Service & Leads | configuration missing | show Chatwoot configuration status until approved setting/materialization exists |
| 🛡️ Data Quality & Operations | supporting evidence | feeds readiness/severity; not a source for marketing metric calculation |

---

# 9. Null/N/A and all-channel test cases

1. Metric `0`, available → display `0`; AI may state observed zero.
2. Metric `null`, baseline incomplete → display N/A; AI must not state zero or decline.
3. Report partial with 11 known and 6 unknown → summarize known metrics and name six N/A fields.
4. Setting exists, Report absent → channel row `report_missing`; no metric JSON fabricated.
5. Channel setting absent → `configuration_missing`; no fallback to another channel.
6. `no_data_confirmed` → explain verified empty period; do not create zero metric set.
7. `source_unavailable` → no business insight/recommendation.
8. One channel validation fails → channel blocked; Executive still lists it and does not use its metrics.
9. Duplicate exact Report identity with different checksum → fail closed `validation_failed`.
10. Executive with TikTok only → `partial_coverage`; list all eight remaining channel gaps.
11. All channels missing → `no_reports_available`; produce readiness report, not performance claims.
12. Existing zero plus another channel missing → do not merge their meanings.
13. Money from different currencies → no cross-channel total.
14. Preview mode → notification eligibility false regardless of setting.
15. Same readiness vector/checksums → dedupe prevents repeat send.

---

# 10. All-channel Golden Dataset Preview plan

TikTok Organic is the positive fixture; every other channel is an explicit readiness fixture

For each `1D`, `3D`, `7D`, `30D`:

```text
1 TikTok channel row          report_partial
7 configured channel rows    report_missing
1 Chatwoot channel row        configuration_missing
1 Executive row               partial_coverage
```

Expected total:

```text
4 windows × 10 rows = 40 Preview rows
notifications sent = 0
```

Assertions:

- TikTok row binds exact Report snapshot and 17 metrics;
- 11 values remain available;
- 6 baseline metrics remain N/A;
- missing channels are visible and ordered consistently;
- Executive names every channel;
- no absent channel contributes zero or Recommendation;
- repeated Preview produces identical `ai_run_key`, checksum and zero duplicate rows;
- `sent_to_group=false`, `sent_at=null`, `notification_eligible=false` for all Preview rows.

---

# 11. Exact Lark changes to Apply later

## Phase A — schema/option Preview only

1. Reuse `🧠 MKT_AI_Report_Runs`;
2. add fields listed in section 5.1;
3. add `woocommerce` and `chatwoot` to AI `platforms` options;
4. add `dashboard_channel_status` and `dashboard_executive_summary` report types;
5. preserve all existing fields/views;
6. create Views:

```text
🌐 All Channel Readiness
📊 Executive Summaries
⚠️ Missing / Partial Data
✅ Notification Eligible
❌ AI Generation Failures
🧪 Preview Runs
```

7. do not create Automation yet.

## Phase B — Lark Native AI prompt binding

Bind existing output fields to the templates in section 6 using Lark Native AI only

No external endpoint, Worker or provider binding

## Phase C — all-channel Preview

Generate and verify 40 rows from the current Base state

## Phase D — Notification log

Create `MKT_Notification_Log` only after Preview is stable

## Phase E — disabled Automations

Create but keep disabled:

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

Schedule and send remain disabled until separate activation approval

---

# 12. Activation sequence per channel

A channel transitions independently:

```text
configuration_missing
→ report_missing
→ report_partial or report_available
→ AI Preview pass
→ notification preview pass
→ eligible for separately approved activation
```

No channel waits for every other channel to be complete before its data can appear

Executive summary is always rebuilt from the full channel registry and latest status vector

Recommended activation order follows Report readiness, not hardcoded platform priority:

1. channels already materialized;
2. channels with validated source and pending Report materialization;
3. channels waiting for source/UAT;
4. Executive notification after at least one channel is valid and all missing states render correctly.

---

# 13. Definition of Done

Design/Preview DoD:

- Exact Base inventory recorded;
- no duplicate AI/Settings table proposed;
- every expected channel appears in all four windows;
- available Report values display;
- absent Report displays truthful no-data/readiness message;
- null/N/A and observed zero remain distinct;
- Executive lists all channels;
- Lark Native AI uses Report output only;
- Preview is idempotent;
- notification send count remains zero;
- Automations and schedules remain disabled;
- no Remote D1/Queue/Worker/Provider/Production mutation;
- Repository gates pass on exact Head.

Live activation is not part of this DoD

---

# 14. Branch/file collision analysis

This branch owns only:

```text
docs/tasks/lark-native-ai-notification-v1.md
docs/project-brain/lark-native-ai-notification.md
```

It does not own:

- `docs/current-task.md`;
- root `PROJECT_BRAIN.md` while Meta/current workstreams own shared documentation;
- Report materializer, adapter, settings seed or Lark writer files;
- Meta continuation or retained evidence;
- channel connector files;
- Lark Dashboard frozen fields/layout.

Future implementation must allocate ownership before touching shared schema/config files

---

# 15. Implementation phases while Live notification remains disabled

```text
Phase 0  Design correction and exact Base inventory
Phase 1  Additive AI table schema/options Preview
Phase 2  Lark Native AI prompt setup with no Automation
Phase 3  All-channel 40-row Preview using current Base
Phase 4  Null/N/A, evidence, dedupe and replay verification
Phase 5  Notification log schema Preview
Phase 6  Create Automations disabled
Phase 7  Notification payload Preview with zero send
Phase 8  Per-channel activation review
Phase 9  Separate explicit authorization for Group send
Phase 10 Production cutover separately
```

## Safety result

```text
Lark Group notification   DISABLED
Automation schedule       DISABLED
Production                BLOCKED
Remote Lark write         0
Remote D1                 0
Queue/DLQ                 0
Worker deployment         0
Provider replay           0
Meta retained evidence    untouched
```
