# Lark Report Schema Installer v0.8.0

> **Superseded:** ห้ามใช้ Apply flow ของ v0.8.0 เพราะอาจส่ง Checkbox/UI-only property แล้วเกิด `CheckboxFieldPropertyError`. ใช้ `docs/lark-report-schema-installer-v0.8.1.md` และคำสั่ง Apply แยกเท่านั้น.

## เป้าหมาย

ติดตั้ง/ปรับ Report Schema ใน Lark Base เดิมผ่าน Lark OpenAPI โดยไม่ต้องสร้าง Field ทีละช่อง และใช้ Contract เดียวกันกับ Report Engine v1

ตารางในขอบเขต:

- `MKT_Metric_Definitions`
- `MKT_Report_Settings`
- `MKT_Report_Snapshots`
- `MKT_Report_Metric_Values`
- `MKT_Report_Top_Content`

## Safety model

- คำสั่งปกติเป็น Preview และใช้ Read API เท่านั้น
- Apply ต้องยืนยันด้วย `CONFIRM_WRITE=YES`
- รันซ้ำได้: สร้างเฉพาะ Table/Field ที่ขาด และเติมเฉพาะ Select options/Property ที่ขาด
- ไม่ลบ Table, Field, Record หรือ Select option
- Field type ไม่ตรงจะหยุดแบบ Fail-closed และไม่แปลงข้อมูลเดิม
- Table ID ที่ Config ไว้แต่หาไม่พบจะหยุด หาก Resolve จาก alias ไม่ได้ เพื่อป้องกันสร้าง Table ซ้ำ
- Table ใหม่วาง Stable key เป็น Field แรกเพื่อเป็น Primary field
- Table เดิมที่ Primary field ไม่ตรงจะรายงาน `PRIMARY_FIELD_REVIEW_REQUIRED` ให้ตรวจใน Lark UI หลัง Apply
- Secret อ่านจาก `.dev.vars`/Shell เท่านั้น และไม่ถูกพิมพ์ในผลลัพธ์

## Preview

```bash
npm run setup:report-schema
```

ผลสำคัญ:

- `readyToApply`
- `summary.createTables`
- `summary.createFields`
- `summary.updateFields`
- `conflicts`
- `manualActions`
- `environmentUpdates`

Preview ไม่เขียน Lark

## Apply

รันเมื่อ Preview มี `readyToApply: true` เท่านั้น:

```bash
CONFIRM_WRITE=YES npm run setup:report-schema:apply
```

หลัง Apply ให้นำ `environmentUpdates` ไปใส่ใน Local `wrangler.sync.jsonc` โดยเฉพาะ:

```jsonc
"LARK_TABLE_MKT_REPORT_METRIC_VALUES": "tbl...",
"LARK_TABLE_MKT_REPORT_TOP_CONTENT": "tbl..."
```

ห้าม Commit `wrangler.sync.jsonc`

## Verbose trace

ใช้เฉพาะตอนวิเคราะห์ UAT:

```bash
MKT_SCHEMA_VERBOSE=true npm run setup:report-schema
```

หรือ Apply:

```bash
MKT_SCHEMA_VERBOSE=true CONFIRM_WRITE=YES npm run setup:report-schema:apply
```

Trace จะ Mask App token ตาม Lark client contract เดิม

## หลัง Schema Apply

1. ตรวจ `manualActions` และ Primary fields ใน Lark UI
2. ใส่ Table IDs ที่สร้างใหม่ใน `wrangler.sync.jsonc`
3. รัน Preview ซ้ำ ต้องมี `actions: []` และ `conflicts: []`
4. รัน `CONFIRM_WRITE=YES npm run seed:metrics`
5. รัน Seed ซ้ำเพื่อยืนยัน Idempotency
6. รัน `MKT_CUSTOMER_PROFILE=dev_ft_pumkin CONFIRM_WRITE=YES npm run seed:report-settings`
7. Report schedules ต้องคง `false` จน Manual Daily/Weekly UAT ผ่าน

## สิ่งที่ Installer ยังไม่ทำ

- ไม่สร้าง Client-facing Views/Filters/Permissions
- ไม่ Seed records อัตโนมัติ
- ไม่แก้ Local Wrangler config อัตโนมัติ
- ไม่เปิด Daily/Weekly Report schedule
- ไม่สร้าง Lark Automation หรือ Group Notification
