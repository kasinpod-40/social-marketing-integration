# WooCommerce Worker Public Fetch Path Hotfix

## Live evidence

The guarded WooCommerce final rollout reached the active Manual UAT Worker and created the deterministic Sync Run, but failed before receiving an HTTP response from the first `system_status` request:

```text
operation_id                  = woo-final-full-b421e458b1d9
sync_run_status               = failed
sync_run_error_code           = WOOCOMMERCE_NETWORK_ERROR
work_lifecycle_status         = active
queue_operation_attempts      = 1
coverage_run_count            = 0
business_rows                 = 0
active_lock_count             = 0
automatic_safe_restore        = PASS
```

The generated source-contract evidence immediately before deployment confirmed:

```text
hostname                      = chemistryk.online
api_version                   = wc/v3
timeout_ms                    = 45000
currency                      = THB
plaintext_secret_values       = 0
```

The same read-only WooCommerce credentials and exact public HTTPS endpoints returned HTTP 200 from the operator workstation for:

```text
system_status
orders
products
customers
coupons
products/categories
```

Therefore URL identity, credential validity and WooCommerce endpoint availability are verified from outside the Worker. The remaining failure boundary is Worker subrequest routing before an HTTP response.

## Current hypothesis

Cloudflare documents that global `fetch()` to another Worker or route in the same zone can fail unless the call uses a Service Binding or the `global_fetch_strictly_public` compatibility flag. The observed failure is consistent with this boundary, but it remains a hypothesis until a live rollout passes after the compatibility flag is active.

This task must not claim final root cause before that live confirmation.

## Repository implementation

- Extend the existing generated WooCommerce source-safe Wrangler contract.
- Preserve every existing valid compatibility flag.
- Add exactly one deduplicated compatibility flag:

```text
global_fetch_strictly_public
```

- Validate that the generated config contains the flag before delegation.
- Record only the public compatibility flag name in source-contract evidence.
- Keep the canonical ignored `wrangler.sync.jsonc` unchanged.
- Keep WooCommerce Consumer Key and Consumer Secret exclusively in Worker Secrets.
- Preserve all existing Backup, Safe/UAT/Scheduled windows, Queue propagation barrier, failed-work recovery, D1/Lark parity, rerun, incremental and automatic safe-restore gates.

## Safety

Repository implementation only:

```text
Remote D1 mutation             = NONE
Lark request/mutation          = NONE
Queue/DLQ action               = NONE
Worker deployment              = NONE
Schedule activation            = NONE
Secret change                  = NONE
Production action              = NONE
Business fact deletion         = NONE
```

## Acceptance criteria

- Existing compatibility flags remain present and ordered.
- `global_fetch_strictly_public` is present exactly once.
- Missing or malformed compatibility configuration fails closed.
- Exact Chemistry K source identity remains unchanged.
- No plaintext WooCommerce credential is copied into generated config.
- JSONC input, comments and trailing commas remain accepted.
- Syntax, architecture and repository hygiene pass.
- Focused TikTok regression passes.
- Full Node and Workers runtime tests pass.
- Report reliability regression passes.
- Dependency audit passes.
- Wrangler dry-run passes without deployment.

## Live confirmation after merge

The same authorized one-command rollout must be run from clean current `main`. A successful provider response and completed Full reconciliation are required before changing the hypothesis to a verified root cause.
