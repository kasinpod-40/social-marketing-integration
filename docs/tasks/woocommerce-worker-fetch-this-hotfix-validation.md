# WooCommerce Worker Fetch Receiver Hotfix — Validation Checklist

```text
base main                         294e48807963478c75381db66969f3efbdd8a8e6
branch                            hotfix/woocommerce-worker-fetch-this
remote action during implementation NONE
```

Required exact-head verification:

```bash
npm ci
npm run check
node --test tests/application/woocommerce-worker-fetch-context.test.js
node --test tests/woocommerce/woocommerce-rest-client.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

Acceptance criteria:

- receiver-sensitive regression passes;
- existing WooCommerce client regressions pass;
- full repository syntax, architecture and hygiene pass;
- full Node and Workers-runtime suites pass;
- report reliability regression passes;
- dependency audit passes;
- Wrangler dry-run passes without deployment;
- no Remote D1/Lark/Queue/Provider action occurs;
- PR stays Draft until exact-head CI and review are complete.
