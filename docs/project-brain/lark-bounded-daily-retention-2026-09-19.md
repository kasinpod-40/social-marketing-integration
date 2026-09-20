# Bounded Lark Daily Detail Retention — 2026-09-19

## Decision

Lark เป็น recent cache สำหรับ Daily detail ส่วน D1 เป็นแหล่งประวัติเต็ม จึงใช้กติกาสองชั้นต่อหนึ่งตาราง:

1. เก็บข้อมูล 90 วันล่าสุดตาม `metric_date`;
2. ถ้าจำนวนแตะ 17,000 แถวก่อนครบ 90 วัน ให้เริ่มลบจากวันที่เก่าสุดเพื่อมุ่งกลับสู่ 15,000 แถว.

การลบหนึ่งรอบรวมทุกตารางไม่เกิน 500 แถว เพื่อจำกัดเวลาและผลกระทบต่อ Lark API. ระยะห่าง 2,000 แถว
ระหว่าง Soft limit กับ Target เป็น buffer สำหรับข้อมูลที่เข้ามาระหว่างรอบ.

## Managed tables

- `MKT_Conversation_Daily`
- `MKT_Agent_Daily`
- `MKT_Inbox_Daily`
- `MKT_Conversation_Account_Daily`
- `MKT_Commerce_Daily`
- `MKT_Commerce_Product_Daily`

`MKT_Content_Daily` และ `MKT_Ads_Daily` ใช้นโยบายเฉพาะที่มีอยู่แล้ว. `MKT_Account_Daily` เป็น aggregate
ระยะยาวอย่างน้อย 400 วัน จึงไม่อยู่ในงานนี้.

## Safety contract

- หยุดก่อนอ่าน/ลบเมื่อมี Active sync lock;
- เรียง `metric_date` เก่าสุดก่อน และตรวจว่าวันใน Stable key ตรงกับ field วันที่;
- ลบได้เฉพาะ Stable key ที่พบใน D1 ของ Customer เดียวกันแบบ exact match;
- ลบด้วย Lark record ID ที่อ่านมาในรอบเดียวกัน และ readback ว่า Stable key นั้นหายจาก Lark แล้ว;
- ไม่มีคำสั่ง `DELETE` หรือ Business mutation ใดต่อ D1;
- ค่า config และ feature flag เริ่มต้นเป็น `false` จนกว่าจะผ่าน Release review และ Live preflight.

## Customer live evidence and environment correction

- ภาพจาก Customer Lark Base วันที่ 2026-09-19 แสดง `MKT_Conversation_Daily` จำนวน **15,313 แถว**;
- ตัวเลข 7,327 ที่ตรวจครั้งแรกมาจาก Table mapping ของ Integration Workspace ไม่ใช่ Customer Production
  จึงยกเลิกการใช้ตัวเลขและช่วงวันที่จากการตรวจครั้งนั้นเป็นหลักฐานของ Customer;
- 15,313 แถวยังไม่ถึง Pressure gate 17,000 แถว แต่เหลือระยะอีก 1,687 แถวก่อนเริ่ม Pressure retention;
- Customer Production Deploy สำเร็จวันที่ 2026-09-19 เป็น Worker version
  `aef38b99-b7c1-4c44-a950-807a6b6d3af9`; Cloudflare readback ยืนยัน Traffic 100% และ Flag
  `MKT_LARK_BOUNDED_DAILY_RETENTION_ENABLED=true`;
- รอบอัตโนมัติแรกหลัง Deploy คือ 2026-09-20 เวลา 08:05 Asia/Bangkok. ระหว่าง Rollout ไม่มีการส่ง Queue
  นอกตารางเวลาและไม่มีการลบข้อมูล Lark ด้วยมือ.

จำนวนของตาราง Customer อื่นต้องตรวจด้วย Customer Production app credential ที่ตรงกับ Base ก่อนบันทึกเป็น
Live evidence; ห้ามนำจำนวนจาก Integration Workspace มาเทียบแทน.
