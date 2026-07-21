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

สถาปัตยกรรมและ Preview ผ่านแล้ว แต่ Live Lark Apply ยังต้องได้รับคำสั่งยืนยันแยกต่างหาก; Connector implementation, Cloudflare rollout, Advertisement creation และ Spend ยังไม่อนุญาต


## Preview tooling v0.12.2

`npm run preview:shared-table-schema` ตรวจ Live DEV แบบ Read-only. `--base-export` ใช้ตรวจ Export แบบ Offline โดยไม่อ่าน Cell values. Live DEV Preview ผ่านแล้ว: reuse 5 ตารางว่าง, Primary metadata ครบ, conflict/warning/manual blocker เป็นศูนย์ และ Protected TikTok มี 0 actions. หลักฐาน Sanitized อยู่ที่ `live-dev-preview-summary.md`.

## Guarded Apply candidate v0.12.3

PR #10 เพิ่ม Apply แบบ DEV-only ซึ่ง Preview ซ้ำก่อนเขียน, บังคับสอง Confirmation, ทำงานตามลำดับ, รองรับ Partial rerun และต้อง Zero-drift หลังจบ. รายละเอียดอยู่ที่ `guarded-apply-summary.md`. การมีโค้ด Apply ไม่เท่ากับอนุญาตให้รัน Live; ต้องได้รับคำสั่งยืนยันเฉพาะรอบ Apply หลัง PR Merge.
