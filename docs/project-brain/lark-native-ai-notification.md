# Lark Native AI & Notification Readiness

## Current status

```text
CONTRACT_VERSION                    = report_to_lark_ai_v1
WORKSTREAM                          = LARK_NATIVE_AI_NOTIFICATION_READINESS_V1
BRANCH                              = design/lark-native-ai-notification-v1
BASE_MAIN_SHA                       = 1c15195dab950cf9e8eca367b56f3d7488711bb7
DESIGN_STATUS                       = CORRECTED_ALL_CHANNEL_COMPLETE
IMPLEMENTATION_STATUS               = NOT_STARTED
BASE_READBACK                       = COMPLETE_FROM_SOCIAL_MKT_DATA_HUB_14
CHANNEL_SCOPE                       = ALL_EXPECTED_CHANNELS_EVERY_WINDOW
TIKTOK_GOLDEN_DATASET_ROLE          = POSITIVE_FIXTURE_ONLY
LARK_NATIVE_AI                      = NOT_CONFIGURED
LARK_AUTOMATION                     = ABSENT_IN_BASE
LARK_AUTOMATION_SCHEDULE            = DISABLED
LARK_GROUP_NOTIFICATION             = DISABLED
REMOTE_LARK_ACTIONS                 = 0
REMOTE_D1_ACTIONS                   = 0
QUEUE_DLQ_ACTIONS                   = 0
WORKER_PROVIDER_ACTIONS             = 0
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/lark-native-ai-notification-v1.md
```

## Corrected permanent rule

AI Preview ไม่ใช่ TikTok-only

ทุก window `1/3/7/30` ต้องแสดงทุก expected channel:

```text
มี validated Report
→ แสดงค่าที่มีจริงและสร้าง AI output ตาม Coverage

ไม่มี validated Report
→ แสดง “ยังไม่มีข้อมูล” พร้อมสาเหตุ
→ ห้ามซ่อนช่องทาง
→ ห้ามใช้ 0 แทนข้อมูลที่ไม่มี

Executive summary
→ แสดงสถานะครบทุกช่องทาง
→ ใช้ Highlight/Recommendation เฉพาะหลักฐานที่มีจริง
```

TikTok Organic เป็น Golden Dataset สำหรับ Positive path เท่านั้น ช่องทางที่ยังไม่เสร็จเป็น required readiness/no-data path ใน Preview เดียวกัน

## Exact Base evidence

Audited artifact:

```text
Social MKT Data Hub(14).base
SHA-256 6dab2da7a8184d65c9e257747aa65ef3717f8d015b44214e199ddaebd165d128
Physical tables 72
Native dashboards 6
Automations 0
```

### Existing AI table

```text
🧠 MKT_AI_Report_Runs
records = 0
```

Existing fields include:

```text
report_id
platforms
report_type
period/comparison fields
metric_summary_json
insight_summary
strengths
weaknesses
recommendations
sent_to_group
sent_at
```

This table is the v1 AI output table. Do not create `MKT_AI_Briefs` or another summary table

### Existing settings

```text
⚙️ MKT_Report_Settings
records = 68
enabled true = 66
ai_enabled true = 0
notification_enabled true = 0
```

Relevant existing configuration:

```text
platforms
window_days
ai_enabled
notification_enabled
group_id
language
send_time
send_weekday
timezone
```

Use this table as the v1 AI/Notification setting authority. Do not create duplicate Settings or Destination tables

### Current Report output

```text
MKT_Report_Snapshots       13
MKT_Report_Metric_Values   86
MKT_Report_Top_Content     20
MKT_Report_Top_Ads          0
```

Dashboard Report rows currently exist only for TikTok Organic:

```text
1D / 3D / 7D / 30D
17 metrics per window
11 available
6 baseline_incomplete / N/A
```

All other expected channels currently have no Dashboard Report rows in this Base snapshot

## Expected channel registry

```text
tiktok_organic
facebook_organic
instagram_organic
youtube_organic
meta_ads
google_ads
tiktok_ads
woocommerce
chatwoot
```

Current state:

```text
tiktok_organic   report_partial for 1/3/7/30
facebook         report_missing
instagram        report_missing
youtube          report_missing
meta_ads         report_missing
google_ads       report_missing
tiktok_ads       report_missing
woocommerce      report_missing
chatwoot         configuration_missing + report_missing
```

Chatwoot is absent from current `MKT_Report_Settings.platforms` options and has no setting rows. That gap belongs to the Report/Metric Matrix workstream; AI must surface `configuration_missing` until approved configuration exists

## Frozen input authority

Allowed:

```text
MKT_Report_Snapshots
MKT_Report_Metric_Values
MKT_Report_Top_Content
MKT_Report_Top_Ads
```

Forbidden:

- Raw/Canonical/Daily detail reads;
- Detailed D1 reads;
- AI metric calculation;
- external AI provider/API;
- custom model runtime;
- AI Worker/Queue;
- null/N/A to zero conversion;
- omission of missing channels.

## Readiness contract

Controlled states:

```text
report_available
report_partial
no_data_confirmed
source_unavailable
not_observed
report_missing
configuration_missing
validation_failed
```

Required truthful messages:

```text
report_missing         ยังไม่มีข้อมูล Report สำหรับช่วงนี้
configuration_missing  ยังไม่ได้ตั้งค่า Report สำหรับช่องทางนี้
no_data_confirmed      ตรวจสอบแล้ว แต่ไม่มีข้อมูลในช่วงนี้
source_unavailable     แหล่งข้อมูลยังไม่พร้อม
not_observed           ยังไม่มีข้อมูลสังเกตการณ์
report_partial         มีข้อมูลบางส่วน ยังไม่ครบ
```

Observed zero remains `0`; missing/unsupported/baseline-incomplete remains `null/N/A`

## Preview grain

Per window:

```text
9 channel AI rows
1 executive AI row
```

All-channel Preview total:

```text
4 windows × 10 rows = 40 rows
```

Current Base expected Preview:

```text
TikTok Organic       partial with real metrics
7 channels           report_missing
Chatwoot             configuration_missing
Executive            partial_coverage
Notification sends   0
```

## Lark object decisions

Reuse:

```text
MKT_AI_Report_Runs
MKT_Report_Settings
MKT_Report_Snapshots
MKT_Report_Metric_Values
MKT_Report_Top_Content
MKT_Report_Top_Ads
```

Additive extensions to `MKT_AI_Report_Runs` are required for stable key, channel/scope, readiness, status, evidence checksum, severity, notification eligibility, dedupe, cooldown, preview and generation result

Option extensions:

```text
platforms add woocommerce, chatwoot
report_type add dashboard_channel_status, dashboard_executive_summary
```

Create only after AI Preview passes:

```text
MKT_Notification_Log
```

Do not create a destination table in v1; reuse verified `group_id` in `MKT_Report_Settings`

Base snapshot contains no Automation. Future Automations must be created disabled and activated separately

## Notification rule

Executive digest may send when at least one channel has a validated Report and settings are enabled. It must still list every channel that has no data

Channel-only no-data rows are not notification eligible by default

All sends require:

```text
preview_mode=false
ai_enabled=true
notification_enabled=true
verified group_id
dedupe pass
cooldown pass
separate activation approval
```

## Activation sequence

Each channel transitions independently:

```text
configuration_missing
→ report_missing
→ report_partial/report_available
→ AI Preview pass
→ notification preview pass
→ separate Live activation
```

A completed channel appears immediately; it does not wait for all other channels. Executive output always uses the complete channel registry and current status vector

## Safety boundary

```text
Lark Group notification disabled
Automation schedule disabled
Production blocked
Remote Lark write 0
Remote D1 action 0
Queue/DLQ action 0
Worker deployment 0
Provider replay 0
Meta retained evidence untouched
```
