# Runbook — WooCommerce Chemistry K Customer/Lark Read-only Preflight

## Safety

รอบนี้อ่านอย่างเดียว ไม่มี Backup, Migration apply, D1 business write, Lark record write, Queue send,
Worker deploy หรือ Schedule activation.

## Target environment

```bash
export MKT_ENV=development
export MKT_CUSTOMER_PROFILE=integration_workspace
export MKT_CONNECTION_CUSTOMER_KEY=chemistry_k
export MKT_WOOCOMMERCE_ROLLOUT_REPOSITORY_HEAD=<reviewed-head>
export MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME=social-mkt-state-dev
export MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG=wrangler.sync.jsonc
export MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME=social-mkt-sync-worker
```

`wrangler.sync.jsonc` และ `.dev.vars` ต้องเป็นไฟล์ local ignored เท่านั้น ห้าม Commit ค่าจริง.

## Plan

```bash
npm run rollout:woocommerce-customer-lark
```

## Remote D1/Migration read-only preflight

```bash
CONFIRM_WOOCOMMERCE_REMOTE_PREFLIGHT=READ_ONLY_WOOCOMMERCE_REMOTE_PREFLIGHT \
  npm run rollout:woocommerce-customer-lark:remote-preflight
```

ผลที่ยอมรับได้มีเพียง:

```text
pending_0017_only
applied_or_no_pending + exact 17 tables / 13 indexes
```

## WooCommerce GET-only preflight

ต้องตั้ง `WOOCOMMERCE_BASE_URL`, `WOOCOMMERCE_CONSUMER_KEY` และ
`WOOCOMMERCE_CONSUMER_SECRET` ใน Secret/local ignored environment เท่านั้น.

```bash
CONFIRM_WOOCOMMERCE_PROVIDER_PREFLIGHT=GET_ONLY_WOOCOMMERCE_PROVIDER_PREFLIGHT \
  npm run rollout:woocommerce-customer-lark:provider-preflight
```

คำขอมีเฉพาะ store identity และ sample page ขนาด 1 ของ orders, products, customers.
Evidence ไม่เก็บ raw records หรือ credential values.

## Lark metadata read-only preflight

ต้องตั้ง Lark credentials และ Table IDs ทั้ง 14 ค่าใน ignored environment.

```bash
CONFIRM_WOOCOMMERCE_LARK_PREFLIGHT=READ_ONLY_WOOCOMMERCE_LARK_PREFLIGHT \
  npm run rollout:woocommerce-customer-lark:lark-preflight
```

Phase นี้อ่านเฉพาะ Table/Field metadata และไม่อ่านหรือเขียน Records.

## Summary

```bash
CONFIRM_WOOCOMMERCE_PREFLIGHT_SUMMARY=SUMMARIZE_WOOCOMMERCE_PREFLIGHT \
  npm run rollout:woocommerce-customer-lark:summary
```

Decision:

```text
READY_FOR_SEPARATE_BACKUP_AND_0017_APPLY_AUTHORIZATION
READY_FOR_GUARDED_MANUAL_D1_LARK_BACKFILL_IMPLEMENTATION
```

ทั้งสอง Decision ยังไม่อนุญาตให้รัน mutation โดยอัตโนมัติ.
