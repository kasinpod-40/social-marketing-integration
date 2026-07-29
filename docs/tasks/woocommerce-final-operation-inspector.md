# WooCommerce Final Rollout — Existing Operation Read-only Inspector

## Incident carried forward

The already-admitted full operation is:

```text
woo-final-full-e486b03cfe8d
```

The prior rollout reached Queue admission, then a Remote D1 read-only snapshot command failed during `full-reconciliation`. Automatic all-false restore succeeded. That verifier failure does not prove whether the Provider work completed, remained active or failed terminally.

The final rollout operator creates a new operation identity on every fresh execution. Therefore the one-command rollout must not be rerun until the durable facts for the existing operation are inspected.

## Scope

This repository-only change adds a dedicated inspector that:

- reads the existing operation through the approved WooCommerce snapshot SQL;
- retries only the provably read-only Remote D1 command with the existing bounded retry contract;
- classifies the operation as `COMPLETE`, `ACTIVE`, `TERMINAL_FAILED` or `INDETERMINATE`;
- always returns a next action that blocks automatic new Queue admission;
- emits sanitized durable state, Coverage and Business row counts;
- performs no Worker deployment, Queue send, D1 mutation, Lark request, Schedule change, Secret change or Production action.

## Post-merge read-only command

Run from a clean checkout of merged `main`:

```bash
git pull --ff-only

env \
  MKT_ENV=development \
  MKT_CUSTOMER_PROFILE=integration_workspace \
  MKT_CONNECTION_CUSTOMER_KEY=chemistry_k \
  node scripts/woocommerce-final-operation-inspect.mjs \
    --operation-id woo-final-full-e486b03cfe8d \
    --execute
```

Expected decisions:

```text
COMPLETE         Do not send a new full operation; continue closeout from the existing operation.
ACTIVE           Do not rerun; wait and inspect the same operation again.
TERMINAL_FAILED  Do not resend automatically; inspect the failure and approved recovery contract.
INDETERMINATE    Do not rerun; investigate missing durable terminal evidence.
```

## Safety boundary

```text
Remote D1 read                 bounded SELECT only
Remote D1 mutation             none
Worker deployment              none
Queue/DLQ message              none
Lark request or mutation       none
Schedule mutation              none
Secret change                  none
Production action              none
Business fact mutation         none
```

## Verification

```bash
npm ci
npm run check
node --test tests/application/woocommerce-final-operation-inspector.test.js
node --test tests/application/woocommerce-d1-read-retry.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```
