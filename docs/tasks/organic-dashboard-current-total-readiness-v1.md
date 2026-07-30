# Organic Dashboard Current Totals & Data Readiness v1

## User-visible incident

Lark `MKT_Report_Metric_Values` มี Report 1D/3D/7D/30D ครบ แต่ Organic Period KPI
Views/Likes/Comments/Shares/Engagement/Engagement rate เป็นช่องว่าง เพราะ Materialization เป็น
`partial` และมี Content เก่าที่ไม่มี Snapshot ก่อนวันเริ่มช่วง.

ช่องว่างนี้ไม่ใช่ข้อมูลถูกลบ และห้ามแก้ด้วย `0` หรือยอดบางส่วน เพราะ PR #255 ล็อกไว้แล้วว่า
Aggregate Period delta ต้องเป็น `null` เมื่อ Baseline ไม่ครอบคลุมทั้งหมด.

## Objective

ทำให้ Dashboard ใช้งานได้ระหว่างรอ Historical baseline จริง โดยแยก Metric เป็นสามกลุ่มกลาง:

```text
period_delta   ค่าที่เพิ่มขึ้นในช่วง; null/N/A เมื่อ Baseline ยังไม่ครบ
current_total  ยอดสะสมล่าสุดจาก Current state ที่สังเกตได้จริง
 data_quality  Coverage และจำนวน Content ที่พร้อม/ขาด Baseline
```

ชื่อ `data_quality` ใน Contract ไม่มีช่องว่างนำหน้า; การจัดย่อหน้าด้านบนเป็นเพียงเอกสาร.

## Metric contract

Organic Materialization มี 17 Client-visible metrics:

```text
Period delta (6)
- period_views
- period_likes
- period_comments
- period_shares
- period_engagement
- period_engagement_rate

Current total (6)
- latest_total_views
- latest_total_likes
- latest_total_comments
- latest_total_shares
- latest_total_engagement
- latest_engagement_rate

Data readiness (5)
- new_content_count
- tracked_content_count
- baseline_covered_content_count
- baseline_missing_content_count
- baseline_coverage_rate
```

Period keys เดิมและ Report Stable IDs ไม่เปลี่ยน. Current totals อ่านจาก latest observed cumulative
state เท่านั้น ไม่สร้าง Synthetic Daily history. Missing metric ยังคง `null`; observed zero ยังคง `0`.

## Availability contract

ทุก Metric row มี metadata:

```text
metric_scope
availability_status
availability_message
```

สถานะที่อนุมัติ:

```text
available             พร้อมใช้งาน
baseline_incomplete   N/A — Baseline ยังไม่ครบ
source_unavailable    N/A — แหล่งข้อมูลยังไม่พร้อม
not_observed          N/A — ยังไม่มีข้อมูลสังเกตการณ์
```

`current_value` คงเป็น Number/null เท่านั้น. ข้อความ N/A อยู่ใน Field แยกเพื่อไม่ทำลายการคำนวณ,
Sort, Chart หรือ AI contract.

## Lark schema

เพิ่มแบบ Additive-only เฉพาะ `MKT_Report_Metric_Values`:

```text
metric_scope          SingleSelect
availability_status   SingleSelect
availability_message  Text
```

ไม่มี Rename/Delete/Type mutation และ Stable key ยังคง
`report_id::metric_key::summary::all`.

## Native Dashboard layout contract

`🌱 Organic Performance` ใช้ Source View เดิม `🧭 Dashboard Metrics` และแบ่งส่วนใน Lark UI:

1. Current totals — Filter `metric_scope=current_total` และ `availability_status=available`.
2. Period performance — Filter `metric_scope=period_delta`; Number card ใช้เฉพาะ available และ
   แสดงตาราง/ข้อความ N/A สำหรับ unavailable.
3. Data readiness — Filter `metric_scope=data_quality` พร้อม Coverage และ Missing Baseline count.
4. Top Content — ใช้ `🧭 Dashboard Top Content` ตามเดิม.

Public Lark Base API ยังไม่มี documented mutation สำหรับ Chart/Filter/Layout รายชิ้น จึงสร้างหรือ
จัด Chart หนึ่งครั้งใน Lark UI และใช้ Repository contract/audit ตรวจ identity ต่อไป. ห้ามเดา Private API.

## Repository phase safety

```text
Remote Lark/D1 mutation   none
Worker deployment         none
Queue/DLQ send            none
Provider call             none
Schedule/AI               disabled
Production                blocked
```

## Post-merge operational phase

หลัง Schema Preview/Apply แบบ confirmation-gated ต้อง refresh exact stable 1D/3D/7D/30D ผ่าน
Shared Report Queue/D1/Lark path เดิม. ห้ามแก้ Records ด้วยมือและห้ามใช้ Evidence directory เดิม.
Live closeout ต้องพิสูจน์:

```text
17 exact metric keys per window
D1/Lark mismatch = 0
Stable report IDs unchanged
Period null semantics preserved
Current totals finite when observed
Availability metadata complete
same-job replay idempotent
Worker restored all-false after every window
```
