# Completed Report Period v0.7.2

## ปัญหาที่แก้

Scheduled Daily/Weekly Report เคยใช้วันที่ท้องถิ่นที่ Cron ทำงานเป็น `periodEnd` ซึ่งอาจเป็นวันที่ยังไม่จบและทำให้รายงานเป็นข้อมูลบางส่วน.

## Contract ใหม่

- TikTok Sync: `metricDate` = วันท้องถิ่นของ `scheduledTime`
- Daily/Weekly Report: `periodEnd` = วันปฏิทินก่อนหน้าใน Timezone เดียวกัน
- Producer ใส่วันที่ลง Queue message ตั้งแต่ต้น; Consumer และ Queue retry ต้องใช้ค่าเดิม
- Daily Report ใช้ 1 วันสมบูรณ์ล่าสุด
- Weekly Report ใช้ 7 วันสมบูรณ์ล่าสุด โดยจบที่ `periodEnd` เดียวกัน

ตัวอย่างใน `Asia/Bangkok`:

```text
Cron 2026-07-13 08:10 → periodEnd 2026-07-12
Cron 2026-08-01 08:10 → periodEnd 2026-07-31
Cron 2026-01-01 08:10 → periodEnd 2025-12-31
Cron 2028-03-01 08:10 → periodEnd 2028-02-29
```

## UAT gate

Report schedule flags ต้องคง `false` จนกว่า Lark schema, Metric/Setting seeds, Manual Daily/Weekly UAT, idempotent rerun และ client-facing views จะผ่านครบ.

## Git/Release hygiene

`wrangler.sync.jsonc` เป็น local-only. Release ZIP ไม่รวมไฟล์นี้ แต่ Repository ที่เคย Track ไฟล์อยู่ต้องรัน:

```bash
git rm --cached wrangler.sync.jsonc
git ls-files wrangler.sync.jsonc
```

คำสั่งที่สองต้องไม่แสดงผล และไฟล์จริงในเครื่องยังต้องอยู่สำหรับ Deploy.
