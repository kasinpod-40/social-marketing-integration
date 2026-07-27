# WooCommerce Chemistry K — Final One-command Rollout

## Objective

ปิดงาน WooCommerce Integration Workspace ให้จบด้วย Terminal command เดียวหลัง Repository implementation ถูก Merge:

```text
Remote contract preflight
→ additive Lark schema repair/create
→ Remote D1 backup
→ isolated Migration 0017 apply when still pending
→ safe Worker deployment
→ full reconciliation to D1 + Lark
→ 14-table D1/Lark parity
→ same-operation idempotent rerun
→ incremental UAT
→ scheduled active deployment
→ SHA-chained evidence summary
```

## Runtime scope

- WooCommerce Connector และ Queue job เป็น `active` หลัง implementation merge.
- Trigger ที่รับได้มีเฉพาะ `manual_uat` และ `scheduled`.
- Manual UAT ต้องเปิด Connector + D1 + Lark และปิด Schedule.
- Scheduled runtime ต้องเปิด Connector + D1 + Lark + Schedule และบังคับ incremental.
- Continuation ใช้ operation ID, work key, generation และ original requested time เดิม.
- Scheduled producer สร้าง operation เดียวต่อวัน/เวลาตาม Asia/Bangkok.
- Incremental watermark ใช้ค่าที่เก่ากว่าระหว่าง Orders และ Products เพื่อไม่ข้ามการแก้ไข.

## Existing engines reused

```text
WooCommerce REST client
Shared Queue and Queue-attempt ledger
Shared Reliability / lock / retry / DLQ
D1ResumableWorkStore
D1-first commerce writer
Coverage runs/entities
Shared Lark repository and sync engine
```

ห้ามสร้าง Connector, Queue framework, Reliability engine, D1 writer, Coverage engine หรือ Lark sync engine ชุดใหม่.

## Mutation boundary

Repository implementation ทำเฉพาะ Source code/Test/Docs และไม่รัน Remote action.

Final terminal operator จึงเป็นผู้ถือ mutation chain เพียงจุดเดียว โดย:

- Backup ก่อน Migration/Business write.
- Apply เฉพาะ Migration `0017_woocommerce_commerce.sql` ผ่าน isolated migration directory เมื่อยัง pending.
- ไม่ Apply Migration `0018_chatwoot_analytics.sql`.
- สร้างเฉพาะ Lark Table/Field ที่ขาดแบบ additive.
- ไม่ลบ/rename/type-change ตารางหรือ Field เดิม.
- Deploy safe all-false ก่อน UAT.
- Restore safe all-false อัตโนมัติเมื่อเกิดข้อผิดพลาดหลัง safe config พร้อม.
- เปิด Schedule หลัง Full, parity, rerun และ incremental UAT ผ่านเท่านั้น.

## Acceptance

- Remote D1 มี WooCommerce 17 tables / 13 indexes.
- Work lifecycle `completed` และ phase `woocommerce_commerce_pages_v1.complete=1`.
- Coverage 6 datasets, failed rows = 0.
- D1/Lark account-scoped row count เท่ากันครบ 14 mappings.
- Same-operation rerun เพิ่ม Queue attempt แต่ Business/Coverage counts ไม่เปลี่ยน.
- Incremental UAT completed และ parity ผ่าน.
- Final active Worker มีเฉพาะ WooCommerce Connector/D1/Lark/Schedule gates เป็น true.
- Production ยังคง blocked; scope นี้ปิด Integration Workspace WooCommerce เท่านั้น.
