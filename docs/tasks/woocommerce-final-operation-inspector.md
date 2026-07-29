# WooCommerce Final Rollout — Existing Operation Read-only Inspector

## Incident carried forward

The already-admitted full operation is:

```text
woo-final-full-e486b03cfe8d
```

The prior rollout reached Queue admission, then a Remote D1 read-only snapshot command failed during `full-reconciliation`. Automatic all-false restore succeeded. That verifier failure did not prove whether the Provider work completed, remained active or failed terminally.

The final rollout operator creates a new operation identity on every fresh execution. Therefore the one-command rollout must not be rerun until the durable facts for the existing operation are inspected.

## First live inspection result — 2026-07-29

The merged inspector ran from clean `main@8a24bb519a87c72b70b83ffd642ac567571b3e1a` and returned:

```text
sync_run_status        failed
sync_run_error_code    WOOCOMMERCE_NETWORK_ERROR
work_lifecycle_status  active
active_lock_count      0
queue_operation_attempts 1
coverage_run_count     0
all Commerce rows      0
phase_complete         false
completion             null
```

This is not genuine active processing. The failed Sync Run is terminal while the durable work row is stale-active and unlocked. The first classifier incorrectly gave `ACTIVE` precedence over the terminal Sync Run. No Queue resend is authorized.

The runtime diagnostics hotfix already persists an allowlisted immediate Worker `fetch()` cause in `sync_runs.details_json`. The inspector now reads that same row and returns only:

```text
resource
timeoutMs
elapsedMs
networkCause.name
networkCause.message
networkCause.code
networkCause.nestedName
networkCause.nestedMessage
networkCause.nestedCode
```

No headers, credentials, response body, stack, URL credentials or unrelated Sync Run details are emitted.

## Scope

The inspector:

- reads the existing operation through the approved WooCommerce snapshot SQL;
- includes the existing `sync_runs.details_json` in the same read-only query;
- retries only the provably read-only Remote D1 command with the existing bounded retry contract;
- classifies failed Sync Runs with no active lock as `TERMINAL_FAILED`, even when durable work remains stale-active;
- reports `staleActiveFailure=true` for that exact mismatch;
- emits only allowlisted Worker network diagnostics;
- always returns a next action that blocks automatic new Queue admission;
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

Expected decision for the known durable facts:

```text
TERMINAL_FAILED
staleActiveFailure=true
nextAction=do_not_resend_inspect_network_cause_then_recover_stale_active_work
```

The exact network diagnostics must be reviewed before any routing/origin correction or fresh WooCommerce operation. Stale-work recovery remains a separate guarded mutation step using the existing failed-work recovery contract.

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
