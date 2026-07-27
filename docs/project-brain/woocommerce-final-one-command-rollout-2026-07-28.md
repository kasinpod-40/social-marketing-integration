# Project Brain — WooCommerce Final One-command Rollout

## Locked completion target

WooCommerce ไม่ถือว่าปิดงานจากการมี Connector code หรือ preflight operator เท่านั้น. Integration Workspace จะถือว่าจบเมื่อคำสั่งเดียวพิสูจน์ครบ:

```text
Chemistry K WooCommerce GET-only source
→ D1 durable facts
→ Lark RAW + Canonical tables
→ Coverage accepted
→ D1/Lark parity
→ idempotent rerun
→ incremental UAT
→ Schedule active
```

## Architecture decision

- Runtime ใช้ WooCommerce REST client, Shared Reliability, Queue/DLQ, D1 writer, Coverage และ Lark sync engine เดิม.
- WooCommerce job รองรับ Trigger กลางเพียง `manual_uat` และ `scheduled`.
- Continuation ต้องใช้ stable operation เดิม.
- Scheduled identity เป็นหนึ่ง operation ต่อ Bangkok local date/time.
- Incremental watermark ใช้ `min(max order modified, max product modified)` เพื่อยอม Over-fetch แต่ไม่ Skip.
- Full reconciliation ห้ามถูกสร้างจาก Schedule.

## Operational decision

Final completion ใช้ wrapper หนึ่งคำสั่ง:

```text
scripts/woocommerce-final-one-command.mjs
→ prepare exact head / Queue ID / Migration 0017
→ scripts/woocommerce-final-rollout-operator.mjs
```

Wrapper หา Git HEAD และ Queue ID เอง. หาก Migration `0017` pending จะ Backup และ Apply ผ่าน generated config ที่ชี้ isolated migration directory ซึ่งมีเฉพาะ `0017`. Migration `0018` ต้องไม่ถูก Apply จากงาน WooCommerce.

## Lark decision

Lark schema repair เป็น additive only:

- ใช้ Table เดิมเมื่อพบ exact ID/name.
- สร้าง Table ที่ขาด.
- สร้าง Field ที่ขาด.
- ไม่ลบ, rename หรือเปลี่ยน type ของ Business schema เดิม.
- Table IDs จริงอยู่เฉพาะ local/generated deployment config และไม่ Commit.

## Evidence decision

- Evidence เก็บใน ignored private directory.
- Credentials/token/provider records ไม่ถูกเก็บ.
- ทุก phase เชื่อม previous evidence SHA.
- Queue send มี attempt file ป้องกัน resend ที่ไม่ตั้งใจ.
- Same-operation resend ที่อนุญาตมีหนึ่งครั้งเพื่อพิสูจน์ idempotency.

## Failure decision

- ก่อน Business write ต้องมี Remote D1 backup.
- Deploy safe all-false ก่อนเปิด UAT window.
- เมื่อ failure เกิดหลัง safe config พร้อม ต้อง restore all-WooCommerce-flags-false อัตโนมัติ.
- Schedule เปิดเป็นขั้นสุดท้ายเท่านั้น.
- Production ยังคงแยกและ blocked; การปิดงานนี้หมายถึง Integration Workspace production-like DEV สำเร็จ.
