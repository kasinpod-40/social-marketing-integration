# WooCommerce Exact DLQ Completion Closure v1

## Objective

หลัง exact Final operation `woo-final-full-e2372e56d52d` ผ่าน D1/Lark parity,
same-operation replay, incremental UAT และ all-false Safe restore ให้ retain และปิดเฉพาะ
operational incident metadata 3 แถวที่เกิดระหว่าง durable continuation:

```text
QUEUE_RETRY_EXHAUSTED
LARK_PREFLIGHT_FAILED
WOOCOMMERCE_CONNECTOR_INVALID
```

ไม่ลบหรือ redrive Queue message และไม่แก้ Work, Sync, Coverage, Business facts หรือ Lark.

## Guarded command

```bash
CONFIRM_WOOCOMMERCE_DLQ_CLOSURE=CLOSE_WOO_FINAL_E2372E56D52D_DLQ_ONLY \
node scripts/woocommerce-dlq-closure-operator.mjs --execute
```

Default invocation เป็น plan-only. Execution ต้องผ่าน:

- clean current `main == origin/main`;
- Integration Workspace development identity;
- Final `11-summary.json` ยืนยัน exact operation, D1/Lark parity, replay, incremental UAT,
  all-false Worker, Schedule false และ Production false;
- fresh Remote D1 backup;
- exact full snapshot terminal success, completed Work, 6 valid Coverage rows, zero active lock,
  failedRows 0 และ Queue identity/generation/requested-at ตรง;
- exact immutable DLQ IDs, message IDs, error codes, retry counts และ per-row attempt metadata.

Mutation เปลี่ยนเฉพาะ `dead_letter_jobs` เป็น retained `redriven` และ
`dead_letter_operation_metadata` เป็น `completed` พร้อม exact closure reference. SQL guard
ตรวจ completed full reconciliation และ zero live lock ซ้ำในทุก statement. Post-read ต้องยืนยัน
3 retained rows, completed metadata และ exact operation snapshotไม่ drift.

## Safety

- D1 Business/Coverage mutation: none
- Lark mutation: none
- Worker deployment: none
- Queue send/redrive/delete: none
- Schedule/Cron: false
- Production: blocked
- Partial command failure: exact-reference intermediate state rerunได้แบบ idempotent

