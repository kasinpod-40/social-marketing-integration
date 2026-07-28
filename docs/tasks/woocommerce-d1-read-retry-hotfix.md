# WooCommerce Final Rollout — Remote D1 Read Retry Hotfix

## Incident evidence

Operation:

```text
woo-final-full-e486b03cfe8d
```

The final operator successfully completed source materialization, failed-work recovery, Safe/UAT deployment and initial Queue admission. During `full-reconciliation`, one Remote read-only snapshot command failed:

```text
npx wrangler d1 execute ... --remote --json --command SELECT ...
```

The operator propagated that single child-process error immediately and performed automatic all-false Safe restore. The failure did not prove that the WooCommerce Provider job failed; it proved that the verifier lacked bounded retry for Remote D1 reads.

## Scope

Repository-only operator resilience hotfix:

- prepend a temporary `npx` shim only for the WooCommerce final launcher;
- retry only `wrangler d1 execute --remote --command` calls whose SQL starts with `SELECT` or `WITH` and contains no mutation keyword;
- use five total attempts with delays of 1s, 2s, 5s and 10s;
- pass Deploy, Queue, D1 export/migration/mutation and every unrelated command through unchanged;
- preserve active-work scoping, source materialization, public-fetch compatibility, Queue propagation barrier and automatic Safe restore;
- emit retry metadata without command text, SQL, credentials, headers or response bodies.

## Safety

```text
Remote D1 mutation during implementation   NONE
Worker deployment during implementation   NONE
Queue/DLQ send during implementation      NONE
Lark request or mutation                   NONE
Schedule mutation                          NONE
Secret change                              NONE
Production action                          NONE
Business fact mutation                     NONE
```

## Verification

Required:

```bash
npm ci
npm run check
node --test tests/application/woocommerce-d1-read-retry.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

## Post-merge command

```bash
env \
  MKT_ENV=development \
  MKT_CUSTOMER_PROFILE=integration_workspace \
  MKT_CONNECTION_CUSTOMER_KEY=chemistry_k \
  MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS=180 \
  CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT=EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT \
  node scripts/woocommerce-final-one-command-d1-resilient.mjs --execute
```

Before any rerun, inspect operation `woo-final-full-e486b03cfe8d` read-only because the Queue message was already admitted and the verifier failure does not establish its terminal Provider outcome.
