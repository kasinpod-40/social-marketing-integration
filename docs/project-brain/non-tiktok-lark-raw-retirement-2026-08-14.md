# Non-TikTok Lark RAW Retirement — 2026-08-14

## Decision

Lark Base ของลูกค้าเก็บเฉพาะตารางที่ผู้ใช้ต้องดูหรือใช้กับ Dashboard, Report, AI,
Notification และการจัดการข้อมูลทางธุรกิจ. Source facts/history ของ Connector ที่ระบบดึงผ่าน API
ต้องเก็บใน D1 เท่านั้น. ไม่มี runtime switch สำหรับเปิด Lark RAW mirror กลับมา.

ข้อยกเว้นเดียวคือ `RAW_TikTok_Creator_Videos` เพราะเป็น Lark Native source ที่ Worker อ่านแบบ
read-only; ห้าม Worker เปลี่ยน Table, Field, View หรือ Record.

## Runtime contract

```text
API Provider → normalize → D1 source facts/history/coverage → Lark MKT_*/Report
Lark Native TikTok RAW → read-only normalize → D1 → Lark MKT_*/Report
```

- Meta Organic เขียน Lark เฉพาะ `MKT_Accounts`, `MKT_Content`, `MKT_Content_Daily` และ
  `MKT_Account_Daily` ตาม job contract.
- Paid Ads เขียน Lark เฉพาะ Canonical Ads tables และ `MKT_Ads_Daily`.
- YouTube Owner Analytics period facts ใช้ D1 table `youtube_analytics_daily_facts`; signed Provider
  adjustments และ `average_view_percentage > 100` ต้องคงค่าเดิม.
- WooCommerce เขียน Lark เฉพาะห้า Commerce MKT tables.
- Chatwoot เขียน Lark เฉพาะห้า Conversation MKT/daily tables.
- Schema installer, preflight และ auto-mapping ต้องไม่สร้างหรือบังคับ mapping ของ non-TikTok RAW.

## Exact retirement inventory

ตารางต่อไปนี้รวม 27 ตารางเป็น legacy Integration Base cleanup scope เท่านั้น:

### Meta Organic / shared Ads — 5

```text
RAW_Meta_Organic_Accounts
RAW_Meta_Organic_Content
RAW_Meta_Organic_Metrics
RAW_Ads_Entities
RAW_Ads_Daily
```

### YouTube — 3

```text
RAW_YouTube_Channels
RAW_YouTube_Videos
RAW_YouTube_Analytics_Daily
```

### WooCommerce — 9

```text
RAW_Commerce_Stores
RAW_Commerce_Orders
RAW_Commerce_Order_Items
RAW_Commerce_Products
RAW_Commerce_Product_Variations
RAW_Commerce_Categories
RAW_Commerce_Customers
RAW_Commerce_Coupons
RAW_Commerce_Refunds
```

### Chatwoot — 10

```text
RAW_Chatwoot_Accounts
RAW_Chatwoot_Inboxes
RAW_Chatwoot_Contacts
RAW_Chatwoot_Agents
RAW_Chatwoot_Teams
RAW_Chatwoot_Labels
RAW_Chatwoot_Conversations
RAW_Chatwoot_Conversation_Labels
RAW_Chatwoot_Message_Analytics
RAW_Chatwoot_Reporting_Events
```

Provider-specific Google Ads RAW tablesที่ไม่ได้อยู่ใน active signed-delivery write contract เป็น legacy
forensic/inventory แยกต่างหาก; ห้ามรวมลบจากชื่อหรือ prefix โดยอนุมาน ต้องมี exact identity audit ก่อนเสมอ.

## Safe rollout and deletion gate

Repository change นี้ไม่อนุญาตให้ลบ Live table, deploy หรือรบกวน Work ที่กำลัง active. การลบ 27 ตาราง
ต้องทำตามลำดับนี้:

1. อ่าน exact Table ID, record count, field/view inventory และ consumer references แบบ read-only.
2. Export/backup แต่ละตารางพร้อม checksum และ exact stable-key list.
3. Apply D1 migration `0020_youtube_analytics_daily_facts.sql`.
4. รัน fresh YouTube Owner Analytics catch-up ให้ D1 period facts ครบ แล้วตรวจ stable-key parity กับ
   legacy `RAW_YouTube_Analytics_Daily` ก่อนลบ.
5. Deploy reviewed runtime ที่ไม่มี non-TikTok RAW writers และรอ fresh scheduled cycle ของแต่ละ Connector.
6. ตรวจ D1 coverage/checkpoint, MKT/Report parity, zero new alert/DLQ และพิสูจน์ zero active consumer
   ของทั้ง 27 ตาราง.
7. ลบทีละ exact Table ID; หลังแต่ละรายการต้อง list/readback ว่าหายเฉพาะเป้าหมาย และ TikTok Native
   ยังอยู่ครบ.
8. เก็บ backup, checksums, pre/post inventories และ deletion evidence ใน rollout artifact.

ห้าม prefix delete, bulk delete, ลบระหว่าง Chatwoot/Facebook Work active หรือใช้จำนวนแถวเท่ากันแทน
stable-key parity.

## Acceptance

- ทุก active Lark write/preflight/schema contract ไม่มี non-TikTok RAW target.
- D1 ยังคง source/history/coverage และ Canonical/Report output ไม่ลดลง.
- YouTube Analytics D1 replay เป็น idempotent และ older fetch ห้ามทับ newer fact.
- TikTok Native RAW read-only contract ไม่เปลี่ยน.
- Focused tests, full test, report reliability, architecture/hygiene, audit, deploy dry-run และ diff check ผ่าน.
- Live deletion จะถือว่าเสร็จเฉพาะหลัง rollout gate ข้างต้นผ่านและมี exact evidence; repository-only change
  ไม่ใช่หลักฐานว่าตาราง Live ถูกลบแล้ว.

## Live rollout evidence — 2026-08-14

```text
MERGED_MAIN_SHA                    = ffb537958f406f5c44cedc109c657c5f198739d2
ACTIVE_WORKER_VERSION              = 7754be21-8be3-43b3-a537-9dc858b6f5b7_100_PERCENT
D1_BACKUP                          = PASS_129_MIB_SHA256_7A828BF0
LARK_PRIVATE_BACKUP                = PASS_27_TABLES_20072_RECORDS
LARK_MANIFEST_SHA256               = 29CC5C19
D1_MIGRATION_0020                  = APPLIED
YOUTUBE_FRESH_CATCHUP              = PASS_EXACTLY_ONCE_20260804_20260811
YOUTUBE_ANALYTICS_SCOPE            = 837_SELECTED_837_QUERIED_0_FAILED
YOUTUBE_ANALYTICS_FACTS            = 2532_DISTINCT_KEYS
D1_LEGACY_LARK_KEY_PARITY          = PASS_2532_OF_2532_SHA256_EQUAL
NEW_YOUTUBE_ALERT_DLQ              = 0_0
LARK_ZERO_CONSUMER_AUDIT           = PASS_46_TABLES_931_FIELDS_139_VIEWS_0_WORKFLOWS
LIVE_TABLE_DELETION                = PASS_EXACT_27_OF_27_20260816
POST_DELETE_TIKTOK_PROTECTED       = PASS_PRESENT_EXACT_IDENTITY
POST_DELETE_NON_TARGET_TABLES      = PASS_UNCHANGED
```

Backup เก็บใน private local rollout directory ด้วย permission `0700/0600` และไม่ commit เนื้อหา Records,
Table IDs หรือ customer data เข้า Repository. Fresh catch-up ไม่ replay/redrive retained Work เก่า.
Static runtime contract และ Lark metadata/automation audit ผ่านแล้ว; controlled YouTube catch-up ไม่ถูกนับ
แทน scheduled evidence.

## Live deletion closeout — 2026-08-16

Fresh scheduled cycles หลัง reviewed Worker version `808fe569-8319-469b-b069-2b586642e630` ผ่านครบ
สำหรับ WooCommerce, Instagram, Meta/shared Ads, YouTube, Chatwoot และ Facebook. Facebook exact operation
`facebook-scheduled-20260815` จบ `completed`; Coverage `complete/full_inventory` 89/89, failed 0 และ
D1↔Lark current MKT identity/metric parity 89/89. `MKT_Content_Daily` readback หลัง operation มี 9,139
records จากเพดาน 10,000, unmanaged 0 และ retention delete candidate 0.

ก่อน deletion ได้ตรวจซ้ำว่า backup ทั้ง 27 files ตรง checksum, D1 backup checksum ตรง, YouTube D1
2,532 keys ตรงกับ legacy backup 2,532 keys และ SHA-256 เท่ากัน. Consumer audit รอบสุดท้ายตรวจ 46
non-target tables, 931 fields, 139 hydrated views และ workflow inventory โดย target reference เป็น 0.
Active locks, current alert และ current DLQ เป็น 0; Meta Ads A22 เป็น retained forensic identity เดิมและ
ไม่มี lock.

Exact operator ลบ 27 tables ทีละ exact Table ID ตามลำดับใน manifest และตรวจ readback หลังทุก delete.
ผลสุดท้าย `deletedCount=27`, protected `RAW_TikTok_Creator_Videos` ยังอยู่ exact identity เดิม และ
non-target Table IDs/names ไม่เปลี่ยน. ไม่มี prefix/bulk delete, replay, redrive, manual Queue run หรือ
Worker deploy. Private deletion evidence อยู่ที่ rollout artifact เดิมและไม่ commit customer records,
Table IDs หรือ credentials เข้า Repository.
