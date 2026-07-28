# WooCommerce Shared-Worker Active-Work Scope Hotfix

## Live evidence

The source-safe final rollout successfully materialized the exact Chemistry K source contract and `global_fetch_strictly_public`, then stopped before deployment with:

```text
WOOCOMMERCE_FINAL_ACTIVE_WORK_BLOCKED
activeWorkCount = 1
activeLockCount = 0
```

The Integration Workspace is shared by multiple connectors. Both the failed-work recovery verifier and the final Remote preflight currently count every active row in `sync_work_runs` and every active row in `sync_locks`. That global count can block WooCommerce because another independently reviewed connector has retained operational work.

## Scope

Repository-only compatibility hotfix:

- Add a narrow SQL rewriter for only the two WooCommerce final active-work verification queries.
- Scope active work to `work_key LIKE 'woocommerce:%'`.
- Scope active locks to `owner_id LIKE 'woocommerce:%'`.
- Preserve the exact failed WooCommerce work recovery, source contract, public-fetch flag, Queue propagation barrier, D1 backup, Lark schema, parity, rerun, incremental and schedule gates.
- Continue to fail closed when any WooCommerce work or lock remains active.
- Do not mutate or terminalize work owned by TikTok, Meta, YouTube, Chatwoot, Google Ads or another connector.

## Implementation strategy

A temporary executable `npx` shim is prepended to `PATH` only for the final rollout child process. It rewrites only Remote Wrangler D1 execute commands containing the recognized active-work aliases and both reliability tables. Every unrelated Wrangler command and every unrelated SQL statement passes through byte-for-byte.

The shim returns stdout/stderr and exit status from the real `npx`, so the existing operator contracts remain authoritative.

## Safety

- No Remote D1 query or mutation during implementation.
- No Worker deployment during implementation.
- No Queue/DLQ message during implementation.
- No Lark request or mutation during implementation.
- No Secret or Production change.
- No Business facts are changed by the compatibility layer.

## Final command after merge

```bash
env \
  MKT_ENV=development \
  MKT_CUSTOMER_PROFILE=integration_workspace \
  MKT_CONNECTION_CUSTOMER_KEY=chemistry_k \
  CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT=EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT \
  node scripts/woocommerce-final-one-command-active-scope.mjs --execute
```
