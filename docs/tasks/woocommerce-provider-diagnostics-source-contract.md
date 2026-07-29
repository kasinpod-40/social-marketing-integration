# WooCommerce Provider Diagnostics Source Contract Hotfix

## Incident

After PR #228 merged, the exact-confirmed local Provider GET-only diagnostic stopped before any
Provider request:

```text
code                     WOOCOMMERCE_RUNTIME_CONFIG_INVALID
message                  WOOCOMMERCE_BASE_URL is required
providerRequestCount     0
all mutation counters    0
```

The failure was local configuration composition, not a WooCommerce response failure.

## Root cause

The Final rollout materializes the approved non-secret Chemistry K source values from
`woocommerce-final-source-contract.js` into a temporary Wrangler config. The Provider diagnostic
instead loaded `.dev.vars` and passed it directly to `readWooCommerceRuntimeConfig()`.

`.dev.vars` intentionally contains credentials and runtime target values but is not required to
duplicate the non-secret source contract. Therefore the diagnostic could lack the complete set:

```text
WOOCOMMERCE_BASE_URL
WOOCOMMERCE_API_VERSION
WOOCOMMERCE_API_TIMEOUT_MS
WOOCOMMERCE_DEFAULT_CURRENCY
```

Fixing only `WOOCOMMERCE_BASE_URL` would have allowed later drift or another one-field failure.

## Implementation

- reuse `WOOCOMMERCE_FINAL_SOURCE_CONTRACT` and `assertMaterializedSource`;
- materialize all four approved non-secret source fields before runtime config parsing;
- preserve credentials only from `.dev.vars` / process environment;
- accept missing or semantically equivalent explicit values;
- reject conflicting explicit values before any Provider request;
- continue forcing D1, Lark, Report, Full reconciliation and Schedule gates false;
- keep the operator at exactly one GET to `system_status`.

## Acceptance

- a normal local `.dev.vars` without duplicated source fields reaches the Provider client;
- a conflicting hostname, API version, timeout or currency fails with
  `WOOCOMMERCE_PROVIDER_DIAGNOSTICS_SOURCE_CONFLICT` and request count zero;
- no response body, credential value or unrestricted header is persisted;
- no Worker deployment, Queue/DLQ message, D1/Lark mutation or Schedule action exists;
- full Branch Verification passes before merge.

## Operational boundary

This repository hotfix does not authorize a Final rollout rerun. After merge, rerun only the exact
Provider GET-only diagnostic command. The stale failed operation
`woo-final-full-6f43ac8ee857` remains untouched until a separate exact recovery contract is approved.
