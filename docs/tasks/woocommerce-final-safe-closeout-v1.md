# WooCommerce Final Safe Closeout v1

## Objective

ปรับ existing WooCommerce Final one-command operator ให้จบ Integration Workspace UAT ด้วย
Safe Worker ที่ execution flags ทั้งหมดเป็น false และไม่เปิด Schedule/Cron ตาม scoped
authorization ล่าสุด.

## Repository defect

Operator เดิมผ่าน full reconciliation, D1/Lark parity, same-operation replay และ incremental
UAT แล้ว deploy `scheduled-active-window` เป็นขั้นสุดท้าย โดยเปิด:

```text
MKT_CONNECTOR_WOOCOMMERCE_ENABLED
MKT_WOOCOMMERCE_D1_WRITE_ENABLED
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED
MKT_SCHEDULE_WOOCOMMERCE_ENABLED
```

Contract นี้ขัดกับคำสั่งล่าสุดที่กำหนดให้ Schedule/Cron disabled ตลอดและคืน Worker เป็น
all-false Safe State หลัง success/failure.

## Correction

- Reuse config generator, deployment verification และ automatic Safe restore เดิม.
- คง manual UAT window สำหรับ bounded ingestion/replay/incremental validation.
- แทน final scheduled deployment ด้วย `safe-closeout` ที่ใช้ Safe config เดิม.
- Verify exact true flags เป็น empty list หลัง final deployment.
- Final summary บันทึก `executionFlagsAllFalse=true` และ `scheduleEnabled=false`.
- ไม่แก้ Queue, Reliability, D1 writer, Lark writer, Provider, migration หรือ operation identity.

## Safety

```text
Production                         false
Schedule/Cron                     disabled
Success closeout flags            all false
Failure automatic restore flags   all false
Business deletion                 none
Connector ownership               unchanged
```

## Repository verification

```text
Focused rollout/runtime tests  56/56 PASS
npm ci                         PASS
npm run check                  PASS
Unit                           1462/1462 PASS
Workers runtime                15/15 PASS
Report reliability             100/100 PASS
npm audit                      0 vulnerabilities
npm run deploy:dry-run         PASS
```
