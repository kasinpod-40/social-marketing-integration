# Lark Report Schema Installer v0.8.2

## ปัญหาที่แก้

Apply ของ v0.8.1 หยุดที่ `decimal_places` ด้วย `1254001 WrongRequestBody` เพราะ Number formatter ใช้รูปแบบ Spreadsheet เช่น `#,##0` ซึ่ง Field Create/Update API ไม่รับ

## Contract ใหม่

- จำนวนเต็มมีหลักพัน: `1,000`
- ทศนิยม 4 ตำแหน่ง: `0.0000`
- Shared Field contract แปลง legacy aliases ก่อนส่ง API
- Schema validation ตรวจ Number formatter ทุก Field
- Checkbox และ Propertyless field safety จาก v0.8.1 ยังคงเดิม

## Recovery

ผลล้มเหลวระบุ `appliedActionCount=0` จึงไม่มี Schema action สำเร็จในรอบนั้น ไม่ต้องลบหรือ rollback Field ใด

1. อัปเกรดเป็น v0.8.2
2. รัน Preview: `npm run setup:report-schema`
3. ตรวจ `conflicts: []` และ `readyToApply: true`
4. Apply: `CONFIRM_WRITE=YES npm run setup:report-schema:apply`
5. รัน Preview ซ้ำจน write actions เป็นศูนย์
6. ใส่ Table IDs ใหม่ใน local `wrangler.sync.jsonc`
7. ตรวจ Primary field manual action
8. Seed และ Manual Report UAT

Report schedules ต้องคง `false` ตลอดขั้นตอนนี้
