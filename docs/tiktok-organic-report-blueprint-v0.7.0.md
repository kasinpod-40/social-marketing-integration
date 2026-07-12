# TikTok Organic Metrics + Report Blueprint v0.7.0

## 1. เป้าหมาย

เปลี่ยนข้อมูลสะสมรายคลิปจาก `MKT_Content` และ `MKT_Content_Daily` ให้เป็นรายงาน Daily/Weekly ที่ลูกค้าอ่านได้ โดยลูกค้าไม่ต้องเปิดตาราง RAW, Daily snapshot, Sync Log, Lock หรือ Alert ทางเทคนิค

Flow ที่ใช้จริง:

```text
RAW_TikTok_Creator_Videos
  -> MKT_Content / MKT_Content_Daily
  -> TikTok Organic Report Engine
  -> MKT_Report_Snapshots
  -> MKT_Report_Metric_Values
  -> MKT_Report_Top_Content
  -> Client-facing views
  -> Lark AI / Group notification (ข้อ 8)
```

## 2. Metric semantics

`MKT_Content_Daily` เป็น cumulative snapshot ต่อคลิปต่อวัน ห้ามบวกยอดข้ามวันโดยตรง

Metric แบบช่วงเวลาใช้:

```text
period_delta = latest_snapshot_on_or_before_period_end - latest_snapshot_before_period_start
```

กฎ Baseline:

- คลิปที่เผยแพร่ในช่วงรายงานและไม่มี Baseline ใช้ Baseline = 0
- คลิปเก่าที่ไม่มี Snapshot ก่อนเริ่มช่วง ใช้ Snapshot แรกในช่วงเป็น Partial baseline และรายงานต้องติด `data_status=partial`
- ค่าแก้ย้อนหลังจาก Platform สามารถติดลบได้ ห้ามบังคับเป็นศูนย์
- Average watch time และ Completion rate ใช้ weighted average จากยอด Views ล่าสุด ไม่เฉลี่ยตรง ๆ
- TikTok `unique_viewers` ไม่ใช่ Account reach และไม่ใช้เทียบข้าม Platform อัตโนมัติ

## 3. Stable keys

- `report_setting_key = customer_profile:platform:period_type`
- `report_id = report_type::customer_profile::account_id::period_start::period_end::comparison_mode::compare_start::compare_end::platforms::course`
- `report_metric_key = report_id::metric_key::dimension_type::dimension_value`
- `report_content_key = report_id::rank:N` เพื่อให้ Rerun เขียนทับอันดับเดิมและไม่ทิ้งแถวอันดับเก่า

ทุก Key ต้องเป็น Text และใช้ Upsert เพื่อให้ Queue Retry/Scheduled duplicate ไม่สร้างแถวซ้ำ

Top Content สร้าง Fixed slot ตาม `top_content_limit`; slot ที่ไม่มีข้อมูลใช้ `data_status=no_data` และ Client View ต้องกรองออก. ระบบเขียนค่าทดแทนที่ชัดเจนแทน null เพื่อไม่ให้ Lark คงค่าของอันดับเก่าไว้.

## 4. ตารางที่ต้องปรับ

### 4.1 MKT_Metric_Definitions

Field เดิมที่คงไว้:

- metric_key
- platform
- raw_field_name
- display_name
- formula
- unit
- can_compare_cross_platform
- fallback_metric
- metric_note

Field ที่เพิ่ม:

| field | type | required | purpose |
|---|---|---:|---|
| enabled | Checkbox | yes | เปิด/ปิด Metric โดยไม่แก้โค้ด |
| metric_scope | SingleSelect | yes | `content_snapshot`, `content_period`, `account_period`, `report_quality` |
| source_table | SingleSelect | yes | `MKT_Content`, `MKT_Content_Daily`, `derived` |
| aggregation_method | SingleSelect | yes | `sum_delta`, `sum_latest`, `count_distinct`, `weighted_average_latest`, `derived_rate`, `coverage_ratio` |
| null_policy | SingleSelect | yes | `exclude`, `zero`, `preserve_null` |
| higher_is_better | Checkbox | no | ใช้กำหนดทิศทางสี/คำอธิบาย |
| decimal_places | Number | yes | จำนวนตำแหน่งทศนิยมสำหรับแสดงผล |
| formula_version | Text | yes | Version ของสูตร เช่น `tiktok-organic-v1` |
| client_visible | Checkbox | yes | แสดงใน Client view หรือไม่ |
| sort_order | Number | yes | ลำดับ Metric ในรายงาน |

Primary field ที่แนะนำ: `metric_key`

### 4.2 MKT_Report_Settings

| field | type | required | example |
|---|---|---:|---|
| report_setting_key | Text (Primary) | yes | `dev_ft_pumkin:tiktok:daily` |
| customer_profile | Text | yes | `dev_ft_pumkin` |
| report_name | Text | yes | `TikTok Daily Organic` |
| report_type | SingleSelect | yes | `daily_organic_report` |
| period_type | SingleSelect | yes | `daily` |
| platforms | MultiSelect | yes | `tiktok` |
| account_keys_json | Text | yes | `["ft_pumkin"]` |
| timezone | Text | yes | `Asia/Bangkok` |
| utc_offset | Text | yes | `+07:00` |
| send_time | Text | yes | `08:10` |
| send_weekday | SingleSelect | no | `monday` |
| comparison_mode | SingleSelect | yes | `previous_period` |
| language | SingleSelect | yes | `th` |
| top_content_limit | Number | yes | `5` |
| ai_enabled | Checkbox | yes | `false` |
| notification_enabled | Checkbox | yes | `false` |
| group_id | Text | no | Lark group ID ของลูกค้า |
| enabled | Checkbox | yes | `true` |
| config_version | Text | yes | `report-v1` |

### 4.3 MKT_Report_Snapshots

Field เดิมคงไว้ และเพิ่ม:

| field | type | required |
|---|---|---:|
| report_setting_key | Text | yes |
| customer_profile | Text | yes |
| account_id | Text | yes |
| data_status | SingleSelect (`complete`, `partial`, `no_data`) | yes |
| formula_version | Text | yes |
| source_snapshot_count | Number | yes |
| baseline_coverage_rate | Number | no |

เพิ่ม `daily_organic_report` ใน `report_type` และแนะนำให้ตั้ง `report_id` เป็น Primary field

### 4.4 MKT_AI_Report_Runs

เพิ่ม `daily_organic_report` ใน `report_type` และเตรียม Field สำหรับข้อ 8:

- ai_run_id (Primary)
- report_setting_key
- model_provider
- model_name
- prompt_version
- status
- generated_at
- error_message

ยังไม่ใช้ AI ใน v0.7.0

## 5. ตารางใหม่

### 5.1 MKT_Report_Metric_Values

ตาราง Normalized สำหรับ Dashboard, Filter, Chart และ Lark AI

| field | type | required |
|---|---|---:|
| report_metric_key | Text (Primary) | yes |
| report_id | Text | yes |
| report_setting_key | Text | yes |
| customer_profile | Text | yes |
| report_type | SingleSelect | yes |
| platform | SingleSelect | yes |
| account_id | Text | yes |
| metric_key | Text | yes |
| display_name | Text | yes |
| current_value | Number | no |
| compare_value | Number | no |
| change_value | Number | no |
| change_percent | Number | no |
| unit | SingleSelect | yes |
| data_status | SingleSelect | yes |
| dimension_type | SingleSelect | yes |
| dimension_value | Text | no |
| rank | Number | no |
| period_start | DateTime | yes |
| period_end | DateTime | yes |
| compare_start | DateTime | no |
| compare_end | DateTime | no |
| generated_at | DateTime | yes |
| formula_version | Text | yes |
| source_snapshot_count | Number | yes |
| client_visible | Checkbox | yes |

### 5.2 MKT_Report_Top_Content

ตาราง Client-facing สำหรับดูคลิปเด่นโดยไม่เปิด JSON/Technical table

| field | type | required |
|---|---|---:|
| report_content_key | Text (Primary) | yes |
| report_id | Text | yes |
| report_setting_key | Text | yes |
| customer_profile | Text | yes |
| report_type | SingleSelect | yes |
| platform | SingleSelect | yes |
| account_id | Text | yes |
| rank | Number | yes |
| content_key | Text | yes |
| external_content_id | Text | yes |
| caption | Text | no |
| content_url | URL | no |
| thumbnail_url | URL | no |
| published_at | DateTime | no |
| period_views | Number | yes |
| period_likes | Number | yes |
| period_comments | Number | yes |
| period_shares | Number | yes |
| period_engagement | Number | yes |
| period_engagement_rate | Number | no |
| latest_total_views | Number | yes |
| performance_status | SingleSelect | yes |
| data_status | SingleSelect | yes |
| period_start | DateTime | yes |
| period_end | DateTime | yes |
| generated_at | DateTime | yes |

## 6. TikTok report metrics v1

| metric_key | aggregation | unit | client visible |
|---|---|---|---:|
| tiktok:period_views | sum_delta | count | yes |
| tiktok:period_likes | sum_delta | count | yes |
| tiktok:period_comments | sum_delta | count | yes |
| tiktok:period_shares | sum_delta | count | yes |
| tiktok:period_engagement | derived_rate inputs | count | yes |
| tiktok:period_engagement_rate | derived_rate | percent | yes |
| tiktok:new_content_count | count_distinct | count | yes |
| tiktok:tracked_content_count | count_distinct | count | no |
| tiktok:baseline_coverage_rate | coverage_ratio | percent | no |
| tiktok:latest_total_views | sum_latest | count | yes |
| tiktok:latest_total_engagement | sum_latest | count | yes |
| tiktok:latest_weighted_avg_watch_time_seconds | weighted_average_latest | seconds | yes |
| tiktok:latest_weighted_completion_rate | weighted_average_latest | percent | yes |

Formula version: `tiktok-organic-v1`

## 7. Client-facing views

ลูกค้าไม่ควรใช้ View ดิบของ RAW/Daily/Sync/Alerts

View ที่ต้องสร้าง:

1. `📊 ภาพรวม TikTok รายวัน` — MKT_Report_Metric_Values, filter `report_type=daily_organic_report`, `client_visible=true`
2. `📅 รายงาน TikTok รายสัปดาห์` — filter `report_type=weekly_organic_report`
3. `🏆 คลิปเด่น` — MKT_Report_Top_Content, sort `period_end desc`, `rank asc`
4. `📈 แนวโน้มยอดวิว` — Chart จาก Metric Values, filter `metric_key=tiktok:period_views`
5. `❤️ แนวโน้ม Engagement` — Chart จาก Metric Values, filter `metric_key=tiktok:period_engagement_rate`

Internal-only views:

- RAW tables
- MKT_Content_Daily
- MKT_Sync_Log
- MKT_System_Alerts
- MKT_Report_Snapshots JSON payload
- MKT_AI_Report_Runs technical fields

## 8. Retention/Rollup

v0.7.0 ยังไม่ลบ Daily records อัตโนมัติ เพราะต้องมี Archive target ที่ตรวจสอบได้ก่อน

Production policy เป้าหมาย:

- รายคลิปรายวันใน Lark: 90 วันล่าสุด
- Weekly rollup: 1 ปี
- Monthly rollup: ระยะยาว
- Operational history ระยะยาว: D1/PostgreSQL ตามขนาดระบบ

ห้ามเปิด Auto-delete ก่อนมี Export/Reconciliation/UAT ของ Archive flow

## 9. Definition of Done v0.7.0

- Blueprint และ Import template ผ่านการตรวจ
- Metric seed และ Report setting seed เป็น Idempotent
- Daily/Weekly report jobs ใช้ Queue + D1 distributed lock + Retry/DLQ
- Report snapshot, metric values และ top content Upsert ด้วย Stable key
- Daily report ใช้วันสมบูรณ์ล่าสุดตาม Asia/Bangkok
- Weekly report ใช้ 7 วันสมบูรณ์ล่าสุด
- No-data/Partial baseline ไม่ถูกแสดงเป็นข้อมูลสมบูรณ์
- Tests ครอบคลุม cumulative delta, new content baseline, partial baseline, negative correction, weighted average และ idempotency
- Live DEV UAT ไม่สร้างแถวซ้ำเมื่อรัน Job เดิมซ้ำ

## 10. ลำดับ Apply และ Live DEV UAT

1. เพิ่ม Field ใน `MKT_Metric_Definitions`, `MKT_Report_Settings`, `MKT_Report_Snapshots`.
2. ตั้ง `metric_key`, `report_setting_key`, `report_id` เป็น Primary field ตามลำดับ.
3. สร้าง `MKT_Report_Metric_Values` และ `MKT_Report_Top_Content` จาก Excel Blueprint.
4. ใส่ Table IDs ใหม่ใน `wrangler.sync.jsonc`; คง Report schedule flags เป็น `false`.
5. รัน `npm run check`, `npm test`, `npm run deploy:dry-run`.
6. Seed Metric definitions และ Report settings แล้วรันซ้ำเพื่อยืนยัน `created=0` ในรอบสอง.
7. Deploy Worker และส่ง Daily job แบบ Manual:

```json
{
  "schemaVersion": 1,
  "type": "report.daily.generate",
  "trigger": "manual_report_uat",
  "reportSettingKey": "dev_ft_pumkin:tiktok:daily",
  "periodEnd": "2026-07-12"
}
```

8. ส่ง Job เดิมซ้ำและตรวจว่า Snapshot 1 แถว, Metric 13 แถว และ Top Content ตาม fixed slots ไม่เพิ่มซ้ำ.
9. ส่ง Weekly job แบบ Manual และตรวจ Previous period, Partial baseline, Negative correction และ Weighted metrics.
10. สร้าง Client Views/สิทธิ์ แล้วจึงเปิด Daily/Weekly schedule.

```json
{
  "schemaVersion": 1,
  "type": "report.weekly.generate",
  "trigger": "manual_report_uat",
  "reportSettingKey": "dev_ft_pumkin:tiktok:weekly",
  "periodEnd": "2026-07-12"
}
```
