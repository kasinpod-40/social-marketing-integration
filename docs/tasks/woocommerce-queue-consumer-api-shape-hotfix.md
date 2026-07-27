# WooCommerce Queue Consumer API Shape Hotfix

## Status

```text
TASK_STATUS                    = IMPLEMENTED_PENDING_VERIFICATION
WORKSTREAM                     = WOOCOMMERCE_QUEUE_CONSUMER_API_SHAPE_HOTFIX
ENVIRONMENT                    = development
CUSTOMER_PROFILE               = integration_workspace
CUSTOMER_KEY                   = chemistry_k
REMOTE_ACTION_DURING_HOTFIX    = NONE
PRODUCTION                     = BLOCKED
```

## Incident

The guarded WooCommerce final rollout deployed the safe all-false Worker window, then stopped during Queue
topology verification. Cloudflare returned the current consumer API shape:

```text
settings.batch_size
settings.max_wait_time_ms
settings.max_concurrency
settings.max_retries
```

The WooCommerce verifier still consumed legacy Wrangler-config names:

```text
max_batch_size
max_batch_timeout
```

This produced false `null` observations for batch size and timeout even though concurrency, retries and DLQ
matched the reviewed topology. Automatic safe restore also could not be verified for the same parser reason.

## Correction

- Add a shared Cloudflare Queue consumer response normalizer.
- Preserve official API fields and add reviewed legacy aliases only in the read-only command output.
- Convert `max_wait_time_ms` to exact whole seconds.
- Reject invalid integers, non-whole-second conversion and conflicting official/legacy values.
- Add an isolated `npx` compatibility launcher that intercepts only
  `wrangler queues consumer list ... --json` and delegates every other command unchanged.
- Keep the existing WooCommerce rollout, deploy, restore, parity, rerun and schedule gates authoritative.

## Safety

- No Queue configuration is changed by this Hotfix.
- No Queue message, D1 write, Lark request, Worker deployment, Provider request, Secret change or Production
  action occurs during Repository implementation.
- The compatibility launcher transforms only local read-only JSON stdout.
- The original consumer response fields remain present in the normalized payload.
