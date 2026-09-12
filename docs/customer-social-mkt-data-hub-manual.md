# คู่มือ Social MKT Data Hub

เอกสารนี้อธิบายว่า Dashboard และตารางใน Lark Base ใช้ดูอะไร ข้อมูลมาจากไหน และมีเงื่อนไขอะไรที่ควรรู้ ระบบเก็บประวัติหลักไว้ใน Cloudflare D1 แล้วส่งข้อมูลที่ใช้ดูงานไปยัง Lark Base

## อ่านวันที่ให้ถูก

- `metric_date` = วันที่ของข้อมูล โดยรอบรายวันทั่วไปใช้วันล่าสุดที่จบสมบูรณ์แล้ว
- `last_sync_at` = วันที่และเวลาที่ระบบเขียนข้อมูลปลายทางสำเร็จ จึงอาจใหม่กว่า `metric_date` 1 วัน
- `period_start` / `period_end` = ช่วงข้อมูลที่รายงานหรือสรุปใช้คำนวณ
- ค่า `0` คือแหล่งข้อมูลยืนยันว่าเป็นศูนย์ ส่วนข้อมูลที่ไม่มีหรือยังไม่พร้อมจะแสดงเป็นว่าง/`N/A`

## Dashboard

Dashboard อ่านจากชุดรายงานที่ระบบคำนวณและตรวจความครบถ้วนแล้ว ไม่ได้อ่านข้อมูลดิบโดยตรง ตัวกรองหลักคือ Platform, Account และช่วงเวลา `1D`, `3D`, `7D` หรือ `30D` หากข้อมูลฐานสำหรับเปรียบเทียบยังไม่ครบ ระบบจะแสดงว่างหรือ `N/A` แทนการใส่ศูนย์

### 📊 Executive Marketing Overview

หน้าสรุปสำหรับดูภาพรวมทุกด้านในหน้าเดียว

| บล็อก | รูปแบบ | ค่าที่แสดง |
|---|---|---|
| Organic Total Views | ตัวเลขสรุป | ยอดดูสะสมล่าสุดของ Content ที่อยู่ในขอบเขตรายงาน |
| Organic Views by Window | ตัวเลขตามช่วง | ยอดดูที่เกิดขึ้นในช่วง `1D`, `3D`, `7D` หรือ `30D` |
| Orders | ตัวเลขสรุป | จำนวนออเดอร์ WooCommerce ที่ระบบรับรองในช่วงรายงาน |
| Net Sales | ตัวเลขสรุป | ยอดขายสุทธิหลังหักรายการที่ระบบกำหนด หน่วยเป็นสกุลเงินของร้าน |
| Net Sales by Window | ตัวเลขตามช่วง | ยอดขายสุทธิแยกตามช่วงเวลาที่เลือก |
| Ad Spend | ตัวเลขสรุป | ค่าโฆษณารวมจากบัญชี Paid Ads ที่เชื่อมต่อ |
| Ad Spend by Window | ตัวเลขตามช่วง | ค่าโฆษณาแยกตามช่วงเวลาที่เลือก |
| Trend | กราฟตามเวลา | แนวโน้ม Organic Views, Net Sales หรือ Ad Spend ตามตัวกรอง |
| Top Content | ตารางอันดับ | ชื่อ/ลิงก์ Content, Platform และค่าผลงานหลักในช่วงรายงาน |
| Top Ads | ตารางอันดับ | Campaign/Ad, Platform, Spend และค่าผลงานหลักในช่วงรายงาน |
| Data Readiness | สถานะข้อมูล | วันที่ข้อมูลล่าสุดและความพร้อมของข้อมูลที่นำมาสรุป |
| Data Quality | สถานะข้อมูล | ความครบถ้วนของช่วงข้อมูลและเหตุผลเมื่อบาง Metric ยังเป็น `N/A` |

### 🌱 Organic Performance

ใช้ดูผลงาน Facebook, Instagram, TikTok และ YouTube ทั้งยอดล่าสุดและยอดที่เกิดขึ้นในช่วงที่เลือก

| บล็อก | รูปแบบ | ค่าที่แสดง |
|---|---|---|
| Total Views | ตัวเลขสรุป | ยอดดูสะสมล่าสุด |
| Total Likes | ตัวเลขสรุป | ยอดถูกใจสะสมล่าสุด |
| Total Comments | ตัวเลขสรุป | ยอดความคิดเห็นสะสมล่าสุด |
| Total Shares | ตัวเลขสรุป | ยอดแชร์สะสมล่าสุด |
| Total Engagement | ตัวเลขสรุป | Engagement รวมล่าสุดตามนิยามกลางของระบบ |
| Current Engagement Rate | ตัวเลขสรุป | อัตรา Engagement ล่าสุด |
| Period Views | ตัวเลขตามช่วง | ยอดดูที่เพิ่มขึ้นในช่วงที่เลือก |
| Period Likes | ตัวเลขตามช่วง | ยอดถูกใจที่เพิ่มขึ้นในช่วงที่เลือก |
| Period Comments | ตัวเลขตามช่วง | ยอดความคิดเห็นที่เพิ่มขึ้นในช่วงที่เลือก |
| Period Shares | ตัวเลขตามช่วง | ยอดแชร์ที่เพิ่มขึ้นในช่วงที่เลือก |
| Period Engagement | ตัวเลขตามช่วง | Engagement ที่เกิดขึ้นในช่วงที่เลือก |
| Period Engagement Rate | ตัวเลขตามช่วง | อัตรา Engagement ของช่วงที่เลือก |
| Tracked Content | ตัวเลขตรวจข้อมูล | จำนวน Content ที่อยู่ในการคำนวณ |
| New Content | ตัวเลขตรวจข้อมูล | จำนวน Content ที่เผยแพร่ใหม่ในช่วงที่เลือก |
| Baseline Covered Content | ตัวเลขตรวจข้อมูล | จำนวน Content ที่มีข้อมูลฐานเพียงพอสำหรับหาค่าเพิ่มขึ้น |
| Baseline Missing Content | ตัวเลขตรวจข้อมูล | จำนวน Content ที่ยังไม่มีข้อมูลฐานเพียงพอ |
| Baseline Coverage Rate | เปอร์เซ็นต์ | สัดส่วน Content ที่พร้อมคำนวณค่าตามช่วง |
| Trend | กราฟตามเวลา | แนวโน้ม Views และ Engagement ตามวัน |
| Platform Comparison | กราฟเปรียบเทียบ | เปรียบเทียบค่าหลักระหว่าง Facebook, Instagram, TikTok และ YouTube |
| Top Content | ตารางอันดับ | Content ที่ผลงานสูงสุด พร้อม Platform, วันที่เผยแพร่ และ Metric หลัก |
| Data Quality | สถานะข้อมูล | ความครบถ้วนของช่วงข้อมูล; ค่าตามช่วงเป็น `N/A` เมื่อ Baseline ยังไม่ครบ |

### 💰 Paid Ads Performance

ใช้ดูประสิทธิภาพโฆษณาของ Meta Ads, Google Ads และ TikTok Ads

| บล็อก | รูปแบบ | ค่าที่แสดง |
|---|---|---|
| Spend | ตัวเลขสรุป | ค่าโฆษณารวมในช่วงที่เลือก |
| Impressions | ตัวเลขสรุป | จำนวนครั้งที่โฆษณาถูกแสดง |
| Clicks | ตัวเลขสรุป | จำนวนคลิก |
| CTR | ตัวเลขสรุป | อัตราคลิกต่อ Impression |
| CPC | ตัวเลขสรุป | ค่าใช้จ่ายเฉลี่ยต่อคลิก |
| CPM | ตัวเลขสรุป | ค่าใช้จ่ายเฉลี่ยต่อ 1,000 Impressions |
| Trend | กราฟตามเวลา | แนวโน้ม Spend, Impressions, Clicks และ Metric ที่รองรับตามวัน |
| Spend by Platform | กราฟเปรียบเทียบ | ค่าโฆษณาแยก Meta, Google และ TikTok |
| Clicks by Platform | กราฟเปรียบเทียบ | จำนวนคลิกแยก Platform |
| Top Ads | ตารางอันดับ | Campaign/Ad, Platform, Spend, Impressions, Clicks และ Conversion เมื่อแหล่งข้อมูลส่งมา |
| Data Quality | สถานะข้อมูล | บัญชีที่รวมในรายงาน ช่วงข้อมูล และ Metric ที่ยังไม่มีจากต้นทาง |

### 🛒 Commerce & Conversion

ใช้ดูยอดขายจาก WooCommerce หลังรวมยอดและตรวจสถานะออเดอร์แล้ว

| บล็อก | รูปแบบ | ค่าที่แสดง |
|---|---|---|
| Orders | ตัวเลขสรุป | จำนวนออเดอร์ที่ระบบรับรองในช่วงที่เลือก |
| Orders by Window | ตัวเลขตามช่วง | จำนวนออเดอร์แยกตามช่วง `1D`, `3D`, `7D` หรือ `30D` |
| Gross Sales | ตัวเลขสรุป | ยอดขายก่อนหักส่วนลด คืนเงิน และรายการปรับปรุงตามนิยามร้าน |
| Gross Sales by Window | ตัวเลขตามช่วง | ยอดขายก่อนหักรายการ แยกตามช่วงที่เลือก |
| Net Sales | ตัวเลขสรุป | ยอดขายสุทธิในช่วงที่เลือก |
| Refunds | ตัวเลขสรุป | ยอดคืนเงินที่บันทึกในช่วงที่เลือก |
| Trend | กราฟตามเวลา | แนวโน้ม Orders, Gross Sales, Net Sales และ Refunds ตามวัน |
| อันดับสินค้า/ช่องทางชำระ/การจัดส่ง | ตารางอันดับ | รายการอันดับและยอดขายที่เกี่ยวข้อง เมื่อชุดรายงานมีข้อมูลส่วนนั้น |
| Data Quality | สถานะข้อมูล | วันที่ข้อมูลล่าสุด ความครบถ้วน และสถานะข้อมูลจาก WooCommerce |

### 💬 Customer Service & Leads

ใช้ดูงานบริการลูกค้าจาก Chatwoot โดยดึงเฉพาะ Conversation ใหม่หรือรายการที่มีการเปลี่ยนแปลง

| บล็อก | รูปแบบ | ค่าที่แสดง |
|---|---|---|
| New Conversations | ตัวเลขสรุป | จำนวน Conversation ที่เริ่มใหม่ในช่วงที่เลือก |
| New Conversations by Window | ตัวเลขตามช่วง | Conversation ใหม่แยกตามช่วงเวลา |
| Open Conversations | ตัวเลขสรุป | จำนวน Conversation ที่ยังเปิดอยู่ ณ จุดสรุปข้อมูล |
| Resolved Conversations | ตัวเลขสรุป | จำนวน Conversation ที่ปิดหรือแก้ไขเสร็จในช่วงที่เลือก |
| Resolved Conversations by Window | ตัวเลขตามช่วง | Conversation ที่ปิดแล้วแยกตามช่วงเวลา |
| First Response Time | ตัวเลขสรุป | เวลาเฉลี่ยก่อนตอบลูกค้าครั้งแรก |
| Resolution Time | ตัวเลขสรุป | เวลาเฉลี่ยตั้งแต่เปิดจนปิด Conversation |
| Trend | กราฟตามเวลา | แนวโน้ม Conversation ใหม่ เปิดอยู่ และปิดแล้วตามวัน |
| Agent/Inbox Ranking | ตารางอันดับ | จำนวนงานและเวลาตอบของ Agent หรือ Inbox เมื่อชุดรายงานมีข้อมูลจัดอันดับ |
| Data Quality | สถานะข้อมูล | วันที่ข้อมูลล่าสุด จำนวนรายการที่นำมาคำนวณ และส่วนที่ยังไม่ครบ |

### 🛡️ Data Quality & Operations

หน้าตรวจสุขภาพระบบ ใช้แยกกรณี “ไม่มีข้อมูลจริง” ออกจาก “ข้อมูลยังมาไม่ครบ”

| บล็อก | รูปแบบ | ค่าที่แสดง |
|---|---|---|
| Freshness | สถานะเวลา | วันที่ข้อมูลล่าสุด เวลาที่สร้างรายงาน และเวลาที่ Sync สำเร็จล่าสุด |
| Coverage | เปอร์เซ็นต์/จำนวน | อัตราความครบถ้วน จำนวนรายการที่พร้อมคำนวณ และจำนวนที่ขาด Baseline |
| Data Status | ป้ายสถานะ | `complete`, `partial`, `no_data` หรือ `source_unavailable` ตามหลักฐานของรอบนั้น |
| Connector Health | สถานะระบบ | ผล Sync ล่าสุดของแต่ละช่องทาง งานที่กำลังทำ และงานที่ต้องตรวจ |
| Alerts | ตารางรายการ | ระดับความสำคัญ สาเหตุ เวลาเกิด สถานะเปิด/แก้แล้ว และช่องทางที่เกี่ยวข้อง |

ค่าบน Dashboard มาจาก `MKT_Report_Snapshots`, `MKT_Report_Metric_Values`, `MKT_Report_Top_Content` และ `MKT_Report_Top_Ads` ส่วนสถานะงานและปัญหาอ้างอิง `MKT_Sync_Log` กับ `MKT_System_Alerts`

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
