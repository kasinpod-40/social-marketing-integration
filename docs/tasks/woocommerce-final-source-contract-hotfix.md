# WooCommerce Final Source Contract Hotfix

## Incident evidence

The guarded WooCommerce full reconciliation progressed through Queue admission and created deterministic runtime state:

```text
operation_id        = woo-final-full-e6cd0e1b227f
main_queue_attempts = 6
sync_run_status     = failed
sync_run_error_code = WOOCOMMERCE_NETWORK_ERROR
resource            = system_status
business rows       = 0
work phase          = active / datasetIndex 0 / page 1
```

The customer-provided read-only credentials were independently verified from the operator workstation against the exact Chemistry K origin:

```text
GET system_status               = 200 / about 4.8 seconds
GET orders?per_page=1           = 200
GET products?per_page=1         = 200
GET customers?per_page=1        = 200
GET coupons?per_page=1          = 200
GET products/categories?per_page=1 = 200
```

The existing final operator built Safe/UAT/Scheduled windows from canonical `wrangler.sync.jsonc` and materialized only execution flags plus Lark Table IDs. It did not bind the reviewed Chemistry K source origin into generated configs. Therefore a valid placeholder HTTPS origin could pass local config validation and fail at Worker fetch before an HTTP response while a separate hard-coded workstation test succeeded.

Automatic safe restore completed after the failed rollout. No WooCommerce Business rows were written.

## Repository-only correction

Add one outer launcher that:

1. reads the ignored canonical Wrangler config;
2. validates Integration Workspace identity;
3. blocks WooCommerce Key/Secret values inside plaintext `vars`;
4. materializes the exact non-secret source contract:

```text
WOOCOMMERCE_BASE_URL          = https://chemistryk.online
WOOCOMMERCE_API_VERSION       = wc/v3
WOOCOMMERCE_API_TIMEOUT_MS    = 45000
WOOCOMMERCE_DEFAULT_CURRENCY  = THB
```

5. rebases Worker entrypoint and D1 migration paths for an ignored generated config under `outputs/`;
6. delegates to the merged propagation-safe one-command operator;
7. removes the generated config after completion.

## Safety

- Consumer Key and Consumer Secret remain Cloudflare Worker Secrets.
- No credential value is copied, logged or committed.
- No Remote D1/Lark/Queue/Worker action occurs during implementation.
- Existing backups, exact flags, Queue topology, parity, rerun, incremental and automatic safe restore gates remain unchanged.
- Production remains blocked.

## Final command after merge

```bash
git switch main &&
git pull --ff-only &&
env \
  MKT_ENV=development \
  MKT_CUSTOMER_PROFILE=integration_workspace \
  MKT_CONNECTION_CUSTOMER_KEY=chemistry_k \
  CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT=EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT \
  node scripts/woocommerce-final-one-command-source-safe.mjs --execute
```
