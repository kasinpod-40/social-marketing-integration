# Lark Report Schema Installer v0.8.1

## เป้าหมาย

ติดตั้ง/ปรับ Report Schema ใน Lark Base เดิมแบบ Idempotent และ Non-destructive โดยสร้างเฉพาะ Table, Field และ Select option ที่ขาด ห้ามลบข้อมูลหรือเปลี่ยน Field type อัตโนมัติ

รุ่นนี้แก้ปัญหา `CheckboxFieldPropertyError` จาก v0.8.0 โดย Checkbox และ Field type ที่ OpenAPI ไม่รองรับ Property จะไม่ส่ง `property` ใน Create/Update request อีกต่อไป นอกจากนี้ Preview command จะอ่านอย่างเดียวเสมอ แม้ Shell จะมี `CONFIRM_WRITE=YES` ค้างอยู่

## คำสั่งที่ปลอดภัย

Preview แบบ Read-only:

```bash
npm run setup:report-schema
```

Apply ต้องระบุทั้งคำสั่งแยกและการยืนยัน:

```bash
CONFIRM_WRITE=YES npm run setup:report-schema:apply
```

การตั้ง `CONFIRM_WRITE=YES` แล้วรัน Preview จะไม่เขียนข้อมูล ระบบจะแสดง Warning และบอก Apply command ที่ถูกต้อง

## กรณี v0.8.0 หยุดกลางทาง

คำสั่งเดิมอาจสร้าง/แก้บาง Field สำเร็จก่อนเจอ Checkbox error ห้ามย้อนลบ Field เหล่านั้น ให้ใช้ v0.8.1 แล้วรัน Preview ใหม่ Installer จะอ่าน Schema ปัจจุบันและวางแผนเฉพาะส่วนที่ยังขาด

ลำดับ:

1. รัน Preview
2. ตรวจ `readyToApply`, `actions`, `conflicts`, `warnings`, `manualActions` และ `environmentUpdates`
3. แก้ Conflict ทั้งหมดก่อน Apply
4. รัน Apply ด้วยคำสั่งแยก
5. รัน Preview ซ้ำ ต้องเหลือ write action เป็นศูนย์

## Field payload contract

- Checkbox, Text, Phone, URL, Attachment และ Lookup ไม่ส่ง `property`
- Single/Multi Select ส่ง `property.options` เท่านั้น และรักษา Option ID เดิมเมื่อเติม Option ใหม่
- DateTime ใช้ `date_formatter` และ `auto_fill`
- ไม่ส่ง UI-only keys เช่น `styleId`, `optionsType`, `timeFormat` หรือ `extractExternalUrl`
- ส่ง `ui_type` และ Description เมื่อ Schema contract ระบุ

## Failure diagnostics

เมื่อ Apply ล้ม ระบบคืน Structured JSON ที่มี:

- `code` / `message` / `retryable`
- `details.schemaAction` ระบุ Table, Field, Type และ Action ที่ล้ม
- `details.appliedActionCount` ระบุจำนวน Action ที่สำเร็จไปก่อนหน้า

จึงสามารถรัน Preview ซ้ำเพื่อดูงานคงเหลือได้โดยไม่ต้องเดาว่าติดตั้งถึงจุดใด

## ขอบเขต

Installer ครอบคลุม 5 ตาราง Report และ 110 Fields:

- `MKT_Metric_Definitions`
- `MKT_Report_Settings`
- `MKT_Report_Snapshots`
- `MKT_Report_Metric_Values`
- `MKT_Report_Top_Content`

Installer ไม่ Seed record, ไม่แก้ `wrangler.sync.jsonc`, ไม่เปิด Report schedule และไม่เปลี่ยน Primary field ของ Table เดิมแบบทำลายข้อมูล Primary mismatch จะถูกส่งเป็น Manual action ให้ตรวจใน Lark UI

## หลัง Apply

1. นำ Table IDs จาก `environmentUpdates` ไปใส่ Local `wrangler.sync.jsonc`
2. รัน Preview ซ้ำให้สะอาด
3. ตรวจ `PRIMARY_FIELD_REVIEW_REQUIRED` ใน Lark UI
4. Seed Metric definitions และ Report settings แบบ Idempotent
5. ทำ Manual Daily/Weekly Report UAT
6. เปิด Report schedule หลัง UAT ผ่านเท่านั้น
