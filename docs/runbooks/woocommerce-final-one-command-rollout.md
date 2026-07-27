# Runbook — WooCommerce Final One-command Rollout

## Result

หลัง Repository implementation นี้ Merge แล้ว งาน WooCommerce Integration Workspace เหลือคำสั่ง Terminal เดียว:

```bash
CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT=EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT \
node scripts/woocommerce-final-one-command.mjs --execute
```

ห้ามรันจาก Branch/commit อื่นที่ยังไม่ผ่าน exact-final-head verification.

## Local ignored inputs

Operator อ่าน `.dev.vars` หรือไฟล์ที่กำหนดด้วย `DEV_VARS_FILE`. ค่าจริงต้องอยู่ใน local ignored file / Secret store เท่านั้น:

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
MKT_CONNECTION_CUSTOMER_KEY=chemistry_k
MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG=wrangler.sync.jsonc
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_API_TOKEN=<scoped-token>
LARK_APP_ID=<lark-app-id>
LARK_APP_SECRET=<lark-app-secret>
LARK_APP_TOKEN=<lark-base-app-token>
```

ค่าเหล่านี้ไม่ต้องใส่เองหากมีอยู่แล้ว:

```text
MKT_WOOCOMMERCE_FINAL_REPOSITORY_HEAD  ← อ่านจาก git rev-parse HEAD
MKT_WOOCOMMERCE_FINAL_QUEUE_ID         ← หา exact Queue ID จาก Wrangler Queue list
```

Worker Secret store ต้องมีชื่อ:

```text
WOOCOMMERCE_CONSUMER_KEY
WOOCOMMERCE_CONSUMER_SECRET
LARK_APP_SECRET
```

## What the command does

1. ตรวจ clean Working Tree และ exact DEV/Integration/Chemistry K identity.
2. ตรวจ Wrangler auth, Worker, Queue และ Remote D1.
3. ตรวจ pending migration set; ยอมรับเฉพาะ `0017` และ `0018`.
4. ถ้า `0017` pending:
   - ตรวจ zero active work/lock;
   - Export Remote D1 backup;
   - สร้าง isolated migration directory ที่มีเพียง `0017`;
   - Apply `0017` เท่านั้น;
   - ตรวจว่า `0018` ไม่ถูก Apply และ schema read-back = 17 tables / 13 indexes.
5. ตรวจ/สร้าง Lark WooCommerce 14 tables และ Field ที่ขาดแบบ additive.
6. Export D1 backup รอบก่อน Business processing.
7. Deploy safe all-WooCommerce-flags-false และ verify active version/Queue topology.
8. Deploy Manual UAT window.
9. Full reconciliation: WooCommerce → D1 → Lark.
10. ตรวจ Work/Coverage และ D1/Lark parity ครบ 14 mappings.
11. ส่ง operation เดิมซ้ำหนึ่งครั้งและพิสูจน์ idempotency.
12. รัน incremental UAT จาก conservative Orders/Products watermark.
13. Deploy Scheduled window หลังทุก Gate ผ่าน.
14. เขียน SHA-chained evidence ลง `outputs/woocommerce-final-rollout/`.

## Fail-closed behavior

- Migration ที่ไม่ใช่ `0017`/`0018` → หยุด.
- Partial D1 schema/ledger drift → หยุด.
- Active work หรือ lock → หยุด.
- Missing Worker Secret name → หยุด.
- Lark duplicate Table IDs / missing parity → หยุด.
- Full/rerun/incremental verification fail → หยุด.
- หลัง safe config พร้อม ถ้าเกิดข้อผิดพลาด ระบบ deploy all-WooCommerce-flags-false กลับอัตโนมัติ.

## Completion signal

คำสั่งปิดจบสำเร็จเมื่อ stdout คืน:

```json
{
  "ok": true,
  "accepted": true,
  "parityVerified": true,
  "idempotentRerunVerified": true,
  "incrementalVerified": true,
  "scheduleEnabled": true,
  "nextStep": "none_for_integration_workspace_woocommerce"
}
```

Production/Customer-owned deployment ไม่อยู่ใน scope นี้และยัง blocked.
