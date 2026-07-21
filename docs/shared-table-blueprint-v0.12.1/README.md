# Shared-table Blueprint v0.12.1

Revision นี้แทน Physical table layout แบบ 14 Meta Raw tables ของ v0.12.0 หลังตรวจ Lark Base export ปัจจุบันและยืนยันหลักเดิมว่า Platform เดียวกันต้องแยกด้วย `platform`/`entity_type` และ View ไม่ใช่เพิ่ม Table ตาม API endpoint

## ผลลัพธ์ทางกายภาพ

- รักษา `RAW_TikTok_Creator_Videos` เป็น Protected source table แบบ Read-only
- ไม่แตะสาม YouTube Raw tables ที่ใช้งานจริง
- Rename/Reuse ตาราง Planned ว่าง 5 ตารางแบบ In-place เป็น Shared Raw tables
- เพิ่มใหม่เพียง `MKT_Account_Daily` และ `MKT_Ads_Ads` เพราะ Grain/Identity ต่างจากตารางเดิมจริง
- จำนวน Table เป้าหมายจาก 26 เป็น 28 ไม่ใช่ 41

## Shared Raw tables

1. `RAW_Meta_Organic_Accounts`
2. `RAW_Meta_Organic_Content`
3. `RAW_Meta_Organic_Metrics`
4. `RAW_Ads_Entities`
5. `RAW_Ads_Daily`

## Canonical additions

1. `MKT_Account_Daily` — Account×Date
2. `MKT_Ads_Ads` — แยก Ad จาก Creative

## Authority

- `fields.csv` เป็น Field-level contract
- `migration-map.csv` ล็อก In-place reuse และ Safety gate
- `view-plan.csv` ล็อกการแยก Platform/Entity ด้วย View
- `protected-tables.csv` ล็อกตารางที่ระบบเราห้ามแก้
- `.base` ของผู้ใช้ใช้ตรวจแบบ Local เท่านั้นและไม่ Commit

ยังไม่อนุญาต Live Lark mutation, Connector implementation, Cloudflare rollout, Advertisement creation หรือ Spend
