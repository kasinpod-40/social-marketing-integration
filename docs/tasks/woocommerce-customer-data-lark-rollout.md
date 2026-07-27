# WooCommerce Chemistry K Customer Data → D1 → Lark Rollout

## Objective

ทำให้ WooCommerce ของ Chemistry K ใช้งานจริงใน Integration Workspace โดยดึงข้อมูลแบบ read-only จาก
WooCommerce REST API เขียน D1 ก่อน แล้วส่งข้อมูลชุดเดียวกันเข้า Lark Base 14 ตาราง พร้อม reconciliation,
idempotent rerun และหลักฐานว่าไม่มีข้อมูลธุรกิจเดิมถูกแก้หรือลบ.

## Workstream boundary

- Workstream นี้เป็น WooCommerce เท่านั้น
- หยุด Chatwoot ในแชทนี้
- ใช้ `main` และ Shared Reliability / Queue / D1 / Coverage / Lark engines ที่มีอยู่
- ไม่เปิด Schedule ก่อน Manual UAT, parity และ rerun ผ่าน

## Phase sequence

```text
Repository operator implementation
→ Remote D1/Migration 0017 read-only preflight
→ WooCommerce GET-only provider preflight
→ Lark 14-table read-only inventory
→ decision: Migration pending or already applied
→ separate backup authorization when needed
→ separate Migration 0017 apply authorization when needed
→ schema read-back
→ safe Worker deploy with all WooCommerce gates false
→ guarded manual full reconciliation to D1 + Lark
→ D1/Lark parity and business-fact reconciliation
→ idempotent rerun
→ incremental UAT
→ Schedule authorization
```

## Read-only preflight scope in this PR

This PR implements only these executable phases:

```text
remote-preflight
provider-preflight
lark-preflight
summary
```

The default command is plan-only. Every executable phase needs its own exact confirmation.

## Required Lark tables

```text
RAW_Commerce_Stores
RAW_Commerce_Orders
RAW_Commerce_Order_Items
RAW_Commerce_Products
RAW_Commerce_Product_Variations
RAW_Commerce_Categories
RAW_Commerce_Customers
RAW_Commerce_Coupons
RAW_Commerce_Refunds
MKT_Commerce_Orders
MKT_Commerce_Products
MKT_Commerce_Customers
MKT_Commerce_Daily
MKT_Commerce_Product_Daily
```

## Privacy contract

- WooCommerce credentials remain in Secret store only.
- Evidence never stores credential values or raw provider records.
- Customer data remains minimized according to the existing commerce model.
- Coupon codes remain hashed.
- Lark read-only preflight reads table/field metadata only and reads no records.

## Mutation exclusions for this PR

```text
Remote D1 backup/apply/write       NONE
WooCommerce mutation              NONE
Lark table/field/record mutation  NONE
Queue send                        NONE
Worker deployment                 NONE
Schedule activation               NONE
Production                        NONE
```
