# WooCommerce Snapshot Idempotent Normalization v1

## Root cause

Final operator `readSnapshot()` แปลง D1 snake_case row เป็น normalized camelCase object แล้ว.
Downstream `selectWooCommerceFullOperation()`, completion classifier และ comparison helpers
เรียก normalizer ซ้ำ แต่ normalizer รุ่นเดิมอ่านเฉพาะ snake_case จึงเปลี่ยน snapshot ที่ถูกต้อง
ให้เป็น all-null/all-zero semantic-empty state.

เหตุนี้อธิบายได้ครบว่าทำไม direct D1 inspection เห็น operation และ 897 Business rows
แต่ Final exact preflight เห็น empty ทุกครั้ง ทั้ง OAuth, bearer, generated config และ subprocess
ต่างพิสูจน์แล้วว่าอ่าน Remote state เดียวกัน.

## Correction

- Snapshot normalizer อ่านได้ทั้ง raw snake_case และ normalized camelCase contracts.
- Commerce counts อ่านได้ทั้ง top-level D1 columns และ normalized `counts`.
- JSON state/completion, lifecycle, generation, Queue และ Coverage fields คง semantics เดิม.
- Normalize ซ้ำให้ผล deep-equal กับ normalize ครั้งแรก.
- Exact selector ยอมรับ raw และ normalized partial snapshot ด้วยผล identity เดียวกัน.
- Semantic-empty retry จาก PR #267 ยังคงใช้เฉพาะ raw empty snapshot จริง.

## Safety

ไม่มี Remote mutation ระหว่าง implementation. ทุก failed attempt หยุดก่อน Lark schema,
D1 backup, Worker deploy และ Queue send. Production และ Schedule/Cron ไม่เปลี่ยน.

## Verification

```text
Focused rollout/recovery/reactivation   25/25 PASS
Unit tests                              1499/1499 PASS
Workers runtime                         16/16 PASS
Report reliability                     101/101 PASS
Architecture/hygiene                    406 modules / 0 cycles
npm audit                               0 vulnerabilities
Deploy dry-run                          PASS
```
