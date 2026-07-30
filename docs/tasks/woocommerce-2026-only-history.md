# WooCommerce 2026-only History

## Objective

จำกัด Integration Workspace WooCommerce transaction history ให้เหลือเฉพาะปี 2026 เพื่อไม่ให้
Lark Base เต็มจาก Full history เดิม โดยรักษา current Store/Product/Category master ที่จำเป็นต่อ
รายงาน.

## Source and durable contract

```text
Order after          2026-01-01T00:00:00.000Z
Order before         operation requested_at
dates_are_gmt        true
Customer/Coupon      เก็บเฉพาะ source-created ภายในช่วงเดียวกัน
Product/Category     current snapshot
```

`orderCreatedAfter` และ `orderCreatedBefore` อยู่ใน Queue job และ immutable durable phase.
Continuation ทุกครั้ง rehydrate ค่าเดิม. Invalid/reversed window fail ก่อน Provider/D1/Lark.

Orders ใช้ Provider `after`/`before` โดยตรง. Customers/Coupons อ่าน page ตามปกติและกรอง
source-created timestamp ก่อน normalization/write.

## Coverage and reports

- Orders, Customers และ Coupons ใช้ `scope_mode=report_range`.
- `period_start=2026-01-01`; `period_end` เป็นวันของ operation boundary.
- Store, Products และ Categories ยังเป็น `full_inventory` current snapshot.
- Commerce Report ยอม `complete` สำหรับ `report_range` เฉพาะเมื่อ Coverage start/end ครอบคลุม
  requested report period.

## Pre-2026 cleanup

```bash
CONFIRM_WOOCOMMERCE_2026_HISTORY_CLEANUP=DELETE_WOOCOMMERCE_PRE_2026_ONLY \
node scripts/woocommerce-2026-history-cleanup.mjs --execute
```

Operator ยืนยัน Development target และ zero lock, อ่าน target Stable keys ครบทั้ง D1/Lark
7 ตาราง, บันทึก exact parity หรือ partial-write gap เป็น count/fingerprint, Export D1 + Lark
backups, Batch delete Lark ตาม Lark target, รัน ordered idempotent D1 statements ตาม D1 target
พร้อม progress evidence และ verify ว่า pre-2026 rows เป็นศูนย์. Remote D1 ไม่รองรับ SQL
`BEGIN/COMMIT` ผ่าน Wrangler; ทุก statement จึง scoped, rerun-safe และต้องผ่าน final zero
verification. Gap ไม่ถูกซ่อนและไม่ทำให้ลบทิ้งโดยไม่มี backup.

ไม่ลบ Store, Product, Variation, Category, raw Customer, raw Coupon, Coverage หรือ DLQ audit
metadata. หลัง backup แล้วจะปิดเฉพาะ Work/Sync identity ของ Full-history operation เดิมเป็น
terminal/failed ด้วยเหตุผล `WOOCOMMERCE_HISTORY_SCOPE_REPLACED`; ไม่ลบ Reliability audit rows
และไม่แตะ Work/Sync อื่น. ไม่มี Worker deploy, Queue send, Schedule หรือ Production mutation
ใน cleanup operator.

Backup/attempt/progress ใช้ unique attempt ID และไม่ overwrite evidence ของรอบก่อนหน้า.

## Acceptance

```text
pre-2026 D1/Lark Business rows      0
2026 bounded reconciliation         completed
failed rows                         0
D1/Lark Stable-key parity           exact
same-operation replay               no drift
incremental replay                  bounded by 2026 floor
Worker flags after closeout         all false
Schedule / Production               unchanged
```
