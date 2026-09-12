# คู่มือ Social MKT Data Hub สำหรับลูกค้า (ฉบับย่อ)

ระบบรับข้อมูลจากแต่ละช่องทาง เก็บประวัติหลักไว้ใน Cloudflare D1 แล้วส่งข้อมูลที่ใช้ดูงานไปยัง Lark Base

## อ่านวันที่ให้ถูก

- `metric_date` = วันที่ของข้อมูล โดยรอบรายวันทั่วไปใช้วันล่าสุดที่จบสมบูรณ์แล้ว
- `last_sync_at` = วันที่และเวลาที่ระบบเขียนข้อมูลปลายทางสำเร็จ จึงอาจใหม่กว่า `metric_date` 1 วัน
- `period_start` / `period_end` = ช่วงข้อมูลที่รายงานหรือสรุปใช้คำนวณ
- ค่า `0` คือแหล่งข้อมูลยืนยันว่าเป็นศูนย์ ส่วนข้อมูลที่ไม่มีหรือยังไม่พร้อมจะแสดงเป็นว่าง/`N/A`

## Dashboard

| Dashboard | ใช้ดูอะไร | เงื่อนไขสำคัญ |
|---|---|---|
| `📊 Executive Marketing Overview` | ภาพรวม Organic, Paid Ads, Commerce และ Customer Service | อ่านจากรายงานที่ระบบคำนวณและตรวจแล้ว ไม่รวมข้อมูลดิบโดยตรง |
| `🌱 Organic Performance` | ผลงาน Facebook, Instagram, TikTok และ YouTube เช่น Reach, Views, Engagement และ Top Content | ใช้วันที่ข้อมูลที่จบสมบูรณ์และแสดงสถานะความครบถ้วนของข้อมูล |
| `💰 Paid Ads Performance` | Spend, Impressions, Clicks, Conversions, ROAS และ Top Ads/Campaign | รวมเฉพาะบัญชีโฆษณาที่เชื่อมต่อและข้อมูลตามช่วงที่เลือก |
| `🛒 Commerce & Conversion` | ยอดขาย ออเดอร์ ลูกค้า สินค้า และ Conversion | แสดงข้อมูล WooCommerce ที่ผ่านการรวมยอดแล้ว |
| `💬 Customer Service & Leads` | Conversation, Agent, Inbox, Response และ Resolution | ใช้ข้อมูล Chatwoot ที่สร้างใหม่หรือมีการแก้ไขจริง |
| `🛡️ Data Quality & Operations` | ความสด ความครบถ้วน สถานะ Sync และ Alert | เป็นหน้าตรวจสุขภาพระบบสำหรับผู้ดูแล |

Dashboard ใช้ตัวกรอง Platform, Account และช่วงเวลาที่มีในหน้า โดยช่วงมาตรฐานของรายงานคือ `1D`, `3D`, `7D` และ `30D`.

## ตารางใน Lark Base

### Master Data

| Table | แสดงอะไร | เงื่อนไขสำคัญ |
|---|---|---|
| `MKT_Accounts` | บัญชี Social ที่เชื่อมต่อ ชื่อบัญชี Platform และเวลาซิงก์ล่าสุด | 1 แถวต่อบัญชี; `last_sync_at` อัปเดตหลังเขียนปลายทางสำเร็จ |
| `MKT_Account_Daily` | ตัวเลขรวมระดับบัญชีรายวัน | 1 แถวต่อบัญชีต่อวันที่ข้อมูล |
| `MKT_Metric_Definitions` | ความหมาย หน่วย และวิธีอ่านแต่ละ Metric | ใช้เป็นพจนานุกรมกลางของระบบ |
| `MKT_Classification_Dictionary` | กฎ/คำสำหรับจัดหมวดหมู่ Content หรือ Campaign | แก้ไขได้เฉพาะส่วนที่กำหนดสำหรับผู้ดูแล |

### Organic Social

| Table | แสดงอะไร | เงื่อนไขสำคัญ |
|---|---|---|
| `MKT_Content` | ข้อมูลล่าสุดของ Post/Video เช่น ชื่อ ลิงก์ วันที่เผยแพร่ และยอดล่าสุด | 1 แถวต่อ Content; ซิงก์ซ้ำเป็นการอัปเดต ไม่สร้างแถวซ้ำ |
| `MKT_Content_Daily` | Snapshot ตัวเลขของแต่ละ Content ในแต่ละวัน | เป้าหมายเก็บ 30 วันและไม่เกิน 10,000 แถว โดยเก็บแถวล่าสุดของแต่ละ Content ไว้; ประวัติเต็มยังอยู่ใน D1 |
| `RAW_TikTok_Creator_Videos` | แหล่งข้อมูล TikTok Native ที่เชื่อมกับ Lark | อ่านอย่างเดียว ห้ามแก้ schema หรือข้อมูลด้วยระบบ Sync |

### Paid Ads

| Table | แสดงอะไร | เงื่อนไขสำคัญ |
|---|---|---|
| `MKT_Ads_Accounts` | บัญชีโฆษณาและสถานะบัญชี | 1 แถวต่อบัญชีโฆษณา |
| `MKT_Ads_Campaigns` | Campaign และสถานะล่าสุด | 1 แถวต่อ Campaign |
| `MKT_Ads_AssetGroups` | Asset Group ของ Google Ads | มีข้อมูลเฉพาะประเภท Campaign ที่ใช้ Asset Group |
| `MKT_Ads_AdGroups` | Ad Group/Ad Set ภายใต้ Campaign | 1 แถวต่อกลุ่มโฆษณา |
| `MKT_Ads_Ads` | ตัวโฆษณาและสถานะล่าสุด | 1 แถวต่อ Ad |
| `MKT_Ads_Creatives` | Creative/ชิ้นงานโฆษณา | เก็บข้อมูลตัวชิ้นงาน ไม่ใช่ยอดรายวัน |
| `MKT_Ads_Daily` | Metric โฆษณารายวัน เช่น Spend, Impression, Click และ Conversion | Lark เก็บช่วงล่าสุดแบบ bounded cache; เป้าหมาย 90 วัน และ D1 เก็บประวัติเต็ม |
| `📊 MKT_Ads_Campaign_Summary` | สรุปผลระดับ Campaign แยกเดือน ตั้งแต่ 19 มิ.ย. 2569 | เดือนปัจจุบันเป็น MTD และอัปเดตรายวัน; เดือนปิดแล้วคงเดิม; มี Views Overview/Meta/Google/TikTok และไม่สร้าง duplicate |

### Commerce

| Table | แสดงอะไร | เงื่อนไขสำคัญ |
|---|---|---|
| `MKT_Commerce_Orders` | รายการออเดอร์และสถานะล่าสุด | 1 แถวต่อออเดอร์; ขอบเขตประวัติ Production เริ่มปี 2569 |
| `MKT_Commerce_Products` | สินค้าและสถานะล่าสุด | 1 แถวต่อสินค้า |
| `MKT_Commerce_Customers` | ลูกค้าและยอดสะสมที่ระบบอนุญาตให้แสดง | 1 แถวต่อลูกค้า; ไม่แสดง Secret/Credential |
| `MKT_Commerce_Daily` | ยอดขายและจำนวนออเดอร์รวมรายวัน | 1 แถวต่อร้าน/ช่องทางต่อวัน |
| `MKT_Commerce_Product_Daily` | ยอดขายระดับสินค้ารายวัน | 1 แถวต่อสินค้าต่อวัน |

### Customer Service

| Table | แสดงอะไร | เงื่อนไขสำคัญ |
|---|---|---|
| `MKT_Conversations` | สถานะล่าสุดของ Conversation จาก Chatwoot | อ่านเฉพาะรายการใหม่หรือรายการที่มี revision ใหม่กว่า D1 |
| `MKT_Conversation_Daily` | สถิติ Conversation รายวัน | สรุปตามวันที่และ Conversation |
| `MKT_Agent_Daily` | ผลงาน Agent รายวัน | สรุปตาม Agent และวันที่ |
| `MKT_Inbox_Daily` | ผลงาน Inbox รายวัน | สรุปตาม Inbox และวันที่ |
| `MKT_Conversation_Account_Daily` | ภาพรวม Customer Service ระดับ Account รายวัน | ใช้กับ Dashboard และรายงานภาพรวม |

### Reports, AI และ Notification

| Table | แสดงอะไร | เงื่อนไขสำคัญ |
|---|---|---|
| `MKT_Report_Settings` | การตั้งค่ารายงาน ช่วงเวลา และขอบเขตช่องทาง | แก้เฉพาะค่าที่เปิดให้ลูกค้าตั้งค่า |
| `MKT_Report_Snapshots` | หัวรายงานของแต่ละ Platform/ช่วงเวลา | สร้างจากข้อมูล D1 ที่ผ่าน Coverage gate |
| `MKT_Report_Metric_Values` | ค่า Metric ภายในแต่ละรายงาน | ค่าไม่พร้อมเป็น `N/A` ไม่แทนด้วยศูนย์ |
| `MKT_Report_Top_Content` | Content อันดับต้นในช่วงรายงาน | อันดับผูกกับ Report snapshot เดียวกัน |
| `MKT_Report_Top_Ads` | Ads/Campaign อันดับต้นในช่วงรายงาน | อันดับผูกกับ Report snapshot เดียวกัน |
| `MKT_AI_Report_Runs` | สรุป AI สถานะการสร้าง และหลักฐานอ้างอิง | AI อธิบายตัวเลขที่ระบบคำนวณแล้ว ไม่คำนวณตัวเลขเอง |
| `MKT_Notification_Log` | ประวัติการส่งรายงานเข้ากลุ่ม Lark | 1 รายการต่อเอกลักษณ์การส่ง; ป้องกันการส่งซ้ำ |

### Sync & System

| Table | แสดงอะไร | เงื่อนไขสำคัญ |
|---|---|---|
| `MKT_Sync_Log` | ผลการ Sync เวลา จำนวนแถว และสถานะ | ใช้ตรวจย้อนหลัง ไม่ใช่ข้อมูลธุรกิจ |
| `MKT_System_Alerts` | ปัญหาและสถานะการแก้ไข | ใช้โดยผู้ดูแลระบบ; ไม่มี Secret ในข้อความ |

## ข้อมูลใน Cloudflare

Cloudflare เป็นฝั่งประมวลผลและเก็บประวัติหลัก ลูกค้าไม่ควรแก้ข้อมูลใน D1 ด้วยมือ.

| ส่วน | Table สำคัญ | เก็บอะไร |
|---|---|---|
| Organic | `organic_content_state`, `organic_content_observations`, `organic_account_daily_facts`, `youtube_analytics_daily_facts` | สถานะ Content ล่าสุด, ประวัติ Metric รายวัน และ Analytics |
| Paid Ads | `ads_entity_state`, `ads_daily_facts`, `ads_conversion_daily_facts` | Campaign/Ad ปัจจุบัน, Metric รายวัน และ Conversion revision |
| Commerce | `commerce_*`, `raw_commerce_*` | Store/Product/Order/Customer ปัจจุบัน ข้อมูลรับเข้า และยอดรวมรายวัน |
| Chatwoot | `chatwoot_*_state`, `chatwoot_*_daily_facts`, `chatwoot_reporting_event_facts` | สถานะ Conversation/Agent/Inbox และสถิติรายวัน |
| Report | `report_materializations`, `report_requests` | รายงานที่คำนวณเสร็จแล้วและคำขอสร้างรายงาน |
| Notification | `lark_notification_deliveries` | สถานะ claim/send/mirror เพื่อให้ส่งข้อความ exactly once |
| Coverage | `data_coverage_runs`, `data_coverage_entities` | หลักฐานว่าข้อมูลแต่ละช่วงครบ บางส่วน หรือยังไม่พร้อม |
| Sync/Queue | `sync_jobs`, `sync_runs`, `sync_cursors`, `sync_locks`, `sync_work_runs`, `sync_work_phases`, `sync_work_units` | งาน Sync, checkpoint, lock และความคืบหน้าแบบทำต่อจากจุดเดิมได้ |
| Error/Recovery | `queue_operation_attempts`, `dead_letter_jobs`, `dead_letter_operation_metadata`, `system_alerts`, `sync_warning_outbox` | ความพยายามของ Queue, งานที่ล้มเหลว และ Alert สำหรับกู้คืนแบบควบคุม |
| Connection | `connections`, `encrypted_credentials`, `oauth_state_attempts`, `connection_invitations`, `connection_identity_selections` | การเชื่อมบัญชีและ credential ที่เข้ารหัสแล้ว |
| Google Ads ingress | `google_ads_delivery_*`, `google_ads_live_admissions`, `google_ads_signing_provisioning_tickets` | การรับ batch จาก Manager Script, nonce และหลักฐานการยืนยันตัวตน |

## ข้อควรระวัง

- อย่าแก้ Primary/Stable key, Platform, Account ID หรือวันที่ด้วยมือ เพราะใช้กันข้อมูลซ้ำและใช้ reconcile กับ D1
- ตาราง Daily ใน Lark เป็นชั้นแสดงผล/แคช; การลดจำนวนแถวใน Lark ไม่ใช่การลบประวัติจาก D1
- หาก Dashboard ว่าง ให้ดู `Data Quality & Operations`, `MKT_Sync_Log` และ `MKT_System_Alerts` ก่อนสรุปว่า Metric เป็นศูนย์
