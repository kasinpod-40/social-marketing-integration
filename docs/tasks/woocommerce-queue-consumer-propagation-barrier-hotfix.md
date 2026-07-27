# WooCommerce Queue Consumer Propagation Barrier Hotfix

## Incident

The guarded final rollout deployed and verified the Manual UAT Worker version, then immediately pushed operation:

```text
woo-final-full-7f5e9801ed9e
```

Remote D1 proved:

```text
main_queue_attempts = 1
error_code         = WOOCOMMERCE_CONNECTOR_INVALID
sync_run           = absent
sync_work          = absent
business rows      = 0
```

The exact reviewed source at the executed commit already classified WooCommerce as `ACTIVE`, and the Integration Workspace account key was `chemistry_k`. Therefore the permanent failure is consistent with the Queue consumer handling the message with the preceding safe Worker environment where `MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false` before the newly active UAT version had propagated to that consumer execution path.

Automatic safe restore completed successfully with all WooCommerce execution flags false.

## Scope

Repository-only compatibility hotfix:

- Add a launcher that inherits every existing one-command guard.
- Preload a narrowly scoped fetch adapter into all child Node processes.
- Add `delay_seconds=120` only to the first Manual UAT full-reconciliation Queue API request for one operation.
- Never delay scheduled, incremental, continuation, unrelated connector or repeated same-operation messages.
- Preserve a longer operator-provided delay.
- Extend bounded full verification from the existing default to 480 polls only when the operator did not explicitly configure another value.

## Safety

- No Remote D1 write during implementation.
- No Lark request during implementation.
- No Queue message during implementation.
- No Worker deployment during implementation.
- No schedule change during implementation.
- No Secret or credential value is logged or committed.
- The existing automatic safe restore remains authoritative.

## Final command after merge

```bash
env \
  MKT_ENV=development \
  MKT_CUSTOMER_PROFILE=integration_workspace \
  MKT_CONNECTION_CUSTOMER_KEY=chemistry_k \
  CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT=EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT \
  node scripts/woocommerce-final-one-command-propagation-safe.mjs --execute
```
